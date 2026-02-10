const WORD_REGEX = /[A-Za-z']+/g;
const PREFIX_TOKEN_REGEX = /([A-Za-z]+)\s*((?:_\s*){2,})/;
const COMMON_WORDS = [
  "daily",
  "problem",
  "progress",
  "process",
  "produce",
  "fat",
  "few",
  "fuel",
  "low",
  "long",
  "lost",
  "late",
  "last",
  "list",
  "line",
  "light",
  "local",
  "likely",
  "little",
  "public",
  "private",
  "simple",
  "single",
  "strong",
  "steady",
  "swimming",
  "swimmer",
  "swim",
  "swing",
  "choose",
  "change",
  "chance",
  "sudden",
  "silver",
  "silent",
];

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

export function buildDistractorsFromText(text: string, target: string): string[] {
  return buildDistractors(text, target);
}

export function getBlankPattern(sourceText: string): {
  prefix: string;
  blanks: string;
  blankCount: number;
} | null {
  const match = sourceText.match(PREFIX_TOKEN_REGEX);
  if (!match) return null;
  const prefix = match[1];
  const blanks = match[2] || "";
  const blankCount = (blanks.match(/_/g) || []).length;
  return { prefix, blanks, blankCount };
}

function preprocessSource(sourceText: string, preserveBlanks = false): string {
  const lines = sourceText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const filtered = lines.filter(
    (l) => !/complete the sentence|choose the correct/i.test(l)
  );
  const joined = (filtered.length > 0 ? filtered : lines).join(" ");
  if (preserveBlanks) return joined;
  return joined.replace(/(_\s*){2,}/g, "");
}

export function normalizeForSimilarity(sourceText: string): string {
  return preprocessSource(sourceText)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function generateFillBlank(sourceText: string, mode: "first" | "longest" | "last" = "first"): {
  text: string;
  correct: string;
  distractors: string[];
  steps: number;
} {
  const prefixMatch = sourceText.match(PREFIX_TOKEN_REGEX);
  const cleaned = preprocessSource(sourceText);
  const cleanedWithBlanks = preprocessSource(sourceText, true);
  const sentences = splitSentences(cleaned);
  if (sentences.length === 0) {
    throw new Error("sourceText must contain at least one sentence.");
  }
  const sentence = sentences.reduce((a, b) => (a.length >= b.length ? a : b));
  let target = pickTargetWord(sentence, mode);
  if (!target) {
    throw new Error("No suitable target word found.");
  }
  let blanked = sentence.replace(target, "____");
  if (/(_\s*){2,}/.test(cleanedWithBlanks)) {
    blanked = cleanedWithBlanks;
  }

  if (prefixMatch) {
    const prefix = prefixMatch[1];
    const blanks = prefixMatch[2] || "";
    const blankCount = (blanks.match(/_/g) || []).length;
    const desiredLen = prefix.length + blankCount;
    const candidate = COMMON_WORDS.find(
      (w) => w.startsWith(prefix.toLowerCase()) && w.length === desiredLen
    );
    if (candidate) {
      target = candidate;
    } else {
      const fallback = prefix + "e".repeat(Math.max(blankCount, 1));
      target = fallback;
    }
    if (prefix && blanks) {
      blanked = cleanedWithBlanks.replace(PREFIX_TOKEN_REGEX, `${prefix}${blanks}`);
    } else {
      blanked = sentence.replace(target, `${prefix}${blanks}`);
    }
  }

  const normalizedBlanked = blanked.replace(/\s+/g, " ").trim();
  const normalizedSource = cleanedWithBlanks.replace(/\s+/g, " ").trim();
  if (normalizedBlanked === normalizedSource) {
    const lowered =
      blanked.length > 0
        ? blanked.charAt(0).toLowerCase() + blanked.slice(1)
        : blanked;
    blanked = `It can be difficult to ${lowered}`;
  }

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
