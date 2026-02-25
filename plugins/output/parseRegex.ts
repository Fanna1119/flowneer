// ---------------------------------------------------------------------------
// parseRegex — extract structured data via regex groups
// ---------------------------------------------------------------------------

/**
 * Extracts named groups from LLM text using a regular expression.
 *
 * @param text     The raw LLM output.
 * @param pattern  A RegExp with named capture groups, or a string pattern.
 * @param groups   When `pattern` is a string without named groups, provide
 *                 an array of group names to map positional captures.
 *
 * @returns An object mapping group names to captured strings.
 *          Returns `null` if the pattern does not match.
 *
 * @example
 * // Named groups
 * const r = parseRegexOutput(
 *   "Action: search Query: quantum computing",
 *   /Action:\s*(?<action>\w+)\s+Query:\s*(?<query>.+)/,
 * );
 * // { action: "search", query: "quantum computing" }
 *
 * @example
 * // Positional groups
 * const r = parseRegexOutput(
 *   "SCORE: 8/10",
 *   "SCORE:\\s*(\\d+)/(\\d+)",
 *   ["score", "total"],
 * );
 * // { score: "8", total: "10" }
 */
export function parseRegexOutput(
  text: string,
  pattern: RegExp | string,
  groups?: string[],
): Record<string, string> | null {
  const re = typeof pattern === "string" ? new RegExp(pattern) : pattern;
  const match = re.exec(text);
  if (!match) return null;

  // Named groups take priority
  if (match.groups && Object.keys(match.groups).length > 0) {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(match.groups)) {
      result[key] = value ?? "";
    }
    return result;
  }

  // Fall back to positional captures + group names
  if (groups && groups.length > 0) {
    const result: Record<string, string> = {};
    for (let i = 0; i < groups.length; i++) {
      result[groups[i]!] = match[i + 1] ?? "";
    }
    return result;
  }

  // Return all positional captures indexed by "group_N"
  const result: Record<string, string> = {};
  for (let i = 1; i < match.length; i++) {
    result[`group_${i}`] = match[i] ?? "";
  }
  return result;
}
