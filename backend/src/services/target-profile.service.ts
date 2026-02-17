import type { EmbeddingProvider } from "../providers/embedding.provider.js";
import type { BaselineItem } from "../config/baseline.items.js";
import { computeLexicalComplexity, computeStructuralComplexity } from "./lexical-structural.service.js";
import { semanticAmbiguityA } from "./difficulty.service.js";
import { normalizeReasoningDepth } from "./reasoning-depth.service.js";

export interface TargetProfile {
  L: number;
  S: number;
  A: number;
  R: number;
}

export async function computeTargetProfile(
  items: BaselineItem[],
  provider: EmbeddingProvider,
  maxSteps = 5
): Promise<TargetProfile> {
  if (items.length === 0) {
    throw new Error("Baseline items are required to compute target profile.");
  }

  let sumL = 0;
  let sumS = 0;
  let sumA = 0;
  let sumR = 0;

  for (const item of items) {
    const lexical = computeLexicalComplexity(item.text);
    const structural = computeStructuralComplexity(item.text);
    const correctVec = await provider.embedText(item.correct, 8);
    const distractorVecs = await provider.embedTexts(item.distractors, 8);
    const A = semanticAmbiguityA(correctVec, distractorVecs);
    const R = normalizeReasoningDepth(item.steps, maxSteps);

    sumL += lexical.L;
    sumS += structural.S;
    sumA += A;
    sumR += R;
  }

  const n = items.length;
  return {
    L: sumL / n,
    S: sumS / n,
    A: sumA / n,
    R: sumR / n,
  };
}
