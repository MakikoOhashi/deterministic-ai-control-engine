import type { ProblemFormat } from "./format-classifier.service.js";

const BLANK_REGEX = /(_\s*){2,}/g;
const MC_REGEX = /^\s*(A|B|C|D)[\).]/m;
const PREFIX_REGEX = /(?:\b[A-Za-z]\s){3,}(_\s*){2,}/;

export function validateGenerated(text: string, format: ProblemFormat): {
  ok: boolean;
  reason?: string;
} {
  const hasMC = MC_REGEX.test(text);
  const blanks = text.match(BLANK_REGEX) || [];
  const hasPrefix = PREFIX_REGEX.test(text);

  if (format === "multiple_choice") {
    return { ok: hasMC, reason: hasMC ? undefined : "Missing multiple-choice options." };
  }

  if (format === "full_blank") {
    if (hasMC) return { ok: false, reason: "Unexpected multiple-choice options." };
    if (blanks.length !== 1) {
      return { ok: false, reason: "Expected exactly one blank." };
    }
    return { ok: true };
  }

  if (format === "prefix_blank") {
    if (hasMC) return { ok: false, reason: "Unexpected multiple-choice options." };
    if (blanks.length !== 1) {
      return { ok: false, reason: "Expected exactly one blank." };
    }
    if (!hasPrefix) {
      return { ok: false, reason: "Expected prefix hint before blank." };
    }
    return { ok: true };
  }

  if (format === "constructed_response") {
    if (hasMC) return { ok: false, reason: "Unexpected multiple-choice options." };
    if (blanks.length > 0) return { ok: false, reason: "Unexpected blank in response." };
    return { ok: true };
  }

  return { ok: false, reason: "Unknown format." };
}
