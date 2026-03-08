// ---------------------------------------------------------------------------
// generateUntilValid — generate → validate → retry with error context
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import type { NodeFn } from "../../Flowneer";

export interface GenerateUntilValidOptions<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * Generator step — produces the output.
   * On retries, `(shared as any).__validationError` holds the previous
   * validation error message so the generator can correct its output.
   */
  generate: NodeFn<S, P>;
  /**
   * Validator — return `true` when the output is acceptable, or a string
   * describing why it failed (placed on `(shared as any).__validationError`
   * for the next generation attempt).
   */
  validate: (shared: S, params: P) => true | string | Promise<true | string>;
  /** Maximum generation attempts. Defaults to 3. */
  maxAttempts?: number;
}

/**
 * Generate-until-valid loop: generate → validate → if invalid, regenerate
 * with the error as context, repeat up to `maxAttempts`.
 *
 * Distinct from the `withStructuredOutput` plugin (which hooks into every
 * step) — this is a self-contained flow for wrapping a single generation
 * step with retry logic.
 *
 * After the loop, `(shared as any).__validationError` is `undefined` on
 * success, or holds the last error if all attempts failed.
 *
 * @example
 * const flow = generateUntilValid({
 *   generate: async (s) => {
 *     const hint = s.__validationError ? `Previous error: ${s.__validationError}` : "";
 *     s.code = await llm(`Write a TypeScript function. ${hint}\n${s.prompt}`);
 *   },
 *   validate: (s) => {
 *     try { new Function(s.code); return true; }
 *     catch (e) { return (e as Error).message; }
 *   },
 *   maxAttempts: 3,
 * });
 */
export function generateUntilValid<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
>(options: GenerateUntilValidOptions<S, P>): FlowBuilder<S, P> {
  const { generate, validate, maxAttempts = 3 } = options;

  return new FlowBuilder<S, P>()
    .startWith((shared: S) => {
      (shared as any).__guvAttempt = 0;
      (shared as any).__guvDone = false;
      (shared as any).__validationError = undefined;
    })
    .loop(
      (shared: S) =>
        !(shared as any).__guvDone &&
        (shared as any).__guvAttempt < maxAttempts,
      (b) => {
        b.startWith(generate).then(async (shared: S, params: P) => {
          const result = await validate(shared, params);
          if (result === true) {
            (shared as any).__guvDone = true;
            (shared as any).__validationError = undefined;
          } else {
            (shared as any).__validationError = result;
          }
          (shared as any).__guvAttempt++;
        });
      },
    )
    .then((shared: S) => {
      delete (shared as any).__guvAttempt;
      delete (shared as any).__guvDone;
    });
}
