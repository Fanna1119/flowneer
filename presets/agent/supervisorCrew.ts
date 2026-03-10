// ---------------------------------------------------------------------------
// supervisorCrew — supervisor → workers pattern
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import type { NodeFn } from "../../Flowneer";

/**
 * Creates a supervisor → workers pattern.
 *
 * 1. `supervisor` runs first to set up context / assign tasks.
 * 2. All `workers` run in parallel (with an optional reducer).
 * 3. `supervisor` runs again (post step) to aggregate results.
 *
 * @example
 * const flow = supervisorCrew<MyState>(
 *   async (s) => { s.tasks = splitIntoChunks(s.input); },
 *   [
 *     async (s) => { s.results ??= []; s.results.push(await doWork(s)); },
 *     async (s) => { s.results ??= []; s.results.push(await doWork(s)); },
 *   ],
 *   { post: async (s) => { s.summary = combine(s.results); } },
 * );
 */
export function supervisorCrew<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
>(
  supervisor: NodeFn<S, P>,
  workers: NodeFn<S, P>[],
  options?: {
    /** Optional post-parallel supervisor step for aggregation. */
    post?: NodeFn<S, P>;
    /** Optional reducer for parallel isolation. */
    reducer?: (shared: S, drafts: S[]) => void;
  },
): FlowBuilder<S, P> {
  const flow = new FlowBuilder<S, P>().startWith(supervisor);
  flow.parallel(workers, undefined, options?.reducer);
  if (options?.post) flow.then(options.post);
  return flow;
}
