export function normalizeReasoningDepth(
  steps: number,
  maxSteps = 5
): number {
  if (!Number.isFinite(steps)) {
    throw new Error("steps must be a finite number.");
  }
  if (!Number.isFinite(maxSteps) || maxSteps <= 0) {
    throw new Error("maxSteps must be a positive number.");
  }
  if (steps < 0) {
    throw new Error("steps must be >= 0.");
  }

  return Math.min(steps / maxSteps, 1);
}
