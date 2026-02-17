import "dotenv/config";
import express from "express";
import { createHash, randomUUID } from "node:crypto";
import { semanticAmbiguityA } from "./services/difficulty.service.js";
import {
  DummyEmbeddingProvider,
  GeminiEmbeddingProvider,
  type EmbeddingProvider,
} from "./providers/embedding.provider.js";
import { normalizeReasoningDepth } from "./services/reasoning-depth.service.js";
import {
  computeLexicalComplexity,
  computeStructuralComplexity,
} from "./services/lexical-structural.service.js";
import {
  computeDifficultyScore,
} from "./services/difficulty-score.service.js";
import { DIFFICULTY_WEIGHTS } from "./config/difficulty.config.js";
import { BASELINE_ITEMS } from "./config/baseline.items.js";
import { computeTargetProfile } from "./services/target-profile.service.js";
import {
  buildDistractorsFromText,
  extractBlankSlots,
  generateFillBlank,
  generateFillBlankCandidates,
  getBlankPattern,
  normalizeForSimilarity,
  scoreFillBlankAnswers,
} from "./services/fill-blank.service.js";
import { computeTargetFromSources } from "./services/target-from-sources.service.js";
import { targetFromStructure } from "./services/structure-target.service.js";
import { classifyFormat } from "./services/format-classifier.service.js";
import { validateGenerated } from "./services/format-validator.service.js";
import { cosineSimilarity } from "./utils/cosine.js";
import { countWords } from "./utils/text-metrics.js";
import { GeminiTextGenerationProvider } from "./providers/gemini.generate.provider.js";
import type {
  GenerateMcRequest,
  GenerateMcError,
  TargetFromSourcesMcRequest,
  MultipleChoiceItem as ContractMultipleChoiceItem,
} from "../../shared/api.js";

const API_VERSION = "v1" as const;

type MultipleChoiceItem = ContractMultipleChoiceItem & { subtype?: "combo" | "standard" };

type StructureItem = {
  label: string;
  type: "principle" | "exception" | "procedure" | "sanction";
  actor: string;
  action: string;
  condition: string;
  object: string;
  numeric: string[];
};

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (_req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  return next();
});

const embeddingProvider: EmbeddingProvider = (() => {
  const provider = process.env.EMBEDDING_PROVIDER || "dummy";
  if (provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_EMBEDDING_MODEL || "text-embedding-004";
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required for EMBEDDING_PROVIDER=gemini");
    }
    return new GeminiEmbeddingProvider(apiKey, model);
  }
  return new DummyEmbeddingProvider();
})();

const generationProvider = (() => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GEMINI_GENERATION_MODEL || "gemini-2.5-flash";
  return new GeminiTextGenerationProvider(apiKey, model);
})();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/difficulty/weights", (_req, res) => {
  res.json({ weights: DIFFICULTY_WEIGHTS });
});

