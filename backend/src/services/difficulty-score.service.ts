export interface DifficultyComponents {
  L: number;
  S: number;
  A: number;
  R: number;
}

export interface DifficultyWeights {
  wL: number;
  wS: number;
  wA: number;
  wR: number;
}

export const DEFAULT_WEIGHTS: DifficultyWeights = {
  wL: 0.2,
  wS: 0.2,
  wA: 0.3,
  wR: 0.3,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Component values must be finite numbers.");
  }
  return Math.min(Math.max(value, 0), 1);
}

export function computeDifficultyScore(
  components: DifficultyComponents,
  weights: DifficultyWeights = DEFAULT_WEIGHTS
): { D: number; components: DifficultyComponents; weights: DifficultyWeights } {
  const L = clamp01(components.L);
  const S = clamp01(components.S);
  const A = clamp01(components.A);
  const R = clamp01(components.R);

  const D = weights.wL * L + weights.wS * S + weights.wA * A + weights.wR * R;
  return {
    D,
    components: { L, S, A, R },
    weights,
  };
}
