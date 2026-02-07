const WORD_REGEX = /[A-Za-z0-9']+/g;
const SENTENCE_REGEX = /[.!?]+/g;
const CONJUNCTIONS = new Set([
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
]);

export function tokenizeWords(text: string): string[] {
  const matches = text.match(WORD_REGEX);
  return matches ? matches : [];
}

export function countWords(text: string): number {
  return tokenizeWords(text).length;
}

export function averageWordLength(text: string): number {
  const words = tokenizeWords(text);
  if (words.length === 0) return 0;
  const total = words.reduce((sum, w) => sum + w.length, 0);
  return total / words.length;
}

export function countSentences(text: string): number {
  const matches = text.match(SENTENCE_REGEX);
  return matches ? matches.length : text.trim() ? 1 : 0;
}

export function countConjunctions(text: string): number {
  const words = tokenizeWords(text.toLowerCase());
  let count = 0;
  for (const w of words) {
    if (CONJUNCTIONS.has(w)) count += 1;
  }
  return count;
}
