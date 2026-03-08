// ---------------------------------------------------------------------------
// selfConsistency — parallel sampling + majority-vote aggregation
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import type { NodeFn } from "../../Flowneer";

/**
 * Self-consistency sampling: run `generate` `n` times in parallel isolation,
 * then aggregate all outputs (e.g. majority vote) into shared state.
 *
 * Each parallel invocation receives its own shallow clone; `aggregate`
 * merges or selects the best result back onto the original `shared`.
 *
 * Simple accuracy boost for reasoning tasks — no extra prompting needed.
 *
 * @example
 * const flow = selfConsistency(
 *   async (s) => { s.answer = await llm(s.question); },
 *   5,
 *   (drafts, shared) => {
 *     const counts = new Map<string, number>();
 *     for (const d of drafts) counts.set(d.answer, (counts.get(d.answer) ?? 0) + 1);
 *     shared.answer = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
 *   },
 * );
 */
export function selfConsistency<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
>(
  generate: NodeFn<S, P>,
  n: number,
  aggregate: (drafts: S[], shared: S) => void,
): FlowBuilder<S, P> {
  const fns = Array.from({ length: n }, () => generate);
  return new FlowBuilder<S, P>().parallel(fns, undefined, (shared, drafts) => {
    aggregate(drafts, shared);
  });
}
