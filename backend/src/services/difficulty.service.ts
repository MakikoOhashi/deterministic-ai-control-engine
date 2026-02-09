import { cosineSimilarity } from "../utils/cosine.js";

export function semanticAmbiguityA(
  correct: number[],
  distractors: number[][]
): number {
  if (distractors.length === 0) {
    throw new Error("At least one distractor is required.");
  }

  let sum = 0;
  for (const d of distractors) {
    // Normalize cosine similarity from [-1, 1] to [0, 1]
    const sim = cosineSimilarity(correct, d);
    const normalized = Math.min(Math.max((sim + 1) / 2, 0), 1);
    sum += normalized;
  }

  return sum / distractors.length;
}
