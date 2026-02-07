import {
  averageWordLength,
  countConjunctions,
  countSentences,
  countWords,
} from "../utils/text-metrics.js";

export interface MinMax {
  min: number;
  max: number;
}

export interface LexicalConfig {
  wordCount: MinMax;
  avgWordLength: MinMax;
}

export interface StructuralConfig {
  sentenceCount: MinMax;
  clauseCount: MinMax;
}

export interface LexicalResult {
  L: number;
  wordCount: number;
  avgWordLength: number;
  wordCountNorm: number;
  avgWordLengthNorm: number;
}

export interface StructuralResult {
  S: number;
  sentenceCount: number;
  conjunctionCount: number;
  clauseCount: number;
  sentenceCountNorm: number;
  clauseCountNorm: number;
}

const DEFAULT_LEXICAL: LexicalConfig = {
  wordCount: { min: 5, max: 150 },
  avgWordLength: { min: 3, max: 8 },
};

const DEFAULT_STRUCTURAL: StructuralConfig = {
  sentenceCount: { min: 1, max: 10 },
  clauseCount: { min: 0, max: 8 },
};

function minMaxNormalize(value: number, range: MinMax): number {
  if (range.max <= range.min) {
    throw new Error("Invalid min/max range.");
  }
  const clamped = Math.min(Math.max(value, range.min), range.max);
  return (clamped - range.min) / (range.max - range.min);
}

export function computeLexicalComplexity(
  text: string,
  config: LexicalConfig = DEFAULT_LEXICAL
): LexicalResult {
  const wordCount = countWords(text);
  const avgWordLength = averageWordLength(text);
  const wordCountNorm = minMaxNormalize(wordCount, config.wordCount);
  const avgWordLengthNorm = minMaxNormalize(avgWordLength, config.avgWordLength);
  const L = 0.5 * wordCountNorm + 0.5 * avgWordLengthNorm;
  return { L, wordCount, avgWordLength, wordCountNorm, avgWordLengthNorm };
}

export function computeStructuralComplexity(
  text: string,
  config: StructuralConfig = DEFAULT_STRUCTURAL
): StructuralResult {
  const sentenceCount = countSentences(text);
  const conjunctionCount = countConjunctions(text);
  const clauseCount = conjunctionCount;
  const sentenceCountNorm = minMaxNormalize(sentenceCount, config.sentenceCount);
  const clauseCountNorm = minMaxNormalize(clauseCount, config.clauseCount);
  const S = 0.6 * clauseCountNorm + 0.4 * sentenceCountNorm;
  return {
    S,
    sentenceCount,
    conjunctionCount,
    clauseCount,
    sentenceCountNorm,
    clauseCountNorm,
  };
}
