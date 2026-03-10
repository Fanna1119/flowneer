// ---------------------------------------------------------------------------
// reflexionAgent — generate → critique → revise loop (Reflexion paper)
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import type { NodeFn } from "../../Flowneer";

export interface ReflexionOptions<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * Generate (or re-generate) the output. On retries,
   * `(shared as any).__reflexionFeedback` contains the previous critique.
   */
  generate: NodeFn<S, P>;
  /**
   * Critique the current output. Return `null` to accept it, or a
   * feedback string to request a revision.
   */
  critique: (shared: S, params: P) => string | null | Promise<string | null>;
  /** Maximum generate → critique iterations. Defaults to 3. */
  maxIterations?: number;
}

/**
 * Reflexion agent: generate → critique → revise, repeating until the
 * critique is satisfied or `maxIterations` is reached.
 *
 * Based on the Reflexion paper (Shinn et al., 2023).
 *
 * On subsequent iterations `(shared as any).__reflexionFeedback` holds
 * the critique from the previous round so `generate` can incorporate it.
 *
 * @example
 * const flow = reflexionAgent({
 *   generate: async (s) => { s.draft = await llm(buildPrompt(s)); },
 *   critique: async (s) => {
 *     const verdict = await llm(critiquePrompt(s.draft));
 *     return verdict === "LGTM" ? null : verdict;
 *   },
 *   maxIterations: 3,
 * });
 */
export function reflexionAgent<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
>(options: ReflexionOptions<S, P>): FlowBuilder<S, P> {
  const { generate, critique, maxIterations = 3 } = options;

  return new FlowBuilder<S, P>()
    .startWith((shared: S) => {
      (shared as any).__reflexionIter = 0;
      (shared as any).__reflexionDone = false;
      (shared as any).__reflexionFeedback = null;
    })
    .loop(
      (shared: S) =>
        !(shared as any).__reflexionDone &&
        (shared as any).__reflexionIter < maxIterations,
      (b) => {
        b.startWith(generate).then(async (shared: S, params: P) => {
          const feedback = await critique(shared, params);
          (shared as any).__reflexionFeedback = feedback;
          (shared as any).__reflexionDone = feedback === null;
          (shared as any).__reflexionIter++;
        });
      },
    )
    .then((shared: S) => {
      delete (shared as any).__reflexionIter;
      delete (shared as any).__reflexionDone;
    });
}