app.get("/config/target-profile", async (_req, res) => {
  try {
    const target = await computeTargetProfile(BASELINE_ITEMS, embeddingProvider, 5);
    res.json({
      target,
      baselineCount: BASELINE_ITEMS.length,
      note:
        "Target profile derived from internally constructed baseline items (non-proprietary).",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(400).json({ error: message });
  }
});

app.get("/config/baseline-sample", (_req, res) => {
  if (BASELINE_ITEMS.length === 0) {
    return res.status(404).json({ error: "No baseline items configured." });
  }
  return res.json({ item: BASELINE_ITEMS[0], baselineCount: BASELINE_ITEMS.length });
});

app.post("/difficulty/semantic-ambiguity", (req, res) => {
  try {
    const { correct, distractors } = req.body as {
      correct: number[];
      distractors: number[][];
    };

    if (!Array.isArray(correct) || !Array.isArray(distractors)) {
      return res
        .status(400)
        .json({ error: "Expected { correct: number[], distractors: number[][] }" });
    }

    const score = semanticAmbiguityA(correct, distractors);
    return res.json({ A: score });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(400).json({
      ok: false,
      apiVersion: API_VERSION,
      error: message,
      errorType: "BAD_REQUEST",
    });
  }
});

app.post("/difficulty/semantic-ambiguity/text", async (req, res) => {
  try {
    const { correct, distractors, dimension, debug } = req.body as {
      correct: string;
      distractors: string[];
      dimension?: number;
      debug?: boolean;
    };

    if (typeof correct !== "string" || !Array.isArray(distractors)) {
      return res
        .status(400)
        .json({ error: "Expected { correct: string, distractors: string[] }" });
    }

    const dim = typeof dimension === "number" ? dimension : 8;
    const correctVec = await embeddingProvider.embedText(correct, dim);
    const distractorVecs = await embeddingProvider.embedTexts(distractors, dim);
    const score = semanticAmbiguityA(correctVec, distractorVecs);

    if (debug) {
      return res.json({ A: score, correctVec, distractorVecs });
    }

    return res.json({ A: score });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(400).json({
      ok: false,
      apiVersion: API_VERSION,
      error: message,
      errorType: "BAD_REQUEST",
    });
  }
});

app.post("/difficulty/reasoning-depth", (req, res) => {
  try {
    const { steps, maxSteps } = req.body as {
      steps: number;
      maxSteps?: number;
    };

    if (typeof steps !== "number") {
      return res.status(400).json({ error: "Expected { steps: number, maxSteps?: number }" });
    }

    const score = normalizeReasoningDepth(steps, maxSteps ?? 5);
    return res.json({ R: score });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
});

app.post("/difficulty/lexical-structural", (req, res) => {
  try {
    const { text } = req.body as { text: string };
    if (typeof text !== "string") {
      return res.status(400).json({ error: "Expected { text: string }" });
    }

    const lexical = computeLexicalComplexity(text);
    const structural = computeStructuralComplexity(text);

    return res.json({ lexical, structural });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
});

app.post("/difficulty/overall", async (req, res) => {
  try {
    const {
      text,
      correct,
      distractors,
      steps,
      maxSteps,
      weights,
    } = req.body as {
      text?: string;
      correct?: string;
      distractors?: string[];
      steps?: number;
      maxSteps?: number;
      weights?: {
        wL: number;
        wS: number;
        wA: number;
        wR: number;
      };
    };

    if (typeof text !== "string") {
      return res.status(400).json({ error: "Expected { text: string, correct: string, distractors: string[], steps: number }" });
    }
    if (typeof correct !== "string" || !Array.isArray(distractors)) {
      return res.status(400).json({ error: "Expected { text: string, correct: string, distractors: string[], steps: number }" });
    }
    if (typeof steps !== "number") {
      return res.status(400).json({ error: "Expected { text: string, correct: string, distractors: string[], steps: number }" });
    }

    const dim = 8;
    const correctVec = await embeddingProvider.embedText(correct, dim);
    const distractorVecs = await embeddingProvider.embedTexts(distractors, dim);

    const lexical = computeLexicalComplexity(text);
    const structural = computeStructuralComplexity(text);
    const A = semanticAmbiguityA(correctVec, distractorVecs);
    const R = normalizeReasoningDepth(steps, maxSteps ?? 5);

    const score = computeDifficultyScore(
      { L: lexical.L, S: structural.S, A, R },
      weights ?? DIFFICULTY_WEIGHTS
    );

    return res.json({
      D: score.D,
      components: score.components,
      weights: score.weights,
      details: { lexical, structural },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
});

app.post("/fill-blank/extract", (req, res) => {
  try {
    const { text } = req.body as { text: string };
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Expected { text: string }" });
    }
    const slots = extractBlankSlots(text);
    return res.json({ slotCount: slots.length, slots });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
});

app.post("/fill-blank/grade", (req, res) => {
  try {
    const { expected, submitted } = req.body as {
      expected: string[] | string;
      submitted: string[] | string;
    };
    const expectedList = Array.isArray(expected) ? expected : [expected];
    const submittedList = Array.isArray(submitted) ? submitted : [submitted];
    if (!expectedList.every((s) => typeof s === "string")) {
      return res.status(400).json({ error: "expected must be string or string[]" });
    }
    if (!submittedList.every((s) => typeof s === "string")) {
      return res.status(400).json({ error: "submitted must be string or string[]" });
    }
    const result = scoreFillBlankAnswers(expectedList, submittedList);
    return res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
});

app.post("/vision/extract-slots", async (req, res) => {
  try {
    const { imageBase64, mimeType, maxSlots } = req.body as {
      imageBase64: string;
      mimeType?: string;
      maxSlots?: number;
    };
    if (!imageBase64 || typeof imageBase64 !== "string") {
      return res.status(400).json({ error: "imageBase64 is required." });
    }
    if (!generationProvider || !generationProvider.generateTextFromImage) {
      return res.status(400).json({ error: "Vision extraction provider is not configured." });
    }
    const mime = typeof mimeType === "string" && mimeType ? mimeType : "image/png";
    const cap = Math.max(1, Math.min(maxSlots ?? 6, 6));

    const system =
      "You extract blank-slot structure from English cloze images. Return ONLY valid JSON.";
    const prompt = [
      "Extract only structural info. Do not solve the problem.",
      "Return strict JSON:",
      '{"type":"prefix_blank|full_blank","slotCount":2,"slots":[{"id":1,"prefix":"fa","missingCount":2,"confidence":0.82}],"confidence":0.80}',
      "Rules:",
      "- slotCount must be 1 to 6.",
      "- prefix length 0 to 4 letters.",
      "- missingCount 1 to 10.",
      "- confidence values between 0 and 1.",
      `- Do not return more than ${cap} slots.`,
    ].join("\n");

    const raw = await generationProvider.generateTextFromImage(prompt, imageBase64, mime, system);
    const parsed = extractJsonObject<{
      type?: "prefix_blank" | "full_blank";
      slotCount?: number;
      slots?: Array<{ id?: number; prefix?: string; missingCount?: number; confidence?: number }>;
      confidence?: number;
    }>(raw);
    if (!parsed || !Array.isArray(parsed.slots)) {
      return res.status(422).json({ error: "Failed to parse vision slot extraction." });
    }
    const slots = parsed.slots
      .map((s, idx) => ({
        id: s.id ?? idx + 1,
        prefix: String(s.prefix || "").toLowerCase(),
        missingCount: Number(s.missingCount || 0),
        confidence: Number(s.confidence ?? 0.7),
      }))
      .filter(
        (s) =>
          /^[a-z]{0,4}$/.test(s.prefix) &&
          Number.isFinite(s.missingCount) &&
          s.missingCount >= 1 &&
          s.missingCount <= 10
      )
      .slice(0, cap);

    const confidence =
      slots.length === 0
        ? 0
        : slots.reduce((sum, s) => sum + Math.max(0, Math.min(1, s.confidence)), 0) / slots.length;

    return res.json({
      type: parsed.type === "full_blank" ? "full_blank" : "prefix_blank",
      slotCount: slots.length,
      slots,
      confidence: Number(confidence.toFixed(2)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
});

function normalizePrefixUnderscorePatterns(text: string): string {
  let normalized = text
    .replace(/[＊*＿]/g, "_")
    .replace(/[–—−]/g, "_")
    .replace(/\.{2,}|…+/g, "_");

  normalized = normalized.replace(
    /((?:[A-Za-z]\s+){1,8})((?:_\s*){2,})/g,
    (_m, rawPrefix: string, rawBlank: string) => {
      const prefix = rawPrefix.replace(/\s+/g, "");
      const blanks = (rawBlank.match(/_/g) || []).length;
      return `${prefix}${"_".repeat(blanks)}`;
    }
  );

  normalized = normalized.replace(
    /([A-Za-z]{1,12})\s+((?:_\s*){2,})/g,
    (_m, prefix: string, rawBlank: string) => {
      const blanks = (rawBlank.match(/_/g) || []).length;
      return `${prefix}${"_".repeat(blanks)}`;
    }
  );

  normalized = normalized.replace(/(?:_\s*){2,}/g, (m) => {
    const blanks = Math.max(2, Math.min((m.match(/_/g) || []).length, 10));
    return "_".repeat(blanks);
  });

  normalized = normalized.replace(/\s{2,}/g, " ").trim();
  return normalized;
}

function fallbackRegexSlotExtract(text: string) {
  const slots: Array<{
    index: number;
    start: number;
    end: number;
    prefix: string;
    missingCount: number;
    pattern: string;
    slotConfidence: number;
  }> = [];
  const normalized = normalizePrefixUnderscorePatterns(text);
  const regex = /([A-Za-z]{1,4})\s*(_{2,10})/g;
  for (const m of normalized.matchAll(regex)) {
    const prefix = m[1] || "";
    const blanks = m[2] || "";
    const start = m.index ?? -1;
    if (start < 0) continue;
    slots.push({
      index: slots.length,
      start,
      end: start + (m[0]?.length || 0),
      prefix: prefix.toLowerCase(),
      missingCount: blanks.length,
      pattern: `${prefix}${blanks}`,
      slotConfidence: 0.58,
    });
  }
  return slots;
}

function validateStructuredSlots(
  displayText: string,
  slots: Array<{
    id?: number;
    prefix: string;
    missingCount: number;
    confidence?: number;
  }>
) {
  const valid = slots
    .filter((s) => /^[A-Za-z]{1,4}$/.test(s.prefix) && s.missingCount >= 1 && s.missingCount <= 8)
    .map((s, idx) => {
      const pattern = `${s.prefix}${"_".repeat(s.missingCount)}`;
      return {
        index: idx,
        start: displayText.indexOf(pattern),
        end: displayText.indexOf(pattern) >= 0 ? displayText.indexOf(pattern) + pattern.length : -1,
        prefix: s.prefix,
        missingCount: s.missingCount,
        pattern,
        slotConfidence: Math.max(0, Math.min(1, s.confidence ?? 0.75)),
      };
    })
    .filter((s) => s.start >= 0);
  return valid;
}

function estimateCefrLevel(text: string): "B2" | "C1" {
  const words = (text.match(/[A-Za-z]+/g) || []).map((w) => w.toLowerCase());
  if (words.length === 0) return "B2";
  const avgLen = words.reduce((sum, w) => sum + w.length, 0) / words.length;
  const longRatio = words.filter((w) => w.length >= 8).length / words.length;
  return avgLen >= 5.6 || longRatio >= 0.28 ? "C1" : "B2";
}

function textLengthBucket(text: string): "short" | "medium" {
  const count = countWords(text);
  return count <= 90 ? "short" : "medium";
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function computeAxisTolerance(meanVal: number, stdVal: number, count: number) {
  const base = count <= 1 ? 0.12 : count === 2 ? 0.08 : 0.05;
  const adaptive = stdVal > 0 ? stdVal * 1.5 : base;
  return Math.min(Math.max(Math.max(base, adaptive), 0.03), 0.25);
}

function buildContextSnippet(
  text: string,
  start: number,
  end: number,
  radius = 24
): string {
  const left = Math.max(0, start - radius);
  const right = Math.min(text.length, end + radius);
  return text.slice(left, right).replace(/\s+/g, " ").trim();
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mergeSlotConfidence(rawSlots: ReturnType<typeof extractBlankSlots>, aiSlots: ReturnType<typeof extractBlankSlots>) {
  const merged = (aiSlots.length > 0 ? aiSlots : rawSlots).map((slot) => {
    const closestRaw = rawSlots
      .map((r) => ({
        slot: r,
        score:
          Math.abs(r.start - slot.start) +
          (r.missingCount === slot.missingCount ? 0 : 10) +
          (r.prefix.toLowerCase() === slot.prefix.toLowerCase() ? 0 : 5),
      }))
      .sort((a, b) => a.score - b.score)[0];
    let confidence = 0.55;
    if (closestRaw) {
      if (closestRaw.slot.missingCount === slot.missingCount) confidence += 0.2;
      if (closestRaw.slot.prefix.toLowerCase() === slot.prefix.toLowerCase()) confidence += 0.15;
      if (Math.abs(closestRaw.slot.start - slot.start) <= 3) confidence += 0.1;
    }
    return {
      ...slot,
      slotConfidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))),
    };
  });
  return merged;
}

function getWordMatches(text: string): Array<{ word: string; start: number; end: number }> {
  const matches: Array<{ word: string; start: number; end: number }> = [];
  const regex = /[A-Za-z]+/g;
  for (const m of text.matchAll(regex)) {
    const word = m[0];
    const start = m.index ?? -1;
    if (!word || start < 0) continue;
    matches.push({ word, start, end: start + word.length });
  }
  return matches;
}

function inferSlotsFromRawVsAi(
  rawText: string,
  aiText: string
): Array<{
  index: number;
  start: number;
  end: number;
  prefix: string;
  missingCount: number;
  pattern: string;
  slotConfidence: number;
}> {
  const rawWords = getWordMatches(rawText);
  const aiWords = getWordMatches(aiText);
  const inferred: Array<{
    index: number;
    start: number;
    end: number;
    prefix: string;
    missingCount: number;
    pattern: string;
    slotConfidence: number;
  }> = [];

  let j = 0;
  for (let i = 0; i < aiWords.length; i += 1) {
    const aiWord = aiWords[i];
    if (!aiWord) continue;
    const aiLower = aiWord.word.toLowerCase();

    const rawCurrent = rawWords[j];
    if (rawCurrent && rawCurrent.word.toLowerCase() === aiLower) {
      j += 1;
      continue;
    }

    let bestPrefix = "";
    let bestNextJ = j;
    let built = "";
    let k = j;
    let consumed = 0;
    while (k < rawWords.length && consumed < 6) {
      const rawPart = rawWords[k];
      if (!rawPart) break;
      const part = rawPart.word.toLowerCase();
      if (part.length > 2) break;
      built += part;
      consumed += 1;
      k += 1;
      if (!aiLower.startsWith(built)) break;
      const missing = aiLower.length - built.length;
      if (built.length >= 1 && missing >= 2 && missing <= 10) {
        bestPrefix = built;
        bestNextJ = k;
      }
      if (built.length >= aiLower.length) break;
    }

    if (bestPrefix) {
      const missingCount = aiLower.length - bestPrefix.length;
      inferred.push({
        index: inferred.length,
        start: aiWord.start,
        end: aiWord.end,
        prefix: bestPrefix,
        missingCount,
        pattern: `${bestPrefix}${"_".repeat(missingCount)}`,
        slotConfidence: 0.42,
      });
      j = bestNextJ;
      continue;
    }

    if (j < rawWords.length) j += 1;
  }

  return inferred;
}

function reconstructBlankDisplayFromAi(
  aiText: string,
  slots: Array<{
    index: number;
    start: number;
    end: number;
    prefix: string;
    missingCount: number;
    pattern: string;
    slotConfidence?: number;
  }>
): { displayText: string; answerKey: string[] } {
  let output = aiText;
  const answerKey: string[] = [];

  for (const slot of slots) {
    const blankToken = `${slot.prefix}${"_".repeat(slot.missingCount)}`;
    if (slot.prefix) {
      const regex = new RegExp(
        `\\b(${escapeRegex(slot.prefix)})([A-Za-z]{${slot.missingCount}})\\b`,
        "i"
      );
      const match = output.match(regex);
      if (match) {
        answerKey.push(`${match[1]}${match[2]}`);
        output = output.replace(regex, blankToken);
        continue;
      }
    }
    answerKey.push("");
  }
  return { displayText: output, answerKey };
}

function harmonizeSingleBlankWithAnswer(
  text: string,
  format: "full_blank" | "prefix_blank",
  answer: string,
  pattern?: { prefix: string; blanks: string; blankCount: number } | null
): string {
  const cleanAnswer = answer.replace(/\s+/g, "").trim();
  if (!cleanAnswer) return text;
  if (format === "prefix_blank" && pattern) {
    const prefix = pattern.prefix;
    const lowerPrefix = prefix.toLowerCase();
    const normalizedAnswer = cleanAnswer.toLowerCase().startsWith(lowerPrefix)
      ? cleanAnswer
      : `${prefix}${cleanAnswer}`;
    // Keep at least 2 underscores so validator/extractor treat it as a valid blank token.
    const missing = Math.max(normalizedAnswer.length - prefix.length, 2);
    const token = `${prefix}${"_".repeat(missing)}`;
    return text.replace(/([A-Za-z]{1,5}\s*(?:_\s*){2,}|(?:_\s*){2,})/, token);
  }
  const token = "_".repeat(Math.max(cleanAnswer.length, 2));
  return text.replace(/(?:_\s*){2,}/, token);
}

function harmonizePrefixBlankWithoutSourcePrefix(text: string, answer: string): string {
  const clean = answer.replace(/\s+/g, "").toLowerCase().replace(/[^a-z]/g, "");
  if (!clean) return text;
  const n = clean.length;
  if (n < 3) return text.replace(/([A-Za-z]{1,5}\s*(?:_\s*){2,}|(?:_\s*){2,})/, "__");
  const maxPrefix = Math.min(4, n - 2);
  const hash = Array.from(clean).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const prefixLen = Math.max(1, Math.min(maxPrefix, 1 + (hash % maxPrefix)));
  const prefix = clean.slice(0, prefixLen);
  const missing = Math.max(n - prefixLen, 2);
  const token = `${prefix}${"_".repeat(missing)}`;
  return text.replace(/([A-Za-z]{1,5}\s*(?:_\s*){2,}|(?:_\s*){2,})/, token);
}

function buildBlankedCandidateFromFullText(
  fullText: string,
  slotRules: Array<{ missingCount: number }>,
  expectedBlankCount: number,
  chosenWords?: string[],
  chosenPrefixLengths?: number[],
  forcePrefixMode = false
): { text: string; answerKey: string[] } | null {
  const words = getWordMatches(fullText);
  if (words.length === 0) return null;

  const used = new Set<number>();
  const picked: Array<{
    index: number;
    word: string;
    start: number;
    end: number;
    rule: { missingCount: number };
  }> = [];
  const isTailWord = (end: number) => {
    const tail = fullText.slice(end).trim();
    return !tail || /^[.!?]+$/.test(tail);
  };

  const choosePrefixLength = (
    word: string,
    targetMissingCount: number,
    requestedPrefixLength?: number
  ) => {
    const n = word.length;
    const maxPrefix = Math.min(4, n - 2);
    if (maxPrefix < 1) return 0;
    if (
      Number.isFinite(requestedPrefixLength) &&
      requestedPrefixLength != null &&
      requestedPrefixLength >= 1
    ) {
      return Math.max(1, Math.min(requestedPrefixLength, maxPrefix));
    }
    const clampedMissing = Math.max(2, Math.min(targetMissingCount || Math.floor(n / 2), n - 1));
    let prefixLen = n - clampedMissing;
    if (prefixLen < 1 || prefixLen > maxPrefix) {
      const hash = Array.from(word).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      prefixLen = 1 + (hash % maxPrefix);
    }
    return Math.max(1, Math.min(prefixLen, maxPrefix));
  };

  const chooseWordForSlot = (slotIdx: number) => {
    const rule = slotRules[slotIdx] || { missingCount: 2 };
    const requested = String(chosenWords?.[slotIdx] || "").trim().toLowerCase();
    let selectedIndex = -1;

    if (requested) {
      selectedIndex = words.findIndex(
        (w, idx) => !used.has(idx) && !isTailWord(w.end) && w.word.toLowerCase() === requested
      );
    }

    if (selectedIndex < 0 && rule.missingCount > 0) {
      const targetLen = Math.max(rule.missingCount + 1, 4);
      selectedIndex = words.findIndex(
        (w, idx) =>
          !used.has(idx) &&
          !isTailWord(w.end) &&
          w.word.length >= 4 &&
          Math.abs(w.word.length - targetLen) <= 2
      );
    }

    if (selectedIndex < 0) {
      selectedIndex = words.findIndex(
        (w, idx) => !used.has(idx) && !isTailWord(w.end) && w.word.length >= 4
      );
    }
    if (selectedIndex < 0) return null;
    used.add(selectedIndex);
    const match = words[selectedIndex];
    if (!match) return null;
    picked.push({
      index: selectedIndex,
      word: match.word,
      start: match.start,
      end: match.end,
      rule,
    });
    return true;
  };

  for (let i = 0; i < expectedBlankCount; i += 1) {
    if (!chooseWordForSlot(i)) return null;
  }

  let out = fullText;
  const answerKey: string[] = new Array(expectedBlankCount).fill("");
  const sorted = [...picked].sort((a, b) => b.start - a.start);
  for (const p of sorted) {
    const slotIdx = picked.findIndex((x) => x.start === p.start && x.end === p.end);
    const lowerWord = p.word.toLowerCase();
    let replacement = "";
    if (forcePrefixMode) {
      const requestedPrefix = chosenPrefixLengths?.[slotIdx];
      const prefixLen = choosePrefixLength(lowerWord, p.rule.missingCount, requestedPrefix);
      const prefix = lowerWord.slice(0, prefixLen);
      const missing = Math.max(lowerWord.length - prefixLen, 2);
      replacement = `${prefix}${"_".repeat(missing)}`;
    } else {
      replacement = "_".repeat(Math.max(lowerWord.length, 2));
    }
    out = `${out.slice(0, p.start)}${replacement}${out.slice(p.end)}`;
    if (slotIdx >= 0) answerKey[slotIdx] = lowerWord;
  }

  if (answerKey.some((a) => !a)) return null;
  return { text: out, answerKey };
}

function validateBlankedCandidateShape(
  text: string,
  answerKey: string[],
  expectedBlankCount: number,
  sourceWordCount: number,
  prefixMode: boolean
): { ok: boolean; reason?: string } {
  const slots = extractBlankSlots(text);
  if (slots.length !== expectedBlankCount) {
    return { ok: false, reason: `Expected exactly ${expectedBlankCount} blank${expectedBlankCount > 1 ? "s" : ""}.` };
  }
  const generatedWordCount = countWords(text);
  if (Math.abs(generatedWordCount - sourceWordCount) > 15) {
    return { ok: false, reason: "Length mismatch from source range." };
  }
  for (let i = 0; i < expectedBlankCount; i += 1) {
    const slot = slots[i];
    const ans = String(answerKey[i] || "").replace(/\s+/g, "").toLowerCase();
    if (!slot || !ans) return { ok: false, reason: `Missing answer at index ${i}.` };
    const tailAfterSlot = text.slice(slot.end).trim();
    if (!tailAfterSlot || /^[.!?]+$/.test(tailAfterSlot)) {
      return { ok: false, reason: "Blank cannot be final token." };
    }
    // Reject orphan trailing blanks like ". ac_____" appended after a complete sentence.
    let j = slot.start - 1;
    while (j >= 0 && /\s/.test(text[j] || "")) j -= 1;
    const prevChar = j >= 0 ? text.charAt(j) : "";
    if (/[.!?]/.test(prevChar)) {
      const tail = text.slice(slot.end).trim();
      // If nothing meaningful follows this slot, treat it as malformed append.
      if (!tail || /^[.!?]*$/.test(tail)) {
        return { ok: false, reason: "Orphan trailing blank token." };
      }
    }
    if (prefixMode) {
      if (!slot.prefix) return { ok: false, reason: "Expected prefix hint before blank." };
      const expectedMissing = ans.length - slot.prefix.length;
      if (expectedMissing < 1 || slot.missingCount !== expectedMissing) {
        return { ok: false, reason: "Answer length does not match blank length." };
      }
    } else if (slot.missingCount !== ans.length) {
      return { ok: false, reason: "Answer length does not match blank length." };
    }
  }
  return { ok: true };
}

app.post("/ocr/structure", async (req, res) => {
  try {
    const { text, preferredTaskType, visionSlots } = req.body as {
      text: string;
      preferredTaskType?: "context_completion" | "guided_reading";
      visionSlots?: Array<{ prefix?: string; missingCount?: number; confidence?: number }>;
    };
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required." });
    }

    const cleaned = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
    if (!cleaned) {
      return res.status(400).json({ error: "text is empty." });
    }
    const rawOcrText = normalizePrefixUnderscorePatterns(cleaned);

    const detectedFormat = classifyFormat(rawOcrText);
    const inferredTask =
      detectedFormat === "multiple_choice"
        ? "guided_reading"
        : detectedFormat === "prefix_blank" || detectedFormat === "full_blank"
        ? "context_completion"
        : "guided_reading";
    const taskType = preferredTaskType ?? inferredTask;

    if (taskType === "guided_reading") {
      const parsed = await parseMultipleChoice(rawOcrText);
      const normalizedText = [
        parsed.passage ? `Passage:\n${parsed.passage}` : null,
        `Question:\n${parsed.question}`,
        "Choices:",
        ...parsed.choices.map((c, idx) => `${String.fromCharCode(65 + idx)}) ${c}`),
        `Answer: ${String.fromCharCode(65 + parsed.correctIndex)}`,
      ]
        .filter(Boolean)
        .join("\n\n");
      const payload = {
        taskType,
        format: "multiple_choice" as const,
        item: parsed,
      };
      const debug = {
        rawOcrText,
        aiNormalizedText: normalizedText,
        normalizedText,
      };
      return res.json({
        ...payload,
        payload,
        debug,
        rawOcrText,
        aiNormalizedText: normalizedText,
        normalizedText,
        item: parsed,
      });
    }

    let aiNormalizedText = rawOcrText;
    const ENABLE_LEGACY_LLM_FALLBACK = false;
    if (generationProvider && ENABLE_LEGACY_LLM_FALLBACK) {
      const system =
        "You normalize OCR text for context-completion tasks. Return ONLY plain text.";
      const prompt = [
        "Clean OCR artifacts while preserving meaning.",
        "Keep blank markers as underscores (example: div___ or ____).",
        "Do not add choices.",
        "Do not add explanations.",
        `Input:\n${rawOcrText}`,
      ].join("\n");
      const llmOut = (await generationProvider.generateText(prompt, system)).trim();
      if (llmOut) {
        aiNormalizedText = normalizePrefixUnderscorePatterns(llmOut);
      }
    }

    let aiSlots = extractBlankSlots(aiNormalizedText);
    let structuredByFallbackLlm = false;
    let slotsWithConfidence = mergeSlotConfidence([], aiSlots);
    let slotInference = aiSlots.length > 0 ? "ai_direct" : "none";

    const validatedVisionSlots = Array.isArray(visionSlots)
      ? visionSlots
          .map((s, idx) => ({
            id: idx + 1,
            prefix: String(s.prefix || "").toLowerCase(),
            missingCount: Number(s.missingCount || 0),
            confidence: Number(s.confidence ?? 0.75),
          }))
          .filter(
            (s) =>
              /^[a-z]{0,4}$/.test(s.prefix) &&
              Number.isFinite(s.missingCount) &&
              s.missingCount >= 1 &&
              s.missingCount <= 10
          )
          .slice(0, 6)
      : [];
    if (validatedVisionSlots.length > 0) {
      const visionReconstructed = reconstructBlankDisplayFromAi(
        aiNormalizedText,
        validatedVisionSlots.map((s, idx) => ({
          index: idx,
          start: 0,
          end: 0,
          prefix: s.prefix,
          missingCount: s.missingCount,
          pattern: `${s.prefix}${"_".repeat(s.missingCount)}`,
          slotConfidence: s.confidence,
        }))
      );
      const recoveredSlots = extractBlankSlots(visionReconstructed.displayText);
      if (recoveredSlots.length > 0) {
        aiNormalizedText = visionReconstructed.displayText;
        aiSlots = recoveredSlots;
        slotsWithConfidence = aiSlots.map((slot, idx) => ({
          ...slot,
          slotConfidence: validatedVisionSlots[idx]?.confidence ?? 0.75,
        }));
        slotInference = "vision_ai";
      }
    }

    if (slotsWithConfidence.length === 0 && generationProvider) {
      const fallbackSystem =
        "You repair corrupted OCR for context-completion tasks. Return ONLY valid JSON.";
      const fallbackPrompt = [
        "The input is a broken OCR text for fill-in-the-blank.",
        "Output blanks using prefix+underscores only (example: fa__).",
        "Do NOT output a fully completed sentence.",
        "Return strict JSON:",
        "{\"displayText\":\"...\",\"slots\":[{\"id\":1,\"prefix\":\"fa\",\"missingCount\":2,\"confidence\":0.82}],\"slotCount\":1,\"notes\":\"...\"}",
        "Constraints: prefix 1-4 letters; missingCount 1-8; slotCount 1-6.",
        "displayText must contain each prefix+underscore pattern listed in slots.",
        `Input:\n${aiNormalizedText}`,
      ].join("\n");

      for (let attempt = 0; attempt < 2 && slotsWithConfidence.length === 0; attempt += 1) {
        const rawFallback = await generationProvider.generateText(fallbackPrompt, fallbackSystem);
        const parsedFallback = extractJsonObject<{
          displayText?: string;
          slots?: Array<{ id?: number; prefix: string; missingCount: number; confidence?: number }>;
        }>(rawFallback);
        if (!parsedFallback || typeof parsedFallback.displayText !== "string") continue;
        const repaired = normalizePrefixUnderscorePatterns(parsedFallback.displayText);
        const validatedSlots = validateStructuredSlots(repaired, parsedFallback.slots || []);
        if (validatedSlots.length === 0) continue;

        aiNormalizedText = repaired;
        aiSlots = extractBlankSlots(repaired);
        structuredByFallbackLlm = true;
        slotsWithConfidence = validatedSlots;
        slotInference = "fallback_llm";
      }
    }
    if (slotsWithConfidence.length === 0) {
      const fallbackSlots = fallbackRegexSlotExtract(aiNormalizedText);
      if (fallbackSlots.length > 0) {
        slotsWithConfidence = fallbackSlots;
        slotInference = "fallback_regex";
      } else {
        slotInference = "none";
      }
    }
    if (slotsWithConfidence.length > 6) {
      slotsWithConfidence = slotsWithConfidence
        .sort((a, b) => (b.slotConfidence ?? 0) - (a.slotConfidence ?? 0))
        .slice(0, 6)
        .sort((a, b) => a.start - b.start)
        .map((s, i) => ({ ...s, index: i }));
      if (slotInference === "ai_direct") {
        slotInference = "ai_direct_capped";
      }
    }
    const reconstructed = reconstructBlankDisplayFromAi(
      aiNormalizedText,
      slotsWithConfidence
    );
    const answerKey = reconstructed.answerKey;
    const cappedSlots = slotsWithConfidence.slice(0, 2).map((slot) => ({
      ...slot,
      contextSnippet: buildContextSnippet(reconstructed.displayText, slot.start, slot.end),
    }));
    const hasPrefix = cappedSlots.some((s) => s.prefix.length > 0);
    const extraction = {
      taskType: "context_completion" as const,
      blankCount: cappedSlots.length,
      hasPrefix,
      prefixMode: hasPrefix ? "hasPrefix" as const : "none" as const,
      textLengthBucket: textLengthBucket(reconstructed.displayText),
      cefr: estimateCefrLevel(reconstructed.displayText),
    };
    const payload = {
      taskType,
      format: classifyFormat(aiNormalizedText),
      displayText: reconstructed.displayText,
      sourceAnswerKey: answerKey,
      slotCount: cappedSlots.length,
      slots: cappedSlots.map((slot) => ({
        prefix: slot.prefix,
        missingCount: slot.missingCount,
        slotConfidence: slot.slotConfidence,
        contextSnippet: slot.contextSnippet,
      })),
      textFeatures: {
        wordCount: countWords(reconstructed.displayText),
        textLengthBucket: extraction.textLengthBucket,
        cefr: extraction.cefr,
        lexical: computeLexicalComplexity(reconstructed.displayText).L,
        structural: computeStructuralComplexity(reconstructed.displayText).S,
      },
      extraction,
    };
    const debug = {
      rawOcrText,
      aiNormalizedText,
      normalizedText: reconstructed.displayText,
      slotInference,
      structuredByFallbackLlm,
    };
    return res.json({
      ...payload,
      payload,
      debug,
      taskType,
      format: classifyFormat(aiNormalizedText),
      rawOcrText,
      aiNormalizedText,
      normalizedText: reconstructed.displayText,
      displayText: reconstructed.displayText,
      answerKey,
      slotCount: cappedSlots.length,
      slots: cappedSlots,
      slotInference,
      structuredByFallbackLlm,
      extraction,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
});

app.post("/generate/fill-blank", async (req, res) => {
  try {
    const { sourceText, target, mode, sourceAnswers, expectedBlankCount: expectedBlankCountHint, prefixMode } = req.body as {
      sourceText: string;
      target?: { L: number; S: number; A: number; R: number };
      mode?: "A" | "B";
      sourceAnswers?: string[];
      expectedBlankCount?: number;
      prefixMode?: "none" | "hasPrefix";
    };
    if (typeof sourceText !== "string") {
      return res.status(400).json({ error: "Expected { sourceText: string }" });
    }
    const cleanedSourceText = sourceText
      // OCR often injects underscores inside normal words (e.g., i__d_). Remove those artifacts.
      .replace(/(?<=[A-Za-z])_{1,3}(?=[A-Za-z])/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    const runId = randomUUID();
    const sourceId = createHash("sha1").update(cleanedSourceText).digest("hex").slice(0, 12);
    let stage:
      | "source_received"
      | "structure_loaded"
      | "stepA_text_generated"
      | "stepB_words_selected"
      | "stepC_blank_built"
      | "candidate_scored"
      | "accepted"
      | "validation_failed"
      | "similarity_rejected" = "source_received";
    const normalizeAnswerToken = (v: string) => String(v || "").replace(/\s+/g, "").toLowerCase();
    const normalizedSourceAnswers = new Set(
      (Array.isArray(sourceAnswers) ? sourceAnswers : [])
        .map((a) => normalizeAnswerToken(String(a || "")))
        .filter(Boolean)
    );
    const detectedFormat = classifyFormat(cleanedSourceText);
    if (detectedFormat === "multiple_choice") {
      return res.status(400).json({ error: `Format ${detectedFormat} not supported in v1.` });
    }
    // If OCR/normalization dropped blank markers, fall back to full_blank instead of hard-failing.
    const format = detectedFormat === "constructed_response" ? "full_blank" : detectedFormat;
    const extractedSlots = extractBlankSlots(cleanedSourceText).filter(
      (s) => s.prefix.length <= 4 && s.missingCount >= 1 && s.missingCount <= 8
    );
    // v1 cloze: keep generation flexible by limiting slot control to 1-2 blanks.
    const expectedBlankCount = Math.max(
      1,
      Math.min(
        Number.isFinite(expectedBlankCountHint as number)
          ? Number(expectedBlankCountHint)
          : extractedSlots.length || 1,
        2
      )
    );
    let candidates = generationProvider ? [] : generateFillBlankCandidates(cleanedSourceText);
    if (candidates.length === 0 && !generationProvider) {
      return res.status(422).json({
        error: "Could not generate a valid blank candidate from this source.",
      });
    }
    const sourceSlots = extractBlankSlots(cleanedSourceText);
    stage = "structure_loaded";
    // Canonicalize source answers for prefix blanks:
    // If UI sends only missing letters (e.g. "il"), also register full form (e.g. "fail").
    if (sourceSlots.length > 0 && normalizedSourceAnswers.size > 0) {
      for (const slot of sourceSlots) {
        if (!slot.prefix) continue;
        const prefixNorm = normalizeAnswerToken(slot.prefix);
        const answerSnapshot = Array.from(normalizedSourceAnswers);
        for (const ans of answerSnapshot) {
          if (!ans) continue;
          if (ans.startsWith(prefixNorm)) continue;
          if (ans.length === slot.missingCount) {
            normalizedSourceAnswers.add(`${prefixNorm}${ans}`);
          }
        }
      }
    }
    const slotPatternSource = sourceSlots.length > 0 ? sourceSlots : extractedSlots;
    const slotRules = slotPatternSource
      .slice(0, expectedBlankCount)
      .map((s) => ({
        missingCount: s.missingCount,
      }));
    const sourcePrefixMode =
      prefixMode === "hasPrefix"
        ? true
        : prefixMode === "none"
        ? false
        : slotPatternSource.some((s) => (s.prefix || "").length > 0);
    const sourceWordCount = countWords(cleanedSourceText);
    const sourceBucket = textLengthBucket(cleanedSourceText);
    const sourceCefr = estimateCefrLevel(cleanedSourceText);
    const sourceLex = computeLexicalComplexity(cleanedSourceText).L;
    const sourceStruct = computeStructuralComplexity(cleanedSourceText).S;
    const slotConstraintSummary =
      slotRules.length > 0
        ? slotRules
            .map((s) => `len:${s.missingCount}`)
            .join(", ")
        : "single_blank";

    // v2 pipeline: A) generate full text first, B) ask LLM which words to blank, C) blank deterministically.
    if (generationProvider) {
      const genSystem =
        "You generate English learning passages. Return ONLY valid JSON.";
      const genPrompt = [
        "Create one NEW paragraph/sentence for a context-completion item.",
        "Do not include blanks, underscores, choices, or answers.",
        "Use a different theme than the source text.",
        `Keep length around ${sourceWordCount} words (allowed range: ${Math.max(
          8,
          sourceWordCount - 10
        )} to ${sourceWordCount + 10}).`,
        `Target length bucket: ${sourceBucket} (source word count: ${sourceWordCount}).`,
        `Target CEFR: ${sourceCefr}.`,
        `Target lexical/structural style: L≈${sourceLex.toFixed(2)}, S≈${sourceStruct.toFixed(2)}.`,
        "Output grammatically natural English only. No merged words, no typos.",
        expectedBlankCount > 1
          ? `Write enough content to support ${expectedBlankCount} blanks naturally.`
          : "Write enough content to support one meaningful blank.",
        "Return JSON: {\"text\":\"...\"}",
      ].join("\n");

      for (let i = 0; i < 2; i += 1) {
        const raw = await generationProvider.generateText(genPrompt, genSystem);
        const parsed = extractJson(raw) as { text?: unknown } | null;
        const fullText = String(parsed?.text || "").trim();
        if (!fullText) continue;
        if (/(?:_\s*){2,}/.test(fullText)) continue;
        stage = "stepA_text_generated";

        const pickSystem =
          "You choose words to blank for cloze tasks. Return ONLY valid JSON.";
        const pickPrompt = [
          "Choose words from the text that should be blanked.",
          `Need exactly ${expectedBlankCount} word(s).`,
          slotRules.length > 0
            ? `Slot constraints by index (missing length reference): ${slotConstraintSummary}.`
            : "No explicit slot constraints.",
          sourcePrefixMode
            ? "Output format uses prefix+underscores, but do NOT copy source prefix."
            : "Output format uses full underscores.",
          normalizedSourceAnswers.size > 0
            ? `Do NOT choose any of these source answers: ${Array.from(normalizedSourceAnswers).join(
                ", "
              )}.`
            : "Avoid reusing obvious source answer words.",
          "Each chosen word must appear exactly in the text.",
          sourcePrefixMode
            ? "Return JSON: {\"words\":[\"w1\",\"w2\"],\"prefixLengths\":[2,2]} where prefixLengths are 1-3."
            : "Return JSON: {\"words\":[\"w1\",\"w2\"]}.",
          `Text:\n${fullText}`,
        ].join("\n");

        const pickRaw = await generationProvider.generateText(pickPrompt, pickSystem);
        const pickParsed = extractJson(pickRaw) as {
          words?: unknown[];
          chosenWord?: unknown;
          prefixLengths?: unknown[];
        } | null;
        const chosenWords =
          Array.isArray(pickParsed?.words)
            ? pickParsed!.words.map((w) => String(w || "").trim()).filter(Boolean)
            : pickParsed?.chosenWord
            ? [String(pickParsed.chosenWord).trim()]
            : [];
        const chosenPrefixLengths = Array.isArray(pickParsed?.prefixLengths)
          ? pickParsed.prefixLengths
              .map((x) => Number(x))
              .filter((n) => Number.isFinite(n))
              .map((n) => Math.max(1, Math.min(3, n)))
          : undefined;
        if (chosenWords.length > 0) {
          stage = "stepB_words_selected";
        }

        const blanked = buildBlankedCandidateFromFullText(
          fullText,
          slotRules,
          expectedBlankCount,
          chosenWords,
          chosenPrefixLengths,
          sourcePrefixMode
        );
        if (!blanked) continue;
        const shape = validateBlankedCandidateShape(
          blanked.text,
          blanked.answerKey,
          expectedBlankCount,
          sourceWordCount,
          sourcePrefixMode
        );
        if (!shape.ok) continue;
        stage = "stepC_blank_built";
        const firstAnswer = blanked.answerKey[0];
        if (!firstAnswer) continue;
        if (
          blanked.answerKey.some((a) => normalizedSourceAnswers.has(normalizeAnswerToken(a)))
        ) {
          continue;
        }
        const generatedCandidate = {
          text: blanked.text,
          correct: firstAnswer,
          answerKey: blanked.answerKey,
          distractors: buildDistractorsFromText(fullText, firstAnswer),
          steps: sourceWordCount >= 12 ? 2 : 1,
        };
        candidates = [generatedCandidate, ...candidates];
        break;
      }
    }
    if (!target) {
      if (candidates.length === 0) {
        stage = "validation_failed";
        return res.status(422).json({
          error: generationProvider
            ? "Could not build deterministic candidates. Please retry."
            : "Could not generate a valid blank candidate from this source.",
          runId,
          sourceId,
          debug: { stage },
        });
      }
      const valid = candidates.find(
        (c) =>
          validateGenerated(c.text, format, { expectedBlankCount }).ok &&
          !normalizedSourceAnswers.has(normalizeAnswerToken(c.correct))
      );
      const nonReused = candidates.find(
        (c) => !normalizedSourceAnswers.has(normalizeAnswerToken(c.correct))
      );
      const chosen = valid || nonReused || candidates[0];
      if (!chosen) {
        stage = "validation_failed";
        return res.status(422).json({
          error: "Could not generate a valid blank candidate from this source.",
          runId,
          sourceId,
          debug: { stage },
        });
      }
      const slots = extractBlankSlots(chosen.text);
      stage = "accepted";
      return res.json({
        item: chosen,
        displayText: chosen.text,
        answerKey: (chosen as { answerKey?: string[] }).answerKey || [chosen.correct],
        answers: (chosen as { answerKey?: string[] }).answerKey || [chosen.correct],
        slots,
        candidates,
        format,
        runId,
        sourceId,
        candidateId: `${runId}:deterministic:0`,
        debug: { stage },
      });
    }
    const scored: Array<{ item: typeof candidates[number]; distance: number; similarity: number; jaccard: number }> = [];
    const normalizedSource = normalizeForSimilarity(cleanedSourceText);
    const sourceVec = await embeddingProvider.embedText(normalizedSource, 8);
    for (const c of candidates) {
      if (normalizedSourceAnswers.has(normalizeAnswerToken(c.correct))) {
        continue;
      }
      const lexical = computeLexicalComplexity(c.text);
      const structural = computeStructuralComplexity(c.text);
      const correctVec = await embeddingProvider.embedText(c.correct, 8);
      const distractorVecs = await embeddingProvider.embedTexts(c.distractors, 8);
      const A = semanticAmbiguityA(correctVec, distractorVecs);
      const R = normalizeReasoningDepth(c.steps, 5);
      const d =
        (lexical.L - target.L) ** 2 +
        (structural.S - target.S) ** 2 +
        (A - target.A) ** 2 +
        (R - target.R) ** 2;
      const normalizedCandidate = normalizeForSimilarity(c.text);
      const candidateVec = await embeddingProvider.embedText(normalizedCandidate, 8);
      const similarity = cosineSimilarity(sourceVec, candidateVec);
      const jaccard = tokenJaccard(normalizedSource, normalizedCandidate);
      scored.push({ item: c, distance: Math.sqrt(d), similarity, jaccard });
    }
    stage = "candidate_scored";
    scored.sort((a, b) => a.distance - b.distance);
    // Cloze-specific thresholds:
    // - allow higher semantic similarity to keep same difficulty shape
    // - tighten lexical overlap to avoid near-copy
    const MIN_SIM = 0.35;
    const MAX_SIM = 0.93;
    const MAX_JACCARD = 0.6;
    let attempts = 0;
    let best =
      scored.find(
        (s) =>
          validateGenerated(s.item.text, format, { expectedBlankCount }).ok &&
          s.similarity >= MIN_SIM &&
          s.similarity <= MAX_SIM &&
          s.jaccard <= MAX_JACCARD
      ) || null;

    while (!best && attempts < 2) {
      attempts += 1;
      const softened = scored.map((s) => ({
        ...s,
        item: { ...s.item, text: softenSimilarity(s.item.text) },
      }));
      for (const s of softened) {
        const normalizedCandidate = normalizeForSimilarity(s.item.text);
        const softenedVec = await embeddingProvider.embedText(normalizedCandidate, 8);
        s.similarity = cosineSimilarity(sourceVec, softenedVec);
        s.jaccard = tokenJaccard(normalizedSource, normalizedCandidate);
      }
      best =
        softened.find(
          (s) =>
            validateGenerated(s.item.text, format, { expectedBlankCount }).ok &&
            s.similarity >= MIN_SIM &&
            s.similarity <= MAX_SIM &&
            s.jaccard <= MAX_JACCARD
        ) || null;
      if (best) {
        const slots = extractBlankSlots(best.item.text);
        stage = "accepted";
        return res.json({
          item: best.item,
          answerKey: (best.item as { answerKey?: string[] }).answerKey || [best.item.correct],
          answers: (best.item as { answerKey?: string[] }).answerKey || [best.item.correct],
          slots,
          candidates: scored,
          format,
          similarity: best.similarity,
          jaccard: best.jaccard,
          similarityRange: { min: MIN_SIM, max: MAX_SIM, maxJaccard: MAX_JACCARD },
          runId,
          sourceId,
          candidateId: `${runId}:best:0`,
          debug: { stage },
        });
      }
    }

    // Prefer deterministic output over free-form LLM rewrite when possible.
    // This avoids invalid pseudo-answers (e.g., non-words) from legacy fallback prompts.
    const deterministicFallback = scored.find(
      (s) =>
        validateGenerated(s.item.text, format, { expectedBlankCount }).ok &&
        // Avoid returning near-copy garbage when overlap is extremely high.
        s.jaccard <= 0.8
    );
    if (deterministicFallback) {
      const slots = extractBlankSlots(deterministicFallback.item.text);
      stage = "accepted";
      return res.json({
        item: deterministicFallback.item,
        displayText: deterministicFallback.item.text,
        answerKey:
          (deterministicFallback.item as { answerKey?: string[] }).answerKey || [
            deterministicFallback.item.correct,
          ],
        answers:
          (deterministicFallback.item as { answerKey?: string[] }).answerKey || [
            deterministicFallback.item.correct,
          ],
        slots,
        candidates: scored,
        format,
        similarity: deterministicFallback.similarity,
        jaccard: deterministicFallback.jaccard,
        similarityRange: { min: MIN_SIM, max: MAX_SIM, maxJaccard: MAX_JACCARD },
        similarityWarning: "Returned deterministic candidate outside similarity range.",
        runId,
        sourceId,
        candidateId: `${runId}:deterministic-fallback:0`,
        debug: { stage },
      });
    }

    let llmAttempted = false;
    let llmLastSim: number | null = null;
    let llmLastJaccard: number | null = null;
    let llmLastText: string | null = null;
    let llmLastValidationReason: string | null = null;
    const setValidationReason = (reason: string) => {
      llmLastValidationReason = reason;
    };
    if (generationProvider) {
      const base = candidates[0] || {
        text: sourceText,
        correct: "",
        distractors: [] as string[],
        steps: 2,
      };
      const pattern = getBlankPattern(cleanedSourceText);
      const system =
        "You generate fill-in-the-blank questions. Return ONLY valid JSON. Never copy the original sentence.";
      const prompt = [
        "Create ONE new sentence similar in meaning but NOT a copy.",
        "Change the subject and clause order. Replace key phrases with synonyms.",
        "Do NOT reuse any 3-word sequence from the original.",
        "Ensure at least 30% of content words are different.",
        format === "prefix_blank"
          ? "Use prefix+underscores blank format, but DO NOT reuse source prefix."
          : "Keep EXACT one blank marked with ____.",
        expectedBlankCount > 1
          ? `Return JSON: {"text":"...", "answers":["..."]} with exactly ${expectedBlankCount} answers in order.`
          : "Return JSON: {\"text\":\"...\", \"answer\":\"...\"}",
        expectedBlankCount > 1
          ? `For each answers[i], obey slot rule i (length reference): ${slotConstraintSummary}.`
          : "",
        "Do not add choices or explanations.",
        target
          ? `Target difficulty profile: L=${target.L.toFixed(2)}, S=${target.S.toFixed(
              2
            )}, A=${target.A.toFixed(2)}, R=${target.R.toFixed(2)}.`
          : "Target difficulty profile: not provided.",
        `Slot constraints: ${slotConstraintSummary}`,
        `Original: ${cleanedSourceText}`,
      ].join("\n");

      for (let i = 0; i < 3; i += 1) {
        llmAttempted = true;
        const raw = await generationProvider.generateText(prompt, system);
        llmLastText = raw;
        const parsed = extractJson(raw);
        if (!parsed) {
          llmLastValidationReason = "LLM response was not valid JSON.";
          continue;
        }
        let rewritten = parsed.text;
        rewritten = normalizePrefixUnderscorePatterns(rewritten);
        const parsedAnswerRaw =
          Array.isArray((parsed as { answers?: unknown }).answers) &&
          (parsed as { answers: unknown[] }).answers.length > 0
            ? String((parsed as { answers: unknown[] }).answers[0] || "").trim()
            : (parsed as { answer?: unknown }).answer != null
            ? String((parsed as { answer: unknown }).answer || "").trim()
            : "";

        // Auto-repair: if model forgets blank markers, inject one deterministically.
        if (!/(_\s*){2,}/.test(rewritten) && expectedBlankCount === 1) {
          if (format === "prefix_blank" && pattern) {
            const token = `${pattern.prefix}${pattern.blanks}`;
            if (parsedAnswerRaw) {
              const escaped = parsedAnswerRaw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const ansRegex = new RegExp(`\\b${escaped}\\b`, "i");
              if (ansRegex.test(rewritten)) {
                rewritten = rewritten.replace(ansRegex, token);
              } else {
                rewritten = `${rewritten} ${token}`.trim();
              }
            } else {
              rewritten = `${rewritten} ${token}`.trim();
            }
          } else {
            const token = "____";
            if (parsedAnswerRaw) {
              const escaped = parsedAnswerRaw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const ansRegex = new RegExp(`\\b${escaped}\\b`, "i");
              if (ansRegex.test(rewritten)) {
                rewritten = rewritten.replace(ansRegex, token);
              } else {
                rewritten = `${rewritten} ${token}`.trim();
              }
            } else {
              rewritten = `${rewritten} ${token}`.trim();
            }
          }
        }
        if (format === "prefix_blank" && pattern && expectedBlankCount === 1) {
          const replacePrefixBlank = (input: string) => {
            const prefixBlankRegex = /([A-Za-z]+)\s*((?:_\s*){2,})/;
            if (prefixBlankRegex.test(input)) {
              return input.replace(prefixBlankRegex, `${pattern.prefix}${pattern.blanks}`);
            }
            const blankRegex = /(_\s*){2,}/;
            if (blankRegex.test(input)) {
              return input.replace(blankRegex, `${pattern.prefix}${pattern.blanks}`);
            }
            return input;
          };
          rewritten = replacePrefixBlank(rewritten);
        }
        if (expectedBlankCount === 1 && parsedAnswerRaw) {
          if (format === "prefix_blank") {
            rewritten = harmonizeSingleBlankWithAnswer(
              rewritten,
              "prefix_blank",
              parsedAnswerRaw,
              pattern
            );
          } else {
            rewritten = harmonizeSingleBlankWithAnswer(
              rewritten,
              "full_blank",
              parsedAnswerRaw,
              null
            );
          }
        }
        const validation = validateGenerated(rewritten, format, { expectedBlankCount });
        if (!validation.ok) {
          llmLastValidationReason = validation.reason || "Format validation failed.";
          continue;
        }
        let answerList: string[] = [];
        if (Array.isArray((parsed as { answers?: unknown }).answers)) {
          answerList = (parsed as { answers: unknown[] }).answers
            .map((a) => String(a || "").trim())
            .filter(Boolean);
        } else if ((parsed as { answer?: unknown }).answer != null) {
          answerList = [String((parsed as { answer: unknown }).answer).trim()];
        }

        if (format === "prefix_blank" && pattern && expectedBlankCount === 1) {
          const rawAnswer = String(answerList[0] || "").trim();
          const rawOriginal = String((parsed as { original?: string }).original || "").trim();
          const fullAnswer = rawAnswer.replace(/\s+/g, "").toLowerCase().replace(/[^a-z]/g, "");
          if (fullAnswer.length < 3) {
            llmLastValidationReason = "Answer too short for prefix blank.";
            continue;
          }
          rewritten = harmonizePrefixBlankWithoutSourcePrefix(rewritten, fullAnswer);
          answerList = [fullAnswer];
          if (rawOriginal) {
            const normalizedOriginal = rawOriginal.toLowerCase().replace(/\s+/g, "").replace(/[^a-z]/g, "");
            if (answerList[0].toLowerCase() === normalizedOriginal) {
              llmLastValidationReason = "Answer reused the original word.";
              continue;
            }
          }
        }
        if (answerList.length === 0) {
          llmLastValidationReason = "Missing answer(s).";
          continue;
        }
        if (expectedBlankCount > 1 && answerList.length !== expectedBlankCount) {
          llmLastValidationReason = `Expected ${expectedBlankCount} answers.`;
          continue;
        }
        if (expectedBlankCount > 1 && slotRules.length === expectedBlankCount) {
          let multiRuleOk = true;
          for (let idx = 0; idx < expectedBlankCount; idx += 1) {
            const rule = slotRules[idx];
            const ans = String(answerList[idx] || "").replace(/\s+/g, "").toLowerCase();
            if (!ans) {
              llmLastValidationReason = `Missing answer at index ${idx}.`;
              multiRuleOk = false;
              break;
            }
            if (rule && rule.missingCount > 0 && Math.abs(ans.length - (rule.missingCount + 2)) > 4) {
              llmLastValidationReason = `Answer ${idx + 1} length is far from target range.`;
              multiRuleOk = false;
              break;
            }
            // v1: do not hard-fail by length on multi-blank OCR inputs.
            answerList[idx] = ans;
          }
          if (!multiRuleOk) continue;
        }
        if (
          answerList.some((a) => normalizedSourceAnswers.has(normalizeAnswerToken(String(a || ""))))
        ) {
          llmLastValidationReason = "Answer reused from source.";
          continue;
        }
        const candidateVec = await embeddingProvider.embedText(
          normalizeForSimilarity(rewritten),
          8
        );
        const sim = cosineSimilarity(sourceVec, candidateVec);
        const jaccard = tokenJaccard(normalizedSource, normalizeForSimilarity(rewritten));
        llmLastSim = sim;
        llmLastJaccard = jaccard;
        if (sim >= MIN_SIM && sim <= MAX_SIM && jaccard <= MAX_JACCARD) {
          const generatedItem = {
            text: rewritten,
            correct: answerList[0],
            distractors: buildDistractorsFromText(rewritten, answerList[0]),
            steps: base.steps,
          };
          const slots = extractBlankSlots(generatedItem.text);
          stage = "accepted";
          return res.json({
            item: generatedItem,
            displayText: generatedItem.text,
            answerKey: answerList,
            answers: answerList,
            slots,
            candidates: scored,
            format,
            similarity: sim,
            jaccard,
            similarityRange: { min: MIN_SIM, max: MAX_SIM, maxJaccard: MAX_JACCARD },
            runId,
            sourceId,
            candidateId: `${runId}:llm:${i}`,
            debug: { stage },
          });
        }
      }
    }

    // Repair pass: minimally rewrite best candidate, then re-evaluate.
    if (generationProvider && scored.length > 0) {
      const base = scored[0];
      const repairSystem =
        "You repair fill-blank questions. Return ONLY valid JSON. Keep blank pattern unchanged.";
      const repairPrompt = [
        "Rewrite the sentence minimally to reduce overlap with source while keeping meaning.",
        "Keep blank pattern exactly the same (prefix and underscore count).",
        "Do not change answer length constraints.",
        "Return JSON: {\"text\":\"...\", \"answer\":\"...\"}",
        `Source: ${cleanedSourceText}`,
        `Candidate: ${base.item.text}`,
        `Answer: ${base.item.correct}`,
      ].join("\n");
      const repairedRaw = await generationProvider.generateText(repairPrompt, repairSystem);
      const repaired = extractJson(repairedRaw);
      if (repaired && typeof repaired.text === "string" && typeof repaired.answer === "string") {
      const validation = validateGenerated(repaired.text, format, { expectedBlankCount });
        if (validation.ok) {
          const normalizedCandidate = normalizeForSimilarity(repaired.text);
          const repairedVec = await embeddingProvider.embedText(normalizedCandidate, 8);
          const sim = cosineSimilarity(sourceVec, repairedVec);
          const jaccard = tokenJaccard(normalizedSource, normalizedCandidate);
          if (sim >= MIN_SIM && sim <= MAX_SIM && jaccard <= MAX_JACCARD) {
            const repairedItem = {
              text: repaired.text,
              correct: repaired.answer,
              distractors: buildDistractorsFromText(repaired.text, repaired.answer),
              steps: base.item.steps,
            };
            const slots = extractBlankSlots(repairedItem.text);
            stage = "accepted";
            return res.json({
              item: repairedItem,
              displayText: repairedItem.text,
              answerKey: [repairedItem.correct],
              answers: [repairedItem.correct],
              slots,
              candidates: scored,
              format,
              similarity: sim,
              jaccard,
              repaired: true,
              similarityRange: { min: MIN_SIM, max: MAX_SIM, maxJaccard: MAX_JACCARD },
              runId,
              sourceId,
              candidateId: `${runId}:repair:0`,
              debug: { stage },
            });
          }
        }
      }
    }

    // Fallback for v1 UX: return the closest candidate even if similarity thresholds are not met.
    const fallback = scored.find(
      (s) => validateGenerated(s.item.text, format, { expectedBlankCount }).ok
    );
    if (fallback) {
      const slots = extractBlankSlots(fallback.item.text);
      stage = "accepted";
      return res.json({
        item: fallback.item,
        displayText: fallback.item.text,
        answerKey: (fallback.item as { answerKey?: string[] }).answerKey || [fallback.item.correct],
        answers: (fallback.item as { answerKey?: string[] }).answerKey || [fallback.item.correct],
        slots,
        candidates: scored,
        format,
        similarity: fallback.similarity,
        jaccard: fallback.jaccard,
        similarityRange: { min: MIN_SIM, max: MAX_SIM, maxJaccard: MAX_JACCARD },
        similarityWarning: "Returned best candidate outside similarity range.",
        runId,
        sourceId,
        candidateId: `${runId}:fallback:0`,
        debug: { stage },
      });
    }

    const errorType =
      llmLastValidationReason != null
        ? "VALIDATION_FAILED"
        : scored.length > 0
        ? "SIMILARITY_REJECTED"
        : "NO_CANDIDATE";
    stage = errorType === "VALIDATION_FAILED" ? "validation_failed" : "similarity_rejected";
    return res.status(422).json({
      error:
        errorType === "VALIDATION_FAILED"
          ? "Generated candidate failed format validation. Please retry."
          : "Generated problem too similar to source. Please try again.",
      errorType,
      runId,
      sourceId,
      similarityRange: { min: MIN_SIM, max: MAX_SIM, maxJaccard: MAX_JACCARD },
      debug: {
        stage,
        llmAttempted,
        llmLastSim,
        llmLastJaccard,
        llmLastText,
        llmLastValidationReason,
        topCandidates: scored
          .slice(0, 3)
          .map((s) => ({ similarity: s.similarity, jaccard: s.jaccard })),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
});

app.post("/generate/mc", async (req, res) => {
  try {
    const { sourceText, target, mode, inferenceStyle } = req.body as GenerateMcRequest;
    const badRequest = (message: string, extra?: Partial<GenerateMcError>) =>
      res.status(400).json({
        ok: false,
        apiVersion: API_VERSION,
        error: message,
        errorType: "BAD_REQUEST",
        ...extra,
      } satisfies GenerateMcError);
    if (!sourceText || typeof sourceText !== "string") {
      return badRequest("sourceText is required.");
    }
    const runId = randomUUID();
    const sourceId = createHash("sha1").update(sourceText).digest("hex").slice(0, 12);
    let stage:
      | "source_received"
      | "source_parsed"
      | "passage_generated"
      | "candidate_generated"
      | "validation_failed"
      | "similarity_rejected"
      | "accepted" = "source_received";
    if (!generationProvider) {
      return badRequest("Generation provider not configured.");
    }
    if (mode === "B") {
      return badRequest("Mode B is planned for a future release. v1 supports Mode A only.");
    }
    const sourceItem = await parseMultipleChoice(sourceText);
    stage = "source_parsed";
    const useComboStyle = detectJapaneseCombinationStyle(sourceText);
    const statementLabels = useComboStyle ? extractJapaneseStatementLabels(sourceText) : [];
    const expectedSubtype = sourceItem.subtype || (useComboStyle ? "combo" : "standard");
    const sourceStatements = useComboStyle ? extractComboStatements(sourceText) : [];
    const minSim = 0.4;
    const maxSim = expectedSubtype === "combo" ? 0.92 : 0.85;
    const maxJaccard = 0.75;

    const rawPassage = extractPassageFromRaw(sourceText);
    const hasPassage =
      Boolean(sourceItem.passage && sourceItem.passage.trim()) ||
      countWords(rawPassage) >= 40;
    if (hasPassage && !sourceItem.passage && rawPassage.trim().length > 0) {
      sourceItem.passage = rawPassage;
    }
    const passageLength = hasPassage
      ? countWords(sourceItem.passage && sourceItem.passage.trim() ? sourceItem.passage : rawPassage)
      : 0;
    const passageMin = hasPassage ? Math.max(60, passageLength - 15) : 0;
    const passageMax = hasPassage ? passageLength + 15 : 0;
    const choiceCount = 4;
    const passageHint = hasPassage
      ? `Passage length: ${passageMin}-${passageMax} words.`
      : "No passage. Only a question.";

    const system =
      "You generate inference multiple-choice questions. Return ONLY valid JSON.";
    let fixedPassage: string | null = null;
    let fixedPassageWarning: string | null = null;
    if (hasPassage && !useComboStyle) {
      const passageSystem = "You generate passages only. Return ONLY the passage text.";
      const passagePrompt = [
        `Write a passage between ${passageMin}-${passageMax} words.`,
        "Topic can be different from the source.",
        "No bullet points. No titles. Plain paragraphs only.",
      ].join("\n");
      const passageAttempts = 3;
      let closest: { text: string; diff: number; len: number } | null = null;
      for (let i = 0; i < passageAttempts; i += 1) {
        const candidate = (await generationProvider.generateText(passagePrompt, passageSystem)).trim();
        const len = countWords(candidate);
        if (len >= passageMin && len <= passageMax) {
          fixedPassage = candidate;
          break;
        }
        if (len > 0) {
          const diff = Math.abs(len - passageLength);
          if (!closest || diff < closest.diff) {
            closest = { text: candidate, diff, len };
          }
        }
      }
      if (!fixedPassage && closest) {
        const allowedDiff = Math.max(60, Math.round(passageLength * 0.35));
        if (closest.diff <= allowedDiff) {
          fixedPassage = closest.text;
          fixedPassageWarning = `Passage length ${closest.len} words (target ${passageLength}).`;
        }
      }
      if (!fixedPassage) {
        const fallback = sourceItem.passage || rawPassage;
        if (fallback && fallback.trim().length > 0) {
          fixedPassage = fallback.trim();
          fixedPassageWarning = "Used source passage as fallback.";
        }
      }
      if (!fixedPassage) {
        return badRequest("Failed to generate passage within length range.");
      }
      stage = "passage_generated";
    }
    const themeKeywords: string[] = [];
    const choiceIntent = null;
    const sourceStructure = null;
    const candidateCount = 1;
    let sourceCombined =
      expectedSubtype === "combo"
        ? normalizeForSimilarity(extractStatementText(sourceText))
        : normalizeForSimilarity(buildCombinedText(sourceItem));
    if (!sourceCombined.trim()) {
      sourceCombined = normalizeForSimilarity(buildCombinedText(sourceItem));
    }
    const sourceVec = await embeddingProvider.embedText(sourceCombined, 8);
    const sourceCorrect = sourceItem.choices[sourceItem.correctIndex] || "";
    const prompt = [
      "Create a NEW multiple-choice question that matches the input format.",
      "Do NOT copy the source. Do NOT reuse any 3-word sequence.",
      `Generate ${candidateCount} candidates.`,
      `Keep exactly ${choiceCount} choices with exactly 1 correct answer.`,
      `Your choices array MUST have exactly ${choiceCount} items.`,
      "Question type: inference only.",
      inferenceStyle === "fact_based"
        ? "Inference style: fact-based (evidence-driven, objective tone)."
        : inferenceStyle === "intent_based"
        ? "Inference style: intent-based (speaker/actor goal and motivation)."
        : inferenceStyle === "emotional"
        ? "Inference style: emotional (attitude, feeling, tone inference)."
        : "Inference style: fact-based by default.",
      "Use the same language as the source.",
      useComboStyle
        ? `Match the Japanese combination format: include statements labeled ${statementLabels.length ? statementLabels.join(", ") : "ア, イ, ウ, エ"} and choices like '1. アイ' '2. アウ' etc. Use the same number of statements as the source. The statements must be included in the output. Use different concepts than the source and avoid close paraphrase.`
        : "Match the overall style and structure of the source.",
      "",
      "",
      useComboStyle
        ? "For combo format, set passage to null. Put the instruction line and the ア〜エ statements in the question field only. Do NOT include any long explanatory passage."
        : "",
      hasPassage && !useComboStyle
        ? `Use this passage exactly and set it as the passage field:\n${fixedPassage ?? ""}`
        : "",
      "The question field must NOT include the choices. Choices must appear only in the choices array.",
      "",
      "Return ONLY valid JSON in a single line. No markdown, no code fences.",
      passageHint,
      target
        ? `Target profile (L/S/A/R): ${target.L.toFixed(2)}, ${target.S.toFixed(
            2
          )}, ${target.A.toFixed(2)}, ${target.R.toFixed(2)}.`
        : "Target profile: not provided.",
      "Return JSON: {\"candidates\":[{\"passage\": string|null, \"question\": string, \"choices\": [string,...], \"correctIndex\": 0-(choices.length-1)}]}",
      useComboStyle
        ? "Choices may include numbering like '1. アイ' if that matches the source."
        : "Choices must be plain text (no labels).",
      `Source:\n${sourceText}`,
    ].join("\n");

    let llmAttempted = false;
    let llmLastSim: number | null = null;
    let llmLastJaccard: number | null = null;
    let llmLastText: string | null = null;
    let llmLastValidationReason: string | null = null;
    const setValidationReason = (reason: string) => {
      llmLastValidationReason = reason;
    };

    const maxAttempts = expectedSubtype === "combo" ? 3 : 3;
    let best: {
      item: MultipleChoiceItem;
      sim: number;
      jaccard: number;
      similarityBreakdown: {
        passage: number | null;
        question: number | null;
        correctChoice: number | null;
        distractors: number | null;
        choices: number | null;
      };
      choiceStructure: {
        correctMeanSim: number;
        distractorMeanSim: number;
        distractorVariance: number;
        isolationIndex: number;
      } | null;
      score: number;
      similarityWarning?: string;
    } | null = null;
    let softAccepted: { item: MultipleChoiceItem; reason: string } | null = null;
    let bestFallback: {
      item: MultipleChoiceItem;
      sim: number;
      jaccard: number;
      similarityBreakdown: {
        passage: number | null;
        question: number | null;
        correctChoice: number | null;
        distractors: number | null;
        choices: number | null;
      };
      choiceStructure: {
        correctMeanSim: number;
        distractorMeanSim: number;
        distractorVariance: number;
        isolationIndex: number;
      } | null;
      score: number;
      rejectionReason: string;
    } | null = null;

    for (let i = 0; i < maxAttempts; i += 1) {
      llmAttempted = true;
      const raw = await generationProvider.generateText(prompt, system);
      llmLastText = raw;
      const candidates = extractCandidates<MultipleChoiceItem>(raw);
      if (candidates.length === 0) {
        setValidationReason("LLM response was not valid JSON.");
        continue;
      }
      for (const parsed of candidates) {
        stage = "candidate_generated";
        parsed.question = dedupeQuestionLines(parsed.question);
        parsed.choices = parsed.choices.map(normalizeChoice);
        const repaired = coerceChoiceCount(parsed, choiceCount);
        if (!repaired) {
          setValidationReason("Choice count mismatch.");
          continue;
        }
        parsed.choices = repaired.choices;
        parsed.correctIndex = repaired.correctIndex;
        if (hasPassage && !useComboStyle && fixedPassage) {
          parsed.passage = fixedPassage;
          parsed.question = stripEmbeddedPassage(parsed.question, fixedPassage);
        }
        const staticIssue = validateMultipleChoiceStrict(parsed, {
          expectedChoiceCount: choiceCount,
          requireInference: true,
          passageText: parsed.passage || fixedPassage || sourceItem.passage || "",
        });
        if (staticIssue) {
          setValidationReason(staticIssue);
          if (!softAccepted) {
            const basicIssue = validateMultipleChoice(parsed);
            if (!basicIssue && !questionContainsChoices(parsed.question)) {
              softAccepted = { item: parsed, reason: staticIssue };
            }
          }
          continue;
        }
        if (questionContainsChoices(parsed.question)) {
          setValidationReason("Question contains embedded choices.");
          continue;
        }
        if (expectedSubtype === "combo" && !detectComboChoices(parsed.choices)) {
          setValidationReason("Combo choice format mismatch.");
          continue;
        }
        const error = validateMultipleChoice(parsed);
        if (error) {
          setValidationReason(error);
          continue;
        }
        if (hasPassage && !useComboStyle) {
          if (!parsed.passage || !parsed.passage.trim()) {
            setValidationReason("Missing passage.");
            continue;
          }
        } else if (hasPassage && expectedSubtype === "combo") {
          parsed.passage = null;
        }
        if (hasPassage && parsed.passage && !useComboStyle && !fixedPassage) {
          const genLen = countWords(parsed.passage);
          if (genLen < passageMin || genLen > passageMax) {
            setValidationReason("Passage length out of range.");
            continue;
          }
        }
        if (!hasPassage && parsed.passage && parsed.passage.trim().length > 0) {
          parsed.passage = null;
        }
        let structureOk = true;
        if (expectedSubtype === "combo") {
          const combinedText = `${parsed.passage ?? ""}\n${parsed.question}\n${parsed.choices.join("\n")}`;
          const statements = extractComboStatements(combinedText);
          if (statements.length < (statementLabels.length || 4)) {
            setValidationReason("Missing combo statements.");
            continue;
          }
          if (isComboTooSimilar(sourceStatements, statements)) {
            setValidationReason("Combo statements too similar to source.");
            continue;
          }
          const statementSim = comboStatementSimilarityMetrics(sourceStatements, statements);
          if (statementSim.avgMaxJaccard > 0.58 || statementSim.maxJaccard > 0.72) {
            setValidationReason(
              `Combo statement difference too small (avg=${statementSim.avgMaxJaccard.toFixed(
                3
              )}, max=${statementSim.maxJaccard.toFixed(3)}).`
            );
            continue;
          }
          if (!comboHasNovelTerms(sourceStatements, statements, 2)) {
            setValidationReason("Insufficient novel terms in combo statements.");
            continue;
          }
        }
        const correctChoice = parsed.choices[parsed.correctIndex];
        if (
          expectedSubtype !== "combo" &&
          correctChoice &&
          correctChoice.trim().toLowerCase() === sourceCorrect.toLowerCase()
        ) {
          setValidationReason("Correct choice unchanged from source.");
          continue;
        }
        let combined =
          expectedSubtype === "combo"
            ? normalizeForSimilarity(
                extractStatementText(
                  `${parsed.passage ?? ""}\n${parsed.question}\n${parsed.choices.join("\n")}`
                )
              )
            : normalizeForSimilarity(buildCombinedText(parsed));
        if (!combined.trim()) {
          const fallbackText = parsed.passage ? parsed.passage : parsed.question;
          combined = normalizeForSimilarity(
            expectedSubtype === "combo" ? extractStatementText(fallbackText) : fallbackText
          );
          if (!combined.trim()) {
            combined = normalizeForSimilarity(buildCombinedText(parsed));
          }
        }
        const candidateVec = await embeddingProvider.embedText(combined, 8);
        const sim = cosineSimilarity(sourceVec, candidateVec);
        const jaccard = tokenJaccard(sourceCombined, combined);
        const allowHighSimCombo =
          expectedSubtype === "combo" &&
          structureOk &&
          sim >= minSim &&
          sim < 0.98 &&
          jaccard <= maxJaccard;
        const similarityOutOfRange =
          !allowHighSimCombo && (sim < minSim || sim > maxSim || jaccard > maxJaccard);
        llmLastSim = sim;
        llmLastJaccard = jaccard;
        const textSim = async (a: string | null | undefined, b: string | null | undefined) => {
          if (!a || !b) return null;
          const aVec = await embeddingProvider.embedText(normalizeForSimilarity(a), 8);
          const bVec = await embeddingProvider.embedText(normalizeForSimilarity(b), 8);
          return cosineSimilarity(aVec, bVec);
        };
        const passageSim = await textSim(sourceItem.passage, parsed.passage);
        const questionSim =
          expectedSubtype === "combo"
            ? await textSim(extractStatementText(sourceItem.question), extractStatementText(parsed.question))
            : await textSim(
                stripGenericQuestionLines(sourceItem.question),
                stripGenericQuestionLines(parsed.question)
              );
        const correctChoiceSim =
          expectedSubtype === "combo"
            ? null
            : await textSim(
                sourceItem.choices[sourceItem.correctIndex],
                parsed.choices[parsed.correctIndex]
              );
        const distractorSim =
          expectedSubtype === "combo"
            ? null
            : await textSim(
                sourceItem.choices.filter((_c, i) => i !== sourceItem.correctIndex).join(" "),
                parsed.choices.filter((_c, i) => i !== parsed.correctIndex).join(" ")
              );
        const overallChoicesSim =
          correctChoiceSim != null && distractorSim != null
            ? (correctChoiceSim + distractorSim) / 2
            : correctChoiceSim ?? distractorSim;
        if (expectedSubtype !== "combo") {
          if (questionSim != null && questionSim > 0.94) {
            setValidationReason("Question similarity too high.");
            continue;
          }
          if (overallChoicesSim != null && overallChoicesSim > 0.92) {
            setValidationReason("Choices similarity too high.");
            continue;
          }
          if (passageSim != null && passageSim > 0.92) {
            setValidationReason("Passage similarity too high.");
            continue;
          }
        }
        let resolvedChoiceStructure: {
          correctMeanSim: number;
          distractorMeanSim: number;
          distractorVariance: number;
          isolationIndex: number;
        } | null = null;
        if (expectedSubtype !== "combo") {
          const choiceTexts = parsed.choices.map((c) => normalizeForSimilarity(c));
          const vectors = await embeddingProvider.embedTexts(choiceTexts, 8);
          const correctIdx = Math.min(Math.max(parsed.correctIndex, 0), vectors.length - 1);
          const correctVec = vectors[correctIdx];
          const distractorVecs = vectors.filter((_v, idx) => idx !== correctIdx);
          const correctToDistractors = distractorVecs.map((v) =>
            cosineSimilarity(correctVec, v)
          );
          const distractorPairwise = pairwiseSimilarities(distractorVecs);
          const correctMean = mean(correctToDistractors);
          const distractorMean = mean(distractorPairwise);
          const distractorVar = std(distractorPairwise);
          const isolation = correctMean - distractorMean;
          resolvedChoiceStructure = {
            correctMeanSim: correctMean,
            distractorMeanSim: distractorMean,
            distractorVariance: distractorVar,
            isolationIndex: isolation,
          };
        }
        let score = Math.abs(sim - 0.6);
        if (target) {
          const combinedText = parsed.passage ? `${parsed.passage}\n\n${parsed.question}` : parsed.question;
          const lexical = computeLexicalComplexity(combinedText);
          const structural = computeStructuralComplexity(combinedText);
          const correctVec2 = await embeddingProvider.embedText(
            parsed.choices[parsed.correctIndex],
            8
          );
          const distractorVecs2 = await embeddingProvider.embedTexts(
            parsed.choices.filter((_c, idx) => idx !== parsed.correctIndex),
            8
          );
          const A = semanticAmbiguityA(correctVec2, distractorVecs2);
          const R = normalizeReasoningDepth(2, 5);
          const dL = lexical.L - target.L;
          const dS = structural.S - target.S;
          const dA = A - target.A;
          const dR = R - target.R;
          score = Math.sqrt(dL * dL + dS * dS + dA * dA + dR * dR);
        }
        if (similarityOutOfRange) {
          const rejectionReason = `Similarity out of range (sim=${sim.toFixed(
            3
          )}, jaccard=${jaccard.toFixed(3)}).`;
          setValidationReason(rejectionReason);
          if (!bestFallback || score < bestFallback.score) {
            bestFallback = {
              item: parsed,
              sim,
              jaccard,
              similarityBreakdown: {
                passage: passageSim,
                question: questionSim,
                correctChoice: correctChoiceSim,
                distractors: distractorSim,
                choices: overallChoicesSim,
              },
              choiceStructure: resolvedChoiceStructure,
              score,
              rejectionReason,
            };
          }
          continue;
        }
        if (!best || score < best.score) {
          best = {
            item: parsed,
            sim,
            jaccard,
            similarityBreakdown: {
              passage: passageSim,
              question: questionSim,
              correctChoice: correctChoiceSim,
              distractors: distractorSim,
              choices: overallChoicesSim,
            },
            choiceStructure: resolvedChoiceStructure,
            score,
            ...(allowHighSimCombo
              ? { similarityWarning: "Similarity above max; accepted due to structure match." }
              : {}),
          };
        }
      }
    }

    if (best) {
      stage = "accepted";
      return res.json({
        ok: true,
        apiVersion: API_VERSION,
        item: best.item,
        format: "multiple_choice",
        similarity: best.sim,
        jaccard: best.jaccard,
        similarityRange: { min: minSim, max: maxSim, maxJaccard },
        similarityBreakdown: best.similarityBreakdown,
        mode: "A",
        choiceIntent: choiceIntent ?? undefined,
        choiceStructure: best.choiceStructure,
        passageWarning: fixedPassageWarning ?? undefined,
        similarityWarning: best.similarityWarning,
        runId,
        sourceId,
        candidateId: `${runId}:best:0`,
        debug: { stage },
      });
    }
    if (bestFallback) {
      stage = "accepted";
      return res.json({
        ok: true,
        apiVersion: API_VERSION,
        item: bestFallback.item,
        format: "multiple_choice",
        similarity: bestFallback.sim,
        jaccard: bestFallback.jaccard,
        similarityRange: { min: minSim, max: maxSim, maxJaccard },
        similarityBreakdown: bestFallback.similarityBreakdown,
        mode: "A",
        choiceIntent: choiceIntent ?? undefined,
        choiceStructure: bestFallback.choiceStructure,
        passageWarning: fixedPassageWarning ?? undefined,
        similarityWarning: `Returned fallback candidate outside similarity range. ${bestFallback.rejectionReason}`,
        runId,
        sourceId,
        candidateId: `${runId}:fallback:0`,
        debug: { stage },
      });
    }
    if (softAccepted) {
      const combined = normalizeForSimilarity(buildCombinedText(softAccepted.item));
      const candidateVec = await embeddingProvider.embedText(combined, 8);
      const sim = cosineSimilarity(sourceVec, candidateVec);
      const jaccard = tokenJaccard(sourceCombined, combined);
      stage = "accepted";
      return res.json({
        ok: true,
        apiVersion: API_VERSION,
        item: softAccepted.item,
        format: "multiple_choice",
        similarity: sim,
        jaccard,
        similarityRange: { min: minSim, max: maxSim, maxJaccard },
        similarityBreakdown: {
          passage: null,
          question: null,
          correctChoice: null,
          distractors: null,
          choices: null,
        },
        mode: "A",
        choiceIntent: choiceIntent ?? undefined,
        choiceStructure: null,
        passageWarning: fixedPassageWarning ?? undefined,
        similarityWarning: `Soft-accepted candidate (warning): ${softAccepted.reason}`,
        runId,
        sourceId,
        candidateId: `${runId}:soft-accept:0`,
        debug: { stage },
      });
    }
    stage = llmLastValidationReason ? "validation_failed" : "similarity_rejected";
    return res.status(422).json({
      ok: false,
      apiVersion: API_VERSION,
      error:
        llmLastValidationReason === "Passage length out of range."
          ? "Generated passage length did not meet target range. Please try again."
          : "Generated problem too similar to source. Please try again.",
      errorType: llmLastValidationReason ? "VALIDATION_FAILED" : "SIMILARITY_REJECTED",
      runId,
      sourceId,
      similarityRange: { min: minSim, max: maxSim, maxJaccard },
      reason: llmLastValidationReason || null,
      debug: {
        stage,
        llmAttempted,
        llmLastSim,
        llmLastJaccard,
        llmLastText,
        llmLastValidationReason,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
});

app.post("/target/from-sources-mc", async (req, res) => {
  try {
    const { sourceTexts } = req.body as TargetFromSourcesMcRequest;
    if (!Array.isArray(sourceTexts)) {
      return res.status(400).json({
        ok: false,
        apiVersion: API_VERSION,
        error: "Expected { sourceTexts: string[] }",
        errorType: "BAD_REQUEST",
      });
    }
    if (!generationProvider) {
      return res.status(400).json({
        ok: false,
        apiVersion: API_VERSION,
        error: "Generation provider not configured.",
        errorType: "BAD_REQUEST",
      });
    }
    const items = sourceTexts
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
    if (items.length === 0) {
      return res.status(400).json({
        ok: false,
        apiVersion: API_VERSION,
        error: "sourceTexts must include at least one item.",
        errorType: "BAD_REQUEST",
      });
    }

    const Ls: number[] = [];
    const Ss: number[] = [];
    const As: number[] = [];
    const Rs: number[] = [];

    for (const src of items) {
      const parsed = await parseMultipleChoice(src);
      const combined = buildCombinedText(parsed);
      const lexical = computeLexicalComplexity(combined);
      const structural = computeStructuralComplexity(combined);
      const correct = parsed.choices[parsed.correctIndex];
      const distractors = parsed.choices.filter((_, i) => i !== parsed.correctIndex);
      const correctVec = await embeddingProvider.embedText(correct, 8);
      const distractorVecs = await embeddingProvider.embedTexts(distractors, 8);
      const A = semanticAmbiguityA(correctVec, distractorVecs);
      const R = normalizeReasoningDepth(2, 5);
      Ls.push(lexical.L);
      Ss.push(structural.S);
      As.push(A);
      Rs.push(R);
    }

    const count = items.length;
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    const std = (values: number[]) => {
      if (values.length <= 1) return 0;
      const m = mean(values);
      const variance = mean(values.map((v) => (v - m) ** 2));
      return Math.sqrt(variance);
    };
    const stability = count <= 1 ? "Low" : count === 2 ? "Medium" : "High";
    const effectiveTolerance = count <= 1 ? 0.12 : count === 2 ? 0.07 : 0.05;
    const meanProfile = { L: mean(Ls), S: mean(Ss), A: mean(As), R: mean(Rs) };
    const stdProfile = { L: std(Ls), S: std(Ss), A: std(As), R: std(Rs) };
    const axisTolerance = {
      L: computeAxisTolerance(meanProfile.L, stdProfile.L, count),
      S: computeAxisTolerance(meanProfile.S, stdProfile.S, count),
      A: computeAxisTolerance(meanProfile.A, stdProfile.A, count),
      R: computeAxisTolerance(meanProfile.R, stdProfile.R, count),
    };

    return res.json({
      ok: true,
      apiVersion: API_VERSION,
      mean: meanProfile,
      std: stdProfile,
      axisTolerance,
      targetBand: {
        min: {
          L: clamp01(meanProfile.L - axisTolerance.L),
          S: clamp01(meanProfile.S - axisTolerance.S),
          A: clamp01(meanProfile.A - axisTolerance.A),
          R: clamp01(meanProfile.R - axisTolerance.R),
        },
        max: {
          L: clamp01(meanProfile.L + axisTolerance.L),
          S: clamp01(meanProfile.S + axisTolerance.S),
          A: clamp01(meanProfile.A + axisTolerance.A),
          R: clamp01(meanProfile.R + axisTolerance.R),
        },
      },
      count,
      stability,
      effectiveTolerance,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(400).json({
      ok: false,
      apiVersion: API_VERSION,
      error: message,
      errorType: "BAD_REQUEST",
    });
  }
});

app.post("/target/from-sources", async (req, res) => {
  try {
    const { sourceTexts } = req.body as { sourceTexts: string[] };
    if (!Array.isArray(sourceTexts)) {
      return res.status(400).json({ error: "Expected { sourceTexts: string[] }" });
    }
    const stats = await computeTargetFromSources(sourceTexts, embeddingProvider, 5);
    return res.json(stats);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
});

app.post("/target/from-structure", (req, res) => {
  try {
    const { problemType, reasoningSteps, blankType, cefr } = req.body as {
      problemType: "selection" | "fill_blank" | "constructed" | "transformation";
      reasoningSteps: 1 | 2 | 3;
      blankType: "none" | "full" | "prefix";
      cefr: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
    };
    if (!problemType || !reasoningSteps || !blankType || !cefr) {
      return res.status(400).json({ error: "Invalid structure input." });
    }
    const target = targetFromStructure({
      problemType,
      reasoningSteps,
      blankType,
      cefr,
    });
    return res.json(target);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
});

const PORT = Number(process.env.PORT || 3001);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
function softenSimilarity(text: string): string {
  let out = text;
  const rules: Array<[RegExp, string]> = [
    [/\bindicates\b/gi, "shows"],
    [/\blow in\b/gi, "low on"],
    [/\bhigh in\b/gi, "high on"],
    [/\bwe're\b/gi, "we are"],
    [/\bbut\b/gi, "though"],
    [/\bhave to\b/gi, "need to"],
    [/\bfind a place\b/gi, "find a spot"],
  ];
  for (const [re, rep] of rules) {
    out = out.replace(re, rep);
  }
  if (out === text) {
    out = `In this statement, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  }
  return out;
}

function isJapanese(text: string) {
  return /[\u3040-\u30ff\u4e00-\u9faf]/.test(text);
}

function japaneseNgrams(text: string, n = 2) {
  const cleaned = text.replace(/\s+/g, "");
  if (cleaned.length < n) return cleaned ? [cleaned] : [];
  const grams: string[] = [];
  for (let i = 0; i <= cleaned.length - n; i += 1) {
    grams.push(cleaned.slice(i, i + n));
  }
  return grams;
}

function tokenJaccard(a: string, b: string): number {
  const tokensA = new Set(
    isJapanese(a) ? japaneseNgrams(a, 2) : a.split(/\s+/).filter(Boolean)
  );
  const tokensB = new Set(
    isJapanese(b) ? japaneseNgrams(b, 2) : b.split(/\s+/).filter(Boolean)
  );
  const union = new Set([...tokensA, ...tokensB]);
  let inter = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) inter += 1;
  }
  return union.size === 0 ? 0 : inter / union.size;
}

function extractJson(
  text: string
): { text: string; answer?: string; answers?: string[]; original?: string } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    if (typeof obj.text !== "string") return null;
    const cleaned = {
      text: obj.text.trim(),
      answer:
        typeof obj.answer === "string" && obj.answer.trim().length > 0
          ? obj.answer.trim()
          : undefined,
      answers: Array.isArray(obj.answers)
        ? obj.answers.map((a: unknown) => String(a || "").trim()).filter(Boolean)
        : undefined,
      original:
        typeof obj.original === "string" && obj.original.trim().length > 0
          ? obj.original.trim()
          : undefined,
    };
    if (cleaned.answer || (cleaned.answers && cleaned.answers.length > 0)) {
      return cleaned;
    }
    return null;
  } catch {
    return null;
  }
}

function extractJsonObject<T>(text: string): T | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

function extractJsonArray<T>(text: string): T[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T[];
  } catch {
    return null;
  }
}

function normalizeChoice(choice: string) {
  return choice
    .replace(/^\s*[\d０-９]+[．\.\)\:]\s*/i, "")
    .replace(/^\s*[\d０-９]+\s+(?=\S)/i, "")
    .replace(/^\s*[A-D][\).:\-]\s*/i, "")
    .replace(/^\s*[A-D]\s+/, "")
    .trim();
}

function validateMultipleChoice(item: MultipleChoiceItem): string | null {
  if (!item.question || typeof item.question !== "string") {
    return "Missing question.";
  }
  if (!Array.isArray(item.choices) || item.choices.length < 2 || item.choices.length > 8) {
    return "Expected between 2 and 8 choices.";
  }
  if (
    typeof item.correctIndex !== "number" ||
    item.correctIndex < 0 ||
    item.correctIndex >= item.choices.length
  ) {
    return "Invalid correctIndex.";
  }
  return null;
}

function coerceChoiceCount(item: MultipleChoiceItem, expectedChoiceCount: number): MultipleChoiceItem | null {
  if (!Array.isArray(item.choices)) return null;
  if (item.choices.length === expectedChoiceCount) return item;
  if (item.choices.length < expectedChoiceCount) return null;
  const correct = item.choices[item.correctIndex];
  if (!correct) return null;
  const distractors = item.choices.filter((_c, idx) => idx !== item.correctIndex);
  const selected = [correct, ...distractors.slice(0, expectedChoiceCount - 1)];
  const dedup = Array.from(new Set(selected.map((c) => c.trim()))).filter(Boolean);
  if (dedup.length < expectedChoiceCount) return null;
  return {
    ...item,
    choices: dedup.slice(0, expectedChoiceCount),
    correctIndex: 0,
  };
}

function tokenizeChoiceText(text: string): string[] {
  return normalizeForSimilarity(text)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function ngramSet(tokens: string[], n: number): Set<string> {
  const out = new Set<string>();
  if (tokens.length < n) return out;
  for (let i = 0; i <= tokens.length - n; i += 1) {
    out.add(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

function choiceShape(choice: string): "sentence" | "phrase" {
  const wc = countWords(choice);
  return /[.!?]$/.test(choice.trim()) || wc >= 10 ? "sentence" : "phrase";
}

function validateMultipleChoiceStrict(
  item: MultipleChoiceItem,
  options: { expectedChoiceCount: number; requireInference: boolean; passageText: string }
): string | null {
  const baseError = validateMultipleChoice(item);
  if (baseError) return baseError;
  if (item.choices.length !== options.expectedChoiceCount) {
    return `Expected exactly ${options.expectedChoiceCount} choices.`;
  }
  const lowered = item.choices.map((c) => normalizeForSimilarity(c));
  const dedup = new Set(lowered);
  if (dedup.size !== item.choices.length) {
    return "Choices must be unique.";
  }
  if (
    lowered.some((c) =>
      /\b(all of the above|none of the above|both a and b|both b and c)\b/i.test(c)
    )
  ) {
    return "Disallowed meta choice detected.";
  }
  const shapes = new Set(item.choices.map(choiceShape));
  if (shapes.size > 1) {
    return "Choice type mismatch (sentence vs phrase).";
  }
  if (options.requireInference) {
    const q = item.question.toLowerCase();
    const hasInferenceCue =
      /\b(infer|inferred|inference|imply|implied|suggest|most likely|best supported|can be concluded|can be inferred|based on the passage)\b/.test(
        q
      ) ||
      /\bbased on\b/.test(q) ||
      /\bwhat was unusual\b/.test(q) ||
      /何を示唆|推測|読み取|最も適切/.test(item.question);
    if (!hasInferenceCue) {
      return "Question is not inference-oriented.";
    }
  }
  const passage = options.passageText || "";
  if (passage.trim().length > 0) {
    const passageTokens = tokenizeChoiceText(passage);
    const passageTri = ngramSet(passageTokens, 3);
    for (const choice of item.choices) {
      const ct = tokenizeChoiceText(choice);
      const cTri = ngramSet(ct, 3);
      if (cTri.size === 0) continue;
      let overlap = 0;
      for (const g of cTri) {
        if (passageTri.has(g)) overlap += 1;
      }
      const ratio = overlap / cTri.size;
      if (ratio > 0.65) return "Choice overlaps passage too directly.";
    }
    const correct = item.choices[item.correctIndex] || "";
    const correctTokens = tokenizeChoiceText(correct).filter((t) => t.length >= 4);
    const passageSet = new Set(passageTokens);
    const overlapCount = correctTokens.filter((t) => passageSet.has(t)).length;
    if (correctTokens.length > 0 && overlapCount === 0) {
      return "Correct choice lacks passage grounding.";
    }
  }
  return null;
}

function buildCombinedText(item: MultipleChoiceItem) {
  const passage = item.passage ? item.passage.trim() : "";
  return passage ? `${passage}\n\n${item.question}` : item.question;
}

function extractStatementText(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const statementLines = lines.filter((l) => /^[ア-エ]．/.test(l));
  return statementLines.join("\n");
}

function extractComboStatements(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.filter((l) => /^[ア-エ]．/.test(l));
}

function isComboTooSimilar(sourceStatements: string[], generatedStatements: string[]) {
  if (sourceStatements.length === 0 || generatedStatements.length === 0) return false;
  const normalizedSource = sourceStatements.map((s) => normalizeForSimilarity(s));
  const normalizedGenerated = generatedStatements.map((s) => normalizeForSimilarity(s));
  let highOverlap = 0;
  for (const gen of normalizedGenerated) {
    let max = 0;
    for (const src of normalizedSource) {
      const j = tokenJaccard(src, gen);
      if (j > max) max = j;
    }
    if (max >= 0.7) highOverlap += 1;
  }
  const rejectThreshold = Math.max(3, Math.ceil(normalizedGenerated.length / 2) + 1);
  return highOverlap >= rejectThreshold;
}

function comboStatementSimilarityMetrics(
  sourceStatements: string[],
  generatedStatements: string[]
) {
  if (sourceStatements.length === 0 || generatedStatements.length === 0) {
    return { avgMaxJaccard: 0, maxJaccard: 0 };
  }
  const normalizedSource = sourceStatements.map((s) => normalizeForSimilarity(s));
  const normalizedGenerated = generatedStatements.map((s) => normalizeForSimilarity(s));
  const maxEach: number[] = [];
  for (const gen of normalizedGenerated) {
    let max = 0;
    for (const src of normalizedSource) {
      const j = tokenJaccard(src, gen);
      if (j > max) max = j;
    }
    maxEach.push(max);
  }
  const avgMaxJaccard = maxEach.reduce((a, b) => a + b, 0) / maxEach.length;
  const maxJaccard = Math.max(...maxEach);
  return { avgMaxJaccard, maxJaccard };
}

function extractThemeKeywords(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ");
  const stoplist = new Set(["番号", "記述", "組合", "組み合わせ", "最適切", "選びなさい"]);
  const japaneseTerms = [...cleaned.matchAll(/[\u4e00-\u9faf]{2,}/g)]
    .map((m) => m[0])
    .filter((t) => !stoplist.has(t));
  if (japaneseTerms.length > 0) {
    const uniq = Array.from(new Set(japaneseTerms));
    return uniq.slice(0, 6);
  }
  const englishTerms = cleaned
    .toLowerCase()
    .match(/[a-z][a-z\-]{2,}/g);
  if (!englishTerms) return [];
  const uniq = Array.from(new Set(englishTerms));
  return uniq.slice(0, 6);
}

function extractJapaneseKanjiTokens(text: string): string[] {
  const tokens = [...text.matchAll(/[\u4e00-\u9faf]{2,}/g)].map((m) => m[0]);
  return Array.from(new Set(tokens));
}

function normalizeDigits(text: string) {
  return text.replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10));
}

function extractNumericTokens(text: string): string[] {
  const normalized = normalizeDigits(text);
  const matches = normalized.match(/\d+/g);
  return matches ? Array.from(new Set(matches)) : [];
}

function normalizeStructureType(raw: string | undefined): StructureItem["type"] {
  const value = (raw || "").toLowerCase();
  if (value.includes("exception") || /例外|ただし/.test(raw || "")) return "exception";
  if (value.includes("procedure") || /手続|通知|指定|届出/.test(raw || "")) return "procedure";
  if (value.includes("sanction") || /罰|制裁|過料|懲戒|処分/.test(raw || "")) return "sanction";
  return "principle";
}

function structureFromStatement(label: string, statement: string): StructureItem {
  const numeric = extractNumericTokens(statement);
  const type = normalizeStructureType(
    /ただし/.test(statement)
      ? "exception"
      : /手続|通知|指定|届出/.test(statement)
      ? "procedure"
      : /罰|制裁|過料|懲戒|処分/.test(statement)
      ? "sanction"
      : "principle"
  );
  return {
    label,
    type,
    actor: "",
    action: "",
    condition: "",
    object: "",
    numeric,
  };
}

async function extractStructureItems(statements: string[]): Promise<StructureItem[] | null> {
  if (statements.length === 0) return null;
  return statements.map((statement, idx) => {
    const labelMatch = statement.match(/^([ア-エ])．/);
    const label = labelMatch ? labelMatch[1] : String(idx + 1);
    return structureFromStatement(label, statement);
  });
}

function validateStructureMatch(
  sourceItems: StructureItem[],
  generatedItems: StructureItem[]
): boolean {
  if (sourceItems.length === 0 || generatedItems.length === 0) return true;
  if (sourceItems.length !== generatedItems.length) return false;
  const len = sourceItems.length;
  let typeMatches = 0;
  for (let i = 0; i < len; i += 1) {
    if (sourceItems[i].type === generatedItems[i].type) typeMatches += 1;
    if (sourceItems[i].numeric.length > 0) {
      const srcNums = new Set(sourceItems[i].numeric);
      const genNums = new Set(generatedItems[i].numeric);
      for (const n of srcNums) {
        if (!genNums.has(n)) return false;
      }
    }
  }
  return typeMatches >= len - 1;
}

function comboHasNovelTerms(
  sourceStatements: string[],
  generatedStatements: string[],
  minStatementsWithNovel: number
) {
  if (sourceStatements.length === 0 || generatedStatements.length === 0) return true;
  const sourceSet = new Set(
    extractJapaneseKanjiTokens(sourceStatements.join("\n"))
  );
  let withNovel = 0;
  for (const stmt of generatedStatements) {
    const tokens = extractJapaneseKanjiTokens(stmt);
    const novel = tokens.filter((t) => !sourceSet.has(t));
    if (novel.length >= 1) withNovel += 1;
  }
  return withNovel >= minStatementsWithNovel;
}

async function semanticThemeCheck(
  source: string,
  generated: string
): Promise<{ ok: boolean; reason?: string }> {
  if (!generationProvider) return { ok: true };
  const system = "You are a strict topic consistency judge. Answer only YES or NO.";
  const prompt = [
    "Do the two items test the SAME underlying concept/topic?",
    "Answer ONLY with YES or NO.",
    `Source:\n${source}`,
    `Generated:\n${generated}`,
  ].join("\n");
  for (let i = 0; i < 2; i += 1) {
    const raw = await generationProvider.generateText(prompt, system);
    const answer = raw.trim().toUpperCase();
    if (answer.startsWith("YES")) return { ok: true };
    if (answer.startsWith("NO")) return { ok: false, reason: "Semantic topic mismatch." };
  }
  return { ok: true };
}

async function extractChoiceIntent(
  sourceText: string
): Promise<{ concept: string; patterns: string[] } | null> {
  if (!generationProvider) return null;
  const system = "You summarize answer intent and distractor patterns. Return ONLY valid JSON.";
  const prompt = [
    "Analyze the question and choices.",
    "Return JSON: {\"concept\":\"...\",\"patterns\":[\"condition missing\",\"logical flip\",\"overgeneralization\"]}",
    "Use ONLY these three pattern labels.",
    `Source:\n${sourceText}`,
  ].join("\n");
  const raw = await generationProvider.generateText(prompt, system);
  const parsed = extractJsonObject<{ concept?: string; patterns?: string[] }>(raw);
  if (!parsed || !parsed.concept || !Array.isArray(parsed.patterns)) return null;
  const patterns = parsed.patterns
    .filter((p) =>
      ["condition missing", "logical flip", "overgeneralization"].includes(p)
    )
    .slice(0, 3);
  if (patterns.length === 0) return null;
  return { concept: parsed.concept, patterns };
}

function extractCandidates<T>(raw: string): T[] {
  const parsed = extractJsonObject<{ candidates?: T[] }>(raw);
  if (parsed?.candidates && Array.isArray(parsed.candidates)) {
    return parsed.candidates;
  }
  const single = extractJsonObject<T>(raw);
  return single ? [single] : [];
}

function questionContainsChoices(question: string) {
  const lines = question.split(/\r?\n/).map((l) => l.trim());
  return lines.some(
    (l) =>
      /^[\d０-９]+[．\.\)]/.test(l) ||
      /^\s*[A-D]\s+/.test(l) ||
      /^\s*[A-D][\).:\-]/.test(l) ||
      /[ア-エ]と[ア-エ]/.test(l)
  );
}

function dedupeQuestionLines(question: string) {
  const lines = question
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length <= 1) return question;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = line.replace(/\s+/g, "");
    if (seen.has(key)) continue;
    // If a generic combo instruction repeats, drop duplicates.
    if (line.includes("正しいものの組合せ") && out.some((l) => l.includes("正しいものの組合せ"))) {
      continue;
    }
    seen.add(key);
    out.push(line);
  }
  return out.join("\n");
}

function stripEmbeddedPassage(question: string, passage: string | null) {
  if (!passage) return question;
  const trimmedPassage = passage.trim();
  if (!trimmedPassage) return question;
  if (question.includes(trimmedPassage)) {
    return question.replace(trimmedPassage, "").trim();
  }
  return question;
}

function stripGenericQuestionLines(question: string) {
  const lines = question
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const filtered = lines.filter(
    (line) =>
      !/正しいものの組合せ|最も適切|番号|選びなさい|次の記述/.test(line)
  );
  return filtered.join("\n");
}

function extractPassageFromRaw(sourceText: string): string {
  const lines = sourceText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 3) return "";
  const choiceStart = findChoiceBlockStart(lines);
  if (choiceStart < 1) return "";
  const passageLines = lines.slice(0, Math.max(0, choiceStart + 1));
  return passageLines.join("\n").trim();
}

function averageVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const sums = new Array<number>(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i += 1) sums[i] += vec[i];
  }
  return sums.map((v) => v / vectors.length);
}

function pairwiseSimilarities(vectors: number[][]): number[] {
  const sims: number[] = [];
  for (let i = 0; i < vectors.length; i += 1) {
    for (let j = i + 1; j < vectors.length; j += 1) {
      sims.push(cosineSimilarity(vectors[i], vectors[j]));
    }
  }
  return sims;
}

function mean(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[]) {
  if (values.length <= 1) return 0;
  const m = mean(values);
  const variance = mean(values.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}
function detectJapaneseCombinationStyle(sourceText: string) {
  const hasStatements = /[ア-エ]．/.test(sourceText);
  const hasNumbered = /[1-9１-９]+．/.test(sourceText);
  const hasCombo = /[アイウエ]{2,}/.test(sourceText);
  return hasStatements && hasNumbered && hasCombo;
}

function extractJapaneseStatementLabels(sourceText: string) {
  const labels: string[] = [];
  for (const line of sourceText.split(/\r?\n/)) {
    const match = line.match(/^([ア-エ])．/);
    if (match) labels.push(match[1]);
  }
  return labels.length > 0 ? Array.from(new Set(labels)) : [];
}

function detectComboChoices(choices: string[]) {
  return choices.every((c) => /[ア-エ](?:と|・)?[ア-エ]/.test(c));
}

function splitInlineChoices(line: string): string[] | null {
  const matches = [...line.matchAll(/(?:^|\s)([\d０-９]+)[．\.\)]\s*([^\s]+)/g)];
  if (matches.length < 2) return null;
  return matches.map((m) => `${m[1]}. ${m[2]}`);
}

function getChoiceLabel(line: string): { type: "alpha"; label: string } | { type: "num" } | null {
  if (/^\s*[\d０-９]+[．\.\)]\s+/.test(line)) return { type: "num" };
  if (/^\s*[\d０-９]+\s+\S+/.test(line)) return { type: "num" };
  const punct = line.match(/^\s*([A-D])[\).:\-]\s+/i);
  if (punct) return { type: "alpha", label: punct[1].toUpperCase() };
  const spaced = line.match(/^\s*([A-D])\s+\S+/i);
  if (spaced) return { type: "alpha", label: spaced[1].toUpperCase() };
  return null;
}

function findChoiceBlockStart(lines: string[]): number {
  let idx = lines.length - 1;
  const labels: string[] = [];
  while (idx >= 0) {
    const label = getChoiceLabel(lines[idx]);
    if (!label) break;
    labels.push(label.type === "alpha" ? label.label : "num");
    idx -= 1;
  }
  if (labels.length < 2) return -1;
  const alphaLabels = labels.filter((l) => l !== "num");
  if (alphaLabels.length > 0) {
    const distinct = new Set(alphaLabels);
    if (distinct.size < 3) return -1;
  }
  return idx;
}

function tryParseLabeledMultipleChoice(sourceText: string): MultipleChoiceItem | null {
  const lines = sourceText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 4) return null;
  const passageIdx = lines.findIndex((l) => /^passage\s*:/i.test(l));
  const questionIdx = lines.findIndex((l) => /^question\s*:/i.test(l));
  const choicesIdx = lines.findIndex((l) => /^choices\s*:/i.test(l));
  if (questionIdx < 0 || choicesIdx < 0 || choicesIdx <= questionIdx) return null;

  const answerIdx = lines.findIndex((l) => /^answer\s*:/i.test(l));
  const contentEnd = answerIdx > choicesIdx ? answerIdx : lines.length;

  const stripLabel = (line: string, label: RegExp) => line.replace(label, "").trim();

  const passageParts: string[] = [];
  if (passageIdx >= 0 && passageIdx < questionIdx) {
    const head = stripLabel(lines[passageIdx], /^passage\s*:/i);
    if (head) passageParts.push(head);
    for (let i = passageIdx + 1; i < questionIdx; i += 1) {
      passageParts.push(lines[i]);
    }
  }

  const questionParts: string[] = [];
  const qHead = stripLabel(lines[questionIdx], /^question\s*:/i);
  if (qHead) questionParts.push(qHead);
  for (let i = questionIdx + 1; i < choicesIdx; i += 1) {
    questionParts.push(lines[i]);
  }
  const question = questionParts.join(" ").trim();
  if (!question) return null;

  const choiceTexts: string[] = [];
  for (let i = choicesIdx + 1; i < contentEnd; i += 1) {
    const line = lines[i];
    if (/^answer\s*:/i.test(line)) break;
    if (getChoiceLabel(line)) {
      choiceTexts.push(normalizeChoice(line));
      continue;
    }
    if (choiceTexts.length > 0) {
      choiceTexts[choiceTexts.length - 1] = `${choiceTexts[choiceTexts.length - 1]} ${line}`.trim();
    }
  }
  if (choiceTexts.length < 2) return null;

  let correctIndex = 0;
  if (answerIdx >= 0) {
    const answerRaw = stripLabel(lines[answerIdx], /^answer\s*:/i);
    const alpha = answerRaw.match(/^[A-D]/i)?.[0]?.toUpperCase();
    if (alpha) {
      const idx = alpha.charCodeAt(0) - "A".charCodeAt(0);
      if (idx >= 0 && idx < choiceTexts.length) correctIndex = idx;
    }
  }

  const item: MultipleChoiceItem = {
    passage: passageParts.length > 0 ? passageParts.join(" ") : null,
    question,
    choices: choiceTexts,
    correctIndex,
    subtype: detectComboChoices(choiceTexts) ? "combo" : "standard",
  };
  const error = validateMultipleChoice(item);
  return error ? null : item;
}

function tryParseMultipleChoiceHeuristic(sourceText: string): MultipleChoiceItem | null {
  const labeled = tryParseLabeledMultipleChoice(sourceText);
  if (labeled) return labeled;
  const rawLines = sourceText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (rawLines.length < 3) return null;
  const lines: string[] = [];
  for (const line of rawLines) {
    const hasLabel = getChoiceLabel(line) !== null;
    if (hasLabel) {
      lines.push(line);
      continue;
    }
    const prev = lines[lines.length - 1];
    if (prev && getChoiceLabel(prev) !== null) {
      lines[lines.length - 1] = `${prev} ${line}`.trim();
    } else {
      lines.push(line);
    }
  }

  const inlineChoices = lines
    .map((line) => splitInlineChoices(line))
    .find((choices) => choices && choices.length >= 2);
  if (inlineChoices) {
    const idx = lines.findIndex((l) => splitInlineChoices(l));
    let questionLine = lines[idx - 1];
    if (!questionLine) return null;
    const looksLikeStatement = /^[ア-エ]．/.test(questionLine);
    const firstLine = lines[0] || "";
    let passageLines = lines.slice(0, Math.max(0, idx - 1));
    if (looksLikeStatement && /選びなさい|問|次の記述/.test(firstLine)) {
      questionLine = firstLine;
      passageLines = lines.slice(1, Math.max(1, idx - 1));
    }
    const item: MultipleChoiceItem = {
      passage: passageLines.length ? passageLines.join("\n") : null,
      question: questionLine,
      choices: inlineChoices.map(normalizeChoice),
      correctIndex: 0,
      subtype: "combo",
    };
    const error = validateMultipleChoice(item);
    return error ? null : item;
  }

  const answerLineIndex = lines.findIndex((l) => /^answer\s*:/i.test(l));
  let explicitAnswer: string | null = null;
  if (answerLineIndex >= 0) {
    explicitAnswer = lines[answerLineIndex].replace(/^answer\s*:\s*/i, "").trim();
    lines.splice(answerLineIndex, 1);
  }

  const choiceStart = findChoiceBlockStart(lines);
  const choiceLines = lines.slice(choiceStart + 1);
  const questionLine = lines[choiceStart];
  if (!questionLine || choiceLines.length < 2) return null;

  const normalizedChoices = choiceLines.map(normalizeChoice);
  const question = questionLine.replace(/^question\s*:\s*/i, "").trim();
  const passageLines = lines.slice(0, Math.max(0, choiceStart));
  const passage = passageLines.length
    ? passageLines.join("\n").replace(/^passage\s*:\s*/i, "").trim()
    : null;

  if (question.length < 6) return null;

  let correctIndex = 0;
  if (explicitAnswer) {
    const numeric = explicitAnswer.replace(/[^\d０-９]/g, "");
    if (numeric) {
      const normalizedNumber = Number(numeric.replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10)));
      if (!Number.isNaN(normalizedNumber) && normalizedNumber >= 1) {
        const idx = normalizedNumber - 1;
        if (idx >= 0 && idx < normalizedChoices.length) {
          correctIndex = idx;
          return {
            passage: passage && passage.length > 0 ? passage : null,
            question,
            choices: normalizedChoices,
            correctIndex,
          };
        }
      }
    }
    const normalizedAnswer = normalizeChoice(explicitAnswer).toLowerCase();
    const idx = normalizedChoices.findIndex(
      (c) => normalizeChoice(c).toLowerCase() === normalizedAnswer
    );
    if (idx >= 0) correctIndex = idx;
  }

  const item: MultipleChoiceItem = {
    passage: passage && passage.length > 0 ? passage : null,
    question,
    choices: normalizedChoices,
    correctIndex,
    subtype: detectComboChoices(normalizedChoices) ? "combo" : "standard",
  };
  const error = validateMultipleChoice(item);
  return error ? null : item;
}

async function parseMultipleChoice(sourceText: string): Promise<MultipleChoiceItem> {
  const heuristic = tryParseMultipleChoiceHeuristic(sourceText);
  if (heuristic) return heuristic;
  if (!generationProvider) {
    throw new Error("Generation provider not configured.");
  }
  const normalizeSystem =
    "You normalize pasted multiple-choice problems into a clean, parseable format. Return ONLY plain text.";
  const normalizePrompt = [
    "Rewrite the input into the following format with one item per line:",
    "Passage: ... (optional, omit if none)",
    "Question: ...",
    "A) ...",
    "B) ...",
    "C) ...",
    "D) ...",
    "If there are 5-8 choices, continue with E) F) etc.",
    "Remove stray symbols like | and extra whitespace.",
    "Do NOT change meaning.",
    `Input:\n${sourceText}`,
  ].join("\n");
  const normalizedText = await generationProvider.generateText(
    normalizePrompt,
    normalizeSystem
  );
  const normalizedHeuristic = tryParseMultipleChoiceHeuristic(normalizedText);
  if (normalizedHeuristic) return normalizedHeuristic;
  const system =
    "You extract multiple-choice questions. Return ONLY valid JSON with strict fields.";
  const prompt = [
    "Parse the input into JSON:",
    '{"passage": string|null, "question": string, "choices": [string,...], "correctIndex": 0-(choices.length-1)}',
    "Passage can be null if not present.",
    "The input may NOT include labels like 'Passage:' or 'Question:'. Infer structure from order.",
    "If there are 4 short lines at the end, treat them as choices.",
    "Normalize choices to plain text (no labels).",
    "If correct choice is not explicit, infer the best answer.",
    `Input:\n${sourceText}`,
  ].join("\n");
  for (let i = 0; i < 3; i += 1) {
    const raw = await generationProvider.generateText(prompt, system);
    const parsed = extractJsonObject<MultipleChoiceItem>(raw);
    if (!parsed) continue;
    parsed.choices = parsed.choices.map(normalizeChoice);
    const error = validateMultipleChoice(parsed);
    if (error) continue;
    return parsed;
  }
  throw new Error("Failed to parse multiple-choice input.");
}
