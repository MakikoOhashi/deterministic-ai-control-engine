import express from "express";
import { semanticAmbiguityA } from "./services/difficulty.service.js";
import {
  DummyEmbeddingProvider,
  type EmbeddingProvider,
} from "./providers/embedding.provider.js";

const app = express();
app.use(express.json());

const embeddingProvider: EmbeddingProvider = new DummyEmbeddingProvider();

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
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

const PORT = 3001;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
