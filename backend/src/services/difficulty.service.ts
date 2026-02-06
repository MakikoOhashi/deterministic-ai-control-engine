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
    sum += cosineSimilarity(correct, d);
  }

  return sum / distractors.length;
}
