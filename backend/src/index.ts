import express from "express";
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
import { generateFillBlank, generateFillBlankCandidates, normalizeForSimilarity } from "./services/fill-blank.service.js";
import { computeTargetFromSources } from "./services/target-from-sources.service.js";
import { targetFromStructure } from "./services/structure-target.service.js";
import { classifyFormat } from "./services/format-classifier.service.js";
import { validateGenerated } from "./services/format-validator.service.js";
import { cosineSimilarity } from "./utils/cosine.js";
import { GeminiTextGenerationProvider } from "./providers/gemini.generate.provider.js";

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
    return res.status(400).json({ error: message });
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
    return res.status(400).json({ error: message });
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

app.post("/generate/fill-blank", async (req, res) => {
  try {
    const { sourceText, target } = req.body as {
      sourceText: string;
      target?: { L: number; S: number; A: number; R: number };
    };
    if (typeof sourceText !== "string") {
      return res.status(400).json({ error: "Expected { sourceText: string }" });
    }
    const format = classifyFormat(sourceText);
    if (format === "multiple_choice" || format === "constructed_response") {
      return res.status(400).json({ error: `Format ${format} not supported in v1.` });
    }
    const candidates = generateFillBlankCandidates(sourceText);
    if (!target) {
      const valid = candidates.find((c) => validateGenerated(c.text, format).ok);
      return res.json({ item: valid || candidates[0], candidates, format });
    }
    const scored = [];
    const normalizedSource = normalizeForSimilarity(sourceText);
    const sourceVec = await embeddingProvider.embedText(normalizedSource, 8);
    for (const c of candidates) {
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
    scored.sort((a, b) => a.distance - b.distance);
    const MIN_SIM = 0.4;
    const MAX_SIM = 0.85;
    const MAX_JACCARD = 0.75;
    let attempts = 0;
    let best =
      scored.find(
        (s) =>
          validateGenerated(s.item.text, format).ok &&
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
            validateGenerated(s.item.text, format).ok &&
            s.similarity >= MIN_SIM &&
            s.similarity <= MAX_SIM &&
            s.jaccard <= MAX_JACCARD
        ) || null;
      if (best) {
        return res.json({
          item: best.item,
          candidates: scored,
          format,
          similarity: best.similarity,
          jaccard: best.jaccard,
          similarityRange: { min: MIN_SIM, max: MAX_SIM, maxJaccard: MAX_JACCARD },
        });
      }
    }

    if (generationProvider) {
      const base = candidates[0];
      const system =
        "You are a question rewriter. Output only one sentence. Do not add options or extra text.";
      const prompt = [
        "Rewrite the sentence while keeping the exact blank marker pattern.",
        "Keep the missing word the same.",
        `Format: ${format}`,
        `Blanked template: ${base.text}`,
        `Missing word: ${base.correct}`,
        `Original example: ${sourceText}`,
      ].join("\n");
      const rewritten = await generationProvider.generateText(prompt, system);
      if (validateGenerated(rewritten, format).ok) {
        const candidateVec = await embeddingProvider.embedText(
          normalizeForSimilarity(rewritten),
          8
        );
        const sim = cosineSimilarity(sourceVec, candidateVec);
        const jaccard = tokenJaccard(normalizedSource, normalizeForSimilarity(rewritten));
        if (sim >= MIN_SIM && sim <= MAX_SIM && jaccard <= MAX_JACCARD) {
          return res.json({
            item: { ...base, text: rewritten },
            candidates: scored,
            format,
            similarity: sim,
            jaccard,
            similarityRange: { min: MIN_SIM, max: MAX_SIM, maxJaccard: MAX_JACCARD },
          });
        }
      }
    }

    return res.status(422).json({
      error: "Generated problem too similar to source. Please try again.",
      similarityRange: { min: MIN_SIM, max: MAX_SIM, maxJaccard: MAX_JACCARD },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(400).json({ error: message });
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

const PORT = 3001;

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

function tokenJaccard(a: string, b: string): number {
  const tokensA = new Set(a.split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.split(/\s+/).filter(Boolean));
  const union = new Set([...tokensA, ...tokensB]);
  let inter = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) inter += 1;
  }
  return union.size === 0 ? 0 : inter / union.size;
}
