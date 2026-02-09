export type ProblemType = "selection" | "fill_blank" | "constructed" | "transformation";
export type BlankType = "none" | "full" | "prefix";
export type CEFR = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export interface StructureInput {
  problemType: ProblemType;
  reasoningSteps: 1 | 2 | 3;
  blankType: BlankType;
  cefr: CEFR;
}

export interface StructureTarget {
  mean: { L: number; S: number; A: number; R: number };
  stability: "Medium";
  effectiveTolerance: number;
}

const CEFR_L: Record<CEFR, number> = {
  A1: 0.2,
  A2: 0.3,
  B1: 0.4,
  B2: 0.5,
  C1: 0.6,
  C2: 0.7,
};

const TYPE_S: Record<ProblemType, number> = {
  selection: 0.35,
  fill_blank: 0.4,
  constructed: 0.55,
  transformation: 0.5,
};

const TYPE_A: Record<ProblemType, number> = {
  selection: 0.45,
  fill_blank: 0.35,
  constructed: 0.2,
  transformation: 0.25,
};

const STEPS_R: Record<1 | 2 | 3, number> = {
  1: 0.25,
  2: 0.5,
  3: 0.75,
};

export function targetFromStructure(input: StructureInput): StructureTarget {
  const L = Math.min(
    CEFR_L[input.cefr] + (input.blankType === "prefix" ? 0.05 : 0),
    1
  );
  const S = TYPE_S[input.problemType];
  const A = Math.min(
    TYPE_A[input.problemType] + (input.blankType === "prefix" ? 0.05 : 0),
    1
  );
  const R = STEPS_R[input.reasoningSteps];

  return {
    mean: { L, S, A, R },
    stability: "Medium",
    effectiveTolerance: 0.07,
  };
}
