import type { EmbeddingProvider } from "../providers/embedding.provider.js";
import { computeLexicalComplexity, computeStructuralComplexity } from "./lexical-structural.service.js";
import { semanticAmbiguityA } from "./difficulty.service.js";
import { normalizeReasoningDepth } from "./reasoning-depth.service.js";
import { generateFillBlankCandidates } from "./fill-blank.service.js";

export interface ProfileStats {
  mean: { L: number; S: number; A: number; R: number };
  std: { L: number; S: number; A: number; R: number };
  count: number;
  stability: "Low" | "Medium" | "High";
  effectiveTolerance: number;
}

function mean(values: number[]) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[]) {
  if (values.length <= 1) return 0;
  const m = mean(values);
  const variance = mean(values.map((v) => (v - m) ** 2));
  return Math.sqrt(variance);
}

function stabilityFromCount(count: number) {
  if (count <= 1) return "Low";
  if (count === 2) return "Medium";
  return "High";
}

function toleranceFromCount(count: number) {
  if (count <= 1) return 0.1;
  if (count === 2) return 0.07;
  return 0.05;
}

export async function computeTargetFromSources(
  sourceTexts: string[],
  provider: EmbeddingProvider,
  maxSteps = 5
): ProfileStats {
  const items = sourceTexts.filter((s) => s.trim().length > 0);
  if (items.length === 0) {
    throw new Error("sourceTexts must include at least one item.");
  }

  const Ls: number[] = [];
  const Ss: number[] = [];
  const As: number[] = [];
  const Rs: number[] = [];

  for (const source of items) {
    const candidate = generateFillBlankCandidates(source)[0];
    const evalText = candidate?.text ?? source;
    const evalCorrect =
      candidate?.correct ??
      (source.match(/[A-Za-z]{4,}/)?.[0] || "answer");
    const evalDistractors = candidate?.distractors ?? ["option", "sample", "value"];
    const evalSteps = candidate?.steps ?? 2;

    const lexical = computeLexicalComplexity(evalText);
    const structural = computeStructuralComplexity(evalText);
    const correctVec = await provider.embedText(evalCorrect, 8);
    const distractorVecs = await provider.embedTexts(evalDistractors, 8);
    const A = semanticAmbiguityA(correctVec, distractorVecs);
    const R = normalizeReasoningDepth(evalSteps, maxSteps);
    Ls.push(lexical.L);
    Ss.push(structural.S);
    As.push(A);
    Rs.push(R);
  }

  const count = items.length;
  return {
    mean: { L: mean(Ls), S: mean(Ss), A: mean(As), R: mean(Rs) },
    std: { L: std(Ls), S: std(Ss), A: std(As), R: std(Rs) },
    count,
    stability: stabilityFromCount(count),
    effectiveTolerance: toleranceFromCount(count),
  };
}
