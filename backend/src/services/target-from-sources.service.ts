import type { EmbeddingProvider } from "../providers/embedding.provider.js";
import { computeLexicalComplexity, computeStructuralComplexity } from "./lexical-structural.service.js";
import { semanticAmbiguityA } from "./difficulty.service.js";
import { normalizeReasoningDepth } from "./reasoning-depth.service.js";
import { generateFillBlankCandidates } from "./fill-blank.service.js";

export interface ProfileStats {
  mean: { L: number; S: number; A: number; R: number };
  std: { L: number; S: number; A: number; R: number };
  axisTolerance: { L: number; S: number; A: number; R: number };
  targetBand: {
    min: { L: number; S: number; A: number; R: number };
    max: { L: number; S: number; A: number; R: number };
  };
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
  if (count <= 1) return 0.12;
  if (count === 2) return 0.07;
  return 0.05;
}

function axisTolerance(meanVal: number, stdVal: number, count: number) {
  const base = count <= 1 ? 0.12 : count === 2 ? 0.08 : 0.05;
  const adaptive = stdVal > 0 ? stdVal * 1.5 : base;
  const tol = Math.max(base, adaptive);
  return Math.min(Math.max(tol, 0.03), 0.25);
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
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
  const meanProfile = { L: mean(Ls), S: mean(Ss), A: mean(As), R: mean(Rs) };
  const stdProfile = { L: std(Ls), S: std(Ss), A: std(As), R: std(Rs) };
  const axisTol = {
    L: axisTolerance(meanProfile.L, stdProfile.L, count),
    S: axisTolerance(meanProfile.S, stdProfile.S, count),
    A: axisTolerance(meanProfile.A, stdProfile.A, count),
    R: axisTolerance(meanProfile.R, stdProfile.R, count),
  };
  return {
    mean: meanProfile,
    std: stdProfile,
    axisTolerance: axisTol,
    targetBand: {
      min: {
        L: clamp01(meanProfile.L - axisTol.L),
        S: clamp01(meanProfile.S - axisTol.S),
        A: clamp01(meanProfile.A - axisTol.A),
        R: clamp01(meanProfile.R - axisTol.R),
      },
      max: {
        L: clamp01(meanProfile.L + axisTol.L),
        S: clamp01(meanProfile.S + axisTol.S),
        A: clamp01(meanProfile.A + axisTol.A),
        R: clamp01(meanProfile.R + axisTol.R),
      },
    },
    count,
    stability: stabilityFromCount(count),
    effectiveTolerance: toleranceFromCount(count),
  };
}
