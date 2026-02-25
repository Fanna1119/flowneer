// ---------------------------------------------------------------------------
// parseList — extract a list from LLM output
// ---------------------------------------------------------------------------

/**
 * Parses a bulleted / numbered / newline-separated list from LLM text.
 *
 * Handles:
 * - `- item`, `* item`, `• item`
 * - `1. item`, `1) item`
 * - Plain newline-separated items
 *
 * Empty lines and whitespace-only entries are stripped.
 *
 * @example
 * const items = parseListOutput("- apples\n- bananas\n- oranges");
 * // ["apples", "bananas", "oranges"]
 */
export function parseListOutput(text: string): string[] {
  return text
    .split(/\n/)
    .map((line) =>
      line
        .trim()
        // Strip common list prefixes
        .replace(/^(?:[-*•]|\d+[.)]\s*)/, "")
        .trim(),
    )
    .filter((line) => line.length > 0);
}
