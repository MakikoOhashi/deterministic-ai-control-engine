const WORD_REGEX = /[A-Za-z0-9']+/g;
const SENTENCE_REGEX = /[.!?。！？]+/g;
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
  "しかし",
  "だが",
  "一方",
  "つまり",
  "また",
  "さらに",
  "そして",
  "そのため",
  "したがって",
  "なお",
  "ただし",
  "もし",
  "または",
  "あるいは",
]);

export function tokenizeWords(text: string): string[] {
  const matches = text.match(WORD_REGEX);
  return matches ? matches : [];
}

function isJapanese(text: string) {
  return /[\u3040-\u30ff\u4e00-\u9faf]/.test(text);
}

function japaneseTokens(text: string): string[] {
  const cleaned = text.replace(/\s+/g, "");
  if (!cleaned) return [];
  const grams: string[] = [];
  for (let i = 0; i < cleaned.length - 1; i += 1) {
    grams.push(cleaned.slice(i, i + 2));
  }
  return grams.length > 0 ? grams : [cleaned];
}

export function countWords(text: string): number {
  if (isJapanese(text)) return japaneseTokens(text).length;
  return tokenizeWords(text).length;
}

export function averageWordLength(text: string): number {
  if (isJapanese(text)) {
    const tokens = japaneseTokens(text);
    if (tokens.length === 0) return 0;
    const total = tokens.reduce((sum, t) => sum + t.length, 0);
    return total / tokens.length;
  }
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
  const words = isJapanese(text) ? japaneseTokens(text) : tokenizeWords(text.toLowerCase());
  let count = 0;
  for (const w of words) {
    if (CONJUNCTIONS.has(w)) count += 1;
  }
  return count;
}
