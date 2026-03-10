// ---------------------------------------------------------------------------
// iterativeRag — RAG with follow-up retrieval loop
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import type { NodeFn } from "../../Flowneer";

export interface IterativeRagOptions<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Retrieves documents; may use `(shared as any).__ragIter` to refine the query. */
  retrieve: NodeFn<S, P>;
  /**
   * Generates a (potentially partial) answer. In follow-up iterations the model
   * can indicate it needs more info — checked by `needsMoreInfo`.
   */
  generate: NodeFn<S, P>;
  /**
   * Return `true` if another retrieve → generate pass is needed.
   * When `false` (or `maxIterations` is reached) the loop exits.
   */
  needsMoreInfo: (shared: S, params: P) => boolean | Promise<boolean>;
  /** Maximum retrieve → generate iterations. Defaults to 3. */
  maxIterations?: number;
}

/**
 * Iterative RAG: retrieve → generate → if still unsatisfied, retrieve again.
 *
 * Useful when a single retrieval isn't enough — the model can request
 * follow-up searches with a refined query. On each pass
 * `(shared as any).__ragIter` (0-based) is available so `retrieve` can
 * adapt its query strategy.
 *
 * @example
 * const flow = iterativeRag({
 *   retrieve: async (s) => {
 *     const q = s.__ragIter === 0 ? s.question : s.followUpQuery;
 *     s.context = await vectorSearch(q);
 *   },
 *   generate: async (s) => {
 *     const result = await llm(buildPrompt(s));
 *     s.answer = result.answer;
 *     s.followUpQuery = result.followUpQuery;  // set when more info needed
 *   },
 *   needsMoreInfo: (s) => Boolean(s.followUpQuery),
 *   maxIterations: 3,
 * });
 */
export function iterativeRag<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
>(options: IterativeRagOptions<S, P>): FlowBuilder<S, P> {
  const { retrieve, generate, needsMoreInfo, maxIterations = 3 } = options;

  return new FlowBuilder<S, P>()
    .startWith((shared: S) => {
      (shared as any).__ragIter = 0;
      (shared as any).__ragDone = false;
    })
    .loop(
      (shared: S) =>
        !(shared as any).__ragDone && (shared as any).__ragIter < maxIterations,
      (b) => {
        b.startWith(retrieve)
          .then(generate)
          .then(async (shared: S, params: P) => {
            const more = await needsMoreInfo(shared, params);
            (shared as any).__ragDone = !more;
            (shared as any).__ragIter++;
          });
      },
    )
    .then((shared: S) => {
      delete (shared as any).__ragIter;
      delete (shared as any).__ragDone;
    });
}
