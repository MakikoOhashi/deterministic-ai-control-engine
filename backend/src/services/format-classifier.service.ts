export type ProblemFormat =
  | "multiple_choice"
  | "full_blank"
  | "prefix_blank"
  | "constructed_response"
  | "unknown";

const BLANK_REGEX = /(_\s*){2,}/;
const MC_REGEX = /^\s*(A|B|C|D)[\).]/m;
const PREFIX_REGEX = /(?:\b[A-Za-z]\s){3,}(_\s*){2,}/;

export function classifyFormat(sourceText: string): ProblemFormat {
  const text = sourceText.trim();
  if (!text) return "unknown";

  const hasBlank = BLANK_REGEX.test(text);
  const hasMC = MC_REGEX.test(text);
  const hasPrefix = PREFIX_REGEX.test(text);

  if (hasBlank && hasPrefix) return "prefix_blank";
  if (hasBlank) return "full_blank";
  if (hasMC) return "multiple_choice";

  return "constructed_response";
}
