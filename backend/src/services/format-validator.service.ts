import type { ProblemFormat } from "./format-classifier.service.js";

const BLANK_REGEX = /(_\s*){2,}/g;
const MC_REGEX = /^\s*(A|B|C|D)[\).]/m;
// Accept both "fa__" and spaced variants like "fa _ _".
const PREFIX_REGEX = /[A-Za-z]{1,5}\s*(?:_\s*){2,}/g;

export function validateGenerated(
  text: string,
  format: ProblemFormat,
  opts?: { expectedBlankCount?: number }
): {
  ok: boolean;
  reason?: string;
} {
  const hasMC = MC_REGEX.test(text);
  const blanks = text.match(BLANK_REGEX) || [];
  const hasPrefix = (text.match(PREFIX_REGEX) || []).length > 0;
  const expectedBlankCount = opts?.expectedBlankCount ?? 1;

  if (format === "multiple_choice") {
    return { ok: hasMC, reason: hasMC ? undefined : "Missing multiple-choice options." };
  }

  if (format === "full_blank") {
    if (hasMC) return { ok: false, reason: "Unexpected multiple-choice options." };
    if (blanks.length !== expectedBlankCount) {
      return {
        ok: false,
        reason: `Expected exactly ${expectedBlankCount} blank${expectedBlankCount > 1 ? "s" : ""}.`,
      };
    }
    return { ok: true };
  }

  if (format === "prefix_blank") {
    if (hasMC) return { ok: false, reason: "Unexpected multiple-choice options." };
    if (blanks.length !== expectedBlankCount) {
      return {
        ok: false,
        reason: `Expected exactly ${expectedBlankCount} blank${expectedBlankCount > 1 ? "s" : ""}.`,
      };
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
