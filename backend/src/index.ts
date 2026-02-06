import express from "express";
import { semanticAmbiguityA } from "./services/difficulty.service.js";

const app = express();
app.use(express.json());

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

const PORT = 3001;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
