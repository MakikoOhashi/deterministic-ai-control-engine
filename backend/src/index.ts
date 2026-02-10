import "dotenv/config";
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
import {
  buildDistractorsFromText,
  generateFillBlank,
  generateFillBlankCandidates,
  getBlankPattern,
  normalizeForSimilarity,
} from "./services/fill-blank.service.js";
import { computeTargetFromSources } from "./services/target-from-sources.service.js";
import { targetFromStructure } from "./services/structure-target.service.js";
import { classifyFormat } from "./services/format-classifier.service.js";
import { validateGenerated } from "./services/format-validator.service.js";
import { cosineSimilarity } from "./utils/cosine.js";
import { countWords } from "./utils/text-metrics.js";
import { GeminiTextGenerationProvider } from "./providers/gemini.generate.provider.js";

type MultipleChoiceItem = {
  passage?: string | null;
  question: string;
  choices: string[];
  correctIndex: number;
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
    const scored: Array<{ item: typeof candidates[number]; distance: number; similarity: number; jaccard: number }> = [];
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

    let llmAttempted = false;
    let llmLastSim: number | null = null;
    let llmLastJaccard: number | null = null;
    let llmLastText: string | null = null;
    let llmLastValidationReason: string | null = null;
    if (generationProvider) {
      const base = candidates[0];
      const pattern = getBlankPattern(sourceText);
      const system =
        "You generate fill-in-the-blank questions. Return ONLY valid JSON. Never copy the original sentence.";
      const prompt =
        format === "prefix_blank" && pattern
          ? [
              "Create ONE new sentence similar in meaning but NOT a copy.",
              "Change the subject and clause order. Replace key phrases with synonyms.",
              "Do NOT reuse any 3-word sequence from the original.",
              "Ensure at least 30% of content words are different.",
              "Keep EXACT prefix blank pattern.",
              `Prefix: ${pattern.prefix}`,
              `Blanks: ${pattern.blanks}`,
              `Total answer length: ${pattern.prefix.length + pattern.blankCount} letters.`,
              `Answer must start with "${pattern.prefix}" and have exactly ${pattern.blankCount} letters after the prefix.`,
              "The text must include the full sentence with the blank in place of the answer. Do not truncate after the blank.",
              "Infer the original answer from context, then choose a DIFFERENT valid answer with the same prefix and length.",
              "Return JSON: {\"text\":\"...\", \"answer\":\"...\", \"original\":\"...\"}",
              "The answer must start with the prefix and match total length implied by blanks. Never reuse the original answer.",
              "Do not add choices or explanations.",
              `Original: ${sourceText}`,
            ].join("\n")
          : [
              "Create ONE new sentence similar in meaning but NOT a copy.",
              "Change the subject and clause order. Replace key phrases with synonyms.",
              "Do NOT reuse any 3-word sequence from the original.",
              "Ensure at least 30% of content words are different.",
              "Keep EXACT one blank marked with ____.",
              "Return JSON: {\"text\":\"...\", \"answer\":\"...\"}",
              "Do not add choices or explanations.",
              `Original: ${sourceText}`,
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
        if (format === "prefix_blank" && pattern) {
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
        const validation = validateGenerated(rewritten, format);
        if (!validation.ok) {
          llmLastValidationReason = validation.reason || "Format validation failed.";
          continue;
        }
        if (format === "prefix_blank" && pattern) {
          const expectedLen = pattern.prefix.length + pattern.blankCount;
          const rawAnswer = String(parsed.answer || "").trim();
          const lowerPrefix = pattern.prefix.toLowerCase();
          const rawOriginal = String((parsed as { original?: string }).original || "").trim();
          let fullAnswer = rawAnswer;
          if (rawAnswer.toLowerCase().startsWith(lowerPrefix)) {
            fullAnswer = rawAnswer;
          } else if (rawAnswer.length >= pattern.blankCount) {
            const suffix = rawAnswer.slice(0, pattern.blankCount);
            fullAnswer = `${pattern.prefix}${suffix}`;
          } else {
            llmLastValidationReason = "Answer does not start with required prefix.";
            continue;
          }
          if (fullAnswer.length !== expectedLen) {
            llmLastValidationReason = "Answer length does not match blank length.";
            continue;
          }
          parsed.answer = fullAnswer;
          if (!rawOriginal) {
            llmLastValidationReason = "LLM did not provide original answer.";
            continue;
          }
          const normalizedOriginal = rawOriginal.toLowerCase();
          const originalFull = normalizedOriginal.startsWith(lowerPrefix)
            ? normalizedOriginal
            : `${lowerPrefix}${normalizedOriginal}`;
          if (parsed.answer.toLowerCase() === originalFull) {
            llmLastValidationReason = "Answer reused the original word.";
            continue;
          }
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
          return res.json({
            item: {
              text: rewritten,
              correct: parsed.answer,
              distractors: buildDistractorsFromText(rewritten, parsed.answer),
              steps: base.steps,
            },
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
      debug: {
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
    const { sourceText, target } = req.body as {
      sourceText: string;
      target?: { L: number; S: number; A: number; R: number };
    };
    if (!sourceText || typeof sourceText !== "string") {
      return res.status(400).json({ error: "sourceText is required." });
    }
    if (!generationProvider) {
      return res.status(400).json({ error: "Generation provider not configured." });
    }
    const sourceItem = await parseMultipleChoice(sourceText);
    const sourceCombined = normalizeForSimilarity(buildCombinedText(sourceItem));
    const sourceVec = await embeddingProvider.embedText(sourceCombined, 8);
    const sourceCorrect = sourceItem.choices[sourceItem.correctIndex] || "";

    const minSim = 0.4;
    const maxSim = 0.85;
    const maxJaccard = 0.75;

    const hasPassage = Boolean(sourceItem.passage && sourceItem.passage.trim());
    const passageLength = hasPassage ? countWords(sourceItem.passage || "") : 0;
    const passageHint = hasPassage
      ? `Passage length: ${Math.max(60, passageLength - 15)}-${passageLength + 15} words.`
      : "No passage. Only a question.";

    const system =
      "You generate inference multiple-choice questions. Return ONLY valid JSON.";
    const prompt = [
      "Create a NEW multiple-choice question that matches the input format.",
      "Do NOT copy the source. Do NOT reuse any 3-word sequence.",
      "Keep 4 choices with exactly 1 correct answer.",
      "Question type: inference only.",
      passageHint,
      target
        ? `Target profile (L/S/A/R): ${target.L.toFixed(2)}, ${target.S.toFixed(
            2
          )}, ${target.A.toFixed(2)}, ${target.R.toFixed(2)}.`
        : "Target profile: not provided.",
      "Return JSON: {\"passage\": string|null, \"question\": string, \"choices\": [string,string,string,string], \"correctIndex\": 0-3}",
      "Choices must be plain text (no labels).",
      `Source:\n${sourceText}`,
    ].join("\n");

    let llmAttempted = false;
    let llmLastSim: number | null = null;
    let llmLastJaccard: number | null = null;
    let llmLastText: string | null = null;
    let llmLastValidationReason: string | null = null;

    for (let i = 0; i < 3; i += 1) {
      llmAttempted = true;
      const raw = await generationProvider.generateText(prompt, system);
      llmLastText = raw;
      const parsed = extractJsonObject<MultipleChoiceItem>(raw);
      if (!parsed) {
        llmLastValidationReason = "LLM response was not valid JSON.";
        continue;
      }
      parsed.choices = parsed.choices.map(normalizeChoice);
      const error = validateMultipleChoice(parsed);
      if (error) {
        llmLastValidationReason = error;
        continue;
      }
      if (hasPassage && (!parsed.passage || !parsed.passage.trim())) {
        llmLastValidationReason = "Missing passage.";
        continue;
      }
      if (!hasPassage && parsed.passage && parsed.passage.trim().length > 0) {
        parsed.passage = null;
      }
      const correctChoice = parsed.choices[parsed.correctIndex];
      if (correctChoice && correctChoice.trim().toLowerCase() === sourceCorrect.toLowerCase()) {
        llmLastValidationReason = "Correct answer reused from source.";
        continue;
      }
      const combined = normalizeForSimilarity(buildCombinedText(parsed));
      const candidateVec = await embeddingProvider.embedText(combined, 8);
      const sim = cosineSimilarity(sourceVec, candidateVec);
      const jaccard = tokenJaccard(sourceCombined, combined);
      llmLastSim = sim;
      llmLastJaccard = jaccard;
      if (sim >= minSim && sim <= maxSim && jaccard <= maxJaccard) {
        return res.json({
          item: parsed,
          format: "multiple_choice",
          similarity: sim,
          jaccard,
          similarityRange: { min: minSim, max: maxSim, maxJaccard },
        });
      }
      llmLastValidationReason = "Generated problem too similar to source.";
    }

    return res.status(422).json({
      error: "Generated problem too similar to source. Please try again.",
      similarityRange: { min: minSim, max: maxSim, maxJaccard },
      debug: {
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
    const { sourceTexts } = req.body as { sourceTexts: string[] };
    if (!Array.isArray(sourceTexts)) {
      return res.status(400).json({ error: "Expected { sourceTexts: string[] }" });
    }
    if (!generationProvider) {
      return res.status(400).json({ error: "Generation provider not configured." });
    }
    const items = sourceTexts
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
    if (items.length === 0) {
      return res.status(400).json({ error: "sourceTexts must include at least one item." });
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
    const effectiveTolerance = count <= 1 ? 0.1 : count === 2 ? 0.07 : 0.05;

    return res.json({
      mean: { L: mean(Ls), S: mean(Ss), A: mean(As), R: mean(Rs) },
      std: { L: std(Ls), S: std(Ss), A: std(As), R: std(Rs) },
      count,
      stability,
      effectiveTolerance,
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

function extractJson(text: string): { text: string; answer: string } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    if (typeof obj.text === "string" && typeof obj.answer === "string") {
      return { text: obj.text.trim(), answer: obj.answer.trim() };
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

function normalizeChoice(choice: string) {
  return choice
    .replace(/^\s*[A-D][\).:\-]\s*/i, "")
    .replace(/^\s*[A-D]\s+/, "")
    .trim();
}

function validateMultipleChoice(item: MultipleChoiceItem): string | null {
  if (!item.question || typeof item.question !== "string") {
    return "Missing question.";
  }
  if (!Array.isArray(item.choices) || item.choices.length !== 4) {
    return "Expected exactly 4 choices.";
  }
  if (
    typeof item.correctIndex !== "number" ||
    item.correctIndex < 0 ||
    item.correctIndex > 3
  ) {
    return "Invalid correctIndex.";
  }
  return null;
}

function buildCombinedText(item: MultipleChoiceItem) {
  const passage = item.passage ? item.passage.trim() : "";
  return passage ? `${passage}\n\n${item.question}` : item.question;
}

async function parseMultipleChoice(sourceText: string): Promise<MultipleChoiceItem> {
  if (!generationProvider) {
    throw new Error("Generation provider not configured.");
  }
  const system =
    "You extract multiple-choice questions. Return ONLY valid JSON with strict fields.";
  const prompt = [
    "Parse the input into JSON:",
    '{"passage": string|null, "question": string, "choices": [string,string,string,string], "correctIndex": 0-3}',
    "Passage can be null if not present.",
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
