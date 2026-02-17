export const API_VERSION = "v1" as const;

export type Components = {
  L: number;
  S: number;
  A: number;
  R: number;
};

export type SimilarityBreakdown = {
  passage: number | null;
  question: number | null;
  correctChoice: number | null;
  distractors: number | null;
  choices: number | null;
};

export type ChoiceStructure = {
  correctMeanSim: number;
  distractorMeanSim: number;
  distractorVariance: number;
  isolationIndex: number;
};

export type ChoiceIntent = {
  concept: string;
  patterns: string[];
};

export type MultipleChoiceItem = {
  passage?: string | null;
  question: string;
  choices: string[];
  correctIndex: number;
};

export type GenerateMcRequest = {
  sourceText: string;
  target?: Components;
  mode?: "A" | "B";
  inferenceStyle?: "fact_based" | "intent_based" | "emotional";
};

export type GenerateMcSuccess = {
  ok: true;
  apiVersion: typeof API_VERSION;
  item: MultipleChoiceItem;
  format: "multiple_choice";
  similarity: number;
  jaccard: number;
  similarityRange: { min: number; max: number; maxJaccard: number };
  similarityBreakdown: SimilarityBreakdown;
  mode: "A";
  choiceIntent?: ChoiceIntent;
  choiceStructure: ChoiceStructure | null;
  similarityWarning?: string;
  passageWarning?: string;
  runId?: string;
  sourceId?: string;
  candidateId?: string;
  debug?: { stage?: string };
};

export type GenerateMcErrorType = "VALIDATION_FAILED" | "SIMILARITY_REJECTED" | "BAD_REQUEST";

export type GenerateMcError = {
  ok: false;
  apiVersion: typeof API_VERSION;
  error: string;
  errorType: GenerateMcErrorType;
  runId?: string;
  sourceId?: string;
  similarityRange?: { min: number; max: number; maxJaccard: number };
  reason?: string | null;
  debug?: Record<string, unknown>;
};

export type GenerateMcResponse = GenerateMcSuccess | GenerateMcError;

export type TargetFromSourcesMcRequest = {
  sourceTexts: string[];
};

export type TargetFromSourcesMcSuccess = {
  ok: true;
  apiVersion: typeof API_VERSION;
  mean: Components;
  std: Components;
  axisTolerance: Components;
  targetBand: { min: Components; max: Components };
  count: number;
  stability: "Low" | "Medium" | "High";
  effectiveTolerance: number;
};

export type TargetFromSourcesMcError = {
  ok: false;
  apiVersion: typeof API_VERSION;
  error: string;
  errorType: "BAD_REQUEST";
};

export type TargetFromSourcesMcResponse = TargetFromSourcesMcSuccess | TargetFromSourcesMcError;
