import express from "express";
import { semanticAmbiguityA } from "./services/difficulty.service.js";
import {
  DummyEmbeddingProvider,
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
import { generateFillBlank, generateFillBlankCandidates } from "./services/fill-blank.service.js";
import { computeTargetFromSources } from "./services/target-from-sources.service.js";

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

const embeddingProvider: EmbeddingProvider = new DummyEmbeddingProvider();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/difficulty/weights", (_req, res) => {
  res.json({ weights: DIFFICULTY_WEIGHTS });
});

app.get("/config/target-profile", (_req, res) => {
  try {
    const target = computeTargetProfile(BASELINE_ITEMS, embeddingProvider, 5);
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

app.post("/difficulty/semantic-ambiguity/text", (req, res) => {
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
    const correctVec = embeddingProvider.embedText(correct, dim);
    const distractorVecs = embeddingProvider.embedTexts(distractors, dim);
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

app.post("/difficulty/overall", (req, res) => {
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
    const correctVec = embeddingProvider.embedText(correct, dim);
    const distractorVecs = embeddingProvider.embedTexts(distractors, dim);

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

app.post("/generate/fill-blank", (req, res) => {
  try {
    const { sourceText, target } = req.body as {
      sourceText: string;
      target?: { L: number; S: number; A: number; R: number };
    };
    if (typeof sourceText !== "string") {
      return res.status(400).json({ error: "Expected { sourceText: string }" });
    }
    const candidates = generateFillBlankCandidates(sourceText);
    if (!target) {
      return res.json({ item: candidates[0], candidates });
    }
    const scored = candidates.map((c) => {
      const lexical = computeLexicalComplexity(c.text);
      const structural = computeStructuralComplexity(c.text);
      const correctVec = embeddingProvider.embedText(c.correct, 8);
      const distractorVecs = embeddingProvider.embedTexts(c.distractors, 8);
      const A = semanticAmbiguityA(correctVec, distractorVecs);
      const R = normalizeReasoningDepth(c.steps, 5);
      const d =
        (lexical.L - target.L) ** 2 +
        (structural.S - target.S) ** 2 +
        (A - target.A) ** 2 +
        (R - target.R) ** 2;
      return { item: c, distance: Math.sqrt(d) };
    });
    scored.sort((a, b) => a.distance - b.distance);
    return res.json({ item: scored[0].item, candidates: scored });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
});

app.post("/target/from-sources", (req, res) => {
  try {
    const { sourceTexts } = req.body as { sourceTexts: string[] };
    if (!Array.isArray(sourceTexts)) {
      return res.status(400).json({ error: "Expected { sourceTexts: string[] }" });
    }
    const stats = computeTargetFromSources(sourceTexts, embeddingProvider, 5);
    return res.json(stats);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(400).json({ error: message });
  }
});

const PORT = 3001;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
