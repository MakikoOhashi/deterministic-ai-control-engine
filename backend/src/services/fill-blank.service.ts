const WORD_REGEX = /[A-Za-z']+/g;

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "because",
  "although",
  "since",
  "while",
  "whereas",
  "if",
  "when",
  "though",
  "unless",
  "however",
  "therefore",
  "moreover",
  "so",
  "yet",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "as",
  "by",
  "at",
  "from",
  "that",
  "this",
  "these",
  "those",
  "it",
  "its",
  "their",
  "his",
  "her",
  "we",
  "you",
  "they",
  "i",
]);

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractWords(text: string): string[] {
  const matches = text.match(WORD_REGEX);
  return matches ? matches : [];
}

function pickTargetWord(sentence: string, mode: "first" | "longest" | "last" = "first"): string {
  const words = extractWords(sentence);
  const candidates = words.filter(
    (w) => w.length >= 5 && !STOPWORDS.has(w.toLowerCase())
  );
  if (candidates.length > 0) {
    if (mode === "last") return candidates[candidates.length - 1];
    if (mode === "longest") {
      return candidates.reduce((a, b) => (a.length >= b.length ? a : b));
    }
    return candidates[0];
  }
  if (words.length > 0) {
    if (mode === "last") return words[words.length - 1];
    if (mode === "longest") {
      return words.reduce((a, b) => (a.length >= b.length ? a : b));
    }
    return words[0];
  }
  return "";
}

function buildDistractors(sentence: string, target: string): string[] {
  const words = extractWords(sentence)
    .map((w) => w)
    .filter((w) => w.toLowerCase() !== target.toLowerCase());
  const unique = Array.from(new Set(words));
  const distractors = unique.filter((w) => w.length >= 4).slice(0, 3);
  while (distractors.length < 3) {
    distractors.push(["early", "happy", "warm"][distractors.length % 3]);
  }
  return distractors;
}

export function generateFillBlank(sourceText: string, mode: "first" | "longest" | "last" = "first"): {
  text: string;
  correct: string;
  distractors: string[];
  steps: number;
} {
  const sentences = splitSentences(sourceText);
  if (sentences.length === 0) {
    throw new Error("sourceText must contain at least one sentence.");
  }
  const sentence = sentences.reduce((a, b) => (a.length >= b.length ? a : b));
  const target = pickTargetWord(sentence, mode);
  if (!target) {
    throw new Error("No suitable target word found.");
  }
  const blanked = sentence.replace(target, "____");
  const distractors = buildDistractors(sentence, target);
  const wordCount = extractWords(sentence).length;
  const steps = wordCount >= 12 ? 2 : 1;
  return {
    text: blanked,
    correct: target,
    distractors,
    steps,
  };
}

export function generateFillBlankCandidates(sourceText: string) {
  return [
    generateFillBlank(sourceText, "first"),
    generateFillBlank(sourceText, "longest"),
    generateFillBlank(sourceText, "last"),
  ];
}
