// ---------------------------------------------------------------------------
// parseJson — extract and parse JSON from LLM output
// ---------------------------------------------------------------------------

import type { Validator } from "../../Flowneer";

/**
 * Extract and parse JSON from a (possibly noisy) LLM response.
 *
 * Handles common cases:
 * - Raw JSON string
 * - JSON wrapped in markdown code fences (```json ... ```)
 * - JSON embedded in surrounding prose (first `{` to last `}`)
 *
 * When a `validator` is provided the parsed value is passed through
 * `validator.parse()` for type-safe validation.
 *
 * @example
 * const data = parseJsonOutput<{ name: string }>(llmText, myZodSchema);
 */
export function parseJsonOutput<T = unknown>(
  text: string,
  validator?: Validator<T>,
): T {
  // 1. Try direct parse first
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // 2. Try stripping markdown code fences
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try {
        parsed = JSON.parse(fenced[1]!.trim());
      } catch {
        /* fall through */
      }
    }

    // 3. Extract first JSON object/array
    if (parsed === undefined) {
      const firstBrace = text.indexOf("{");
      const firstBracket = text.indexOf("[");
      const start =
        firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket)
          ? firstBrace
          : firstBracket;
      if (start >= 0) {
        const opener = text[start];
        const closer = opener === "{" ? "}" : "]";
        const lastClose = text.lastIndexOf(closer);
        if (lastClose > start) {
          try {
            parsed = JSON.parse(text.slice(start, lastClose + 1));
          } catch {
            /* fall through */
          }
        }
      }
    }

    if (parsed === undefined) {
      throw new Error(
        `parseJsonOutput: could not extract valid JSON from input`,
      );
    }
  }

  if (validator) return validator.parse(parsed);
  return parsed as T;
}
