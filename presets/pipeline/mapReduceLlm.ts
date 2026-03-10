// ---------------------------------------------------------------------------
// mapReduceLlm — batch LLM calls across N items, then reduce
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import type { NodeFn } from "../../Flowneer";

export interface MapReduceOptions<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * Returns the array of items to process. Each item is placed on
   * `shared[itemKey]` before `map` is called.
   */
  items: (shared: S, params: P) => any[] | Promise<any[]>;
  /**
   * Per-item step — reads `shared[itemKey]` and writes its result to
   * shared (e.g. pushes to `shared.results`).
   */
  map: NodeFn<S, P>;
  /**
   * Aggregation step — runs once after all items are processed, merging
   * per-item results into the final output.
   */
  reduce: NodeFn<S, P>;
  /**
   * Key under which the current batch item is exposed on shared.
   * Defaults to `"__mapItem"`.
   */
  itemKey?: string;
}

/**
 * Map-reduce over LLM calls: run `map` once per item from `items`,
 * then run `reduce` once to aggregate all results.
 *
 * Core pattern for batch document processing, multi-source summarization,
 * and any workload that fans out across a list then fans back in.
 *
 * @example
 * const flow = mapReduceLlm({
 *   items: (s) => s.documents,
 *   map: async (s) => {
 *     s.summaries ??= [];
 *     s.summaries.push(await llm(`Summarise: ${s.__mapItem}`));
 *   },
 *   reduce: async (s) => {
 *     s.finalSummary = await llm(`Combine these summaries:\n${s.summaries.join("\n")}`);
 *   },
 * });
 */
export function mapReduceLlm<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
>(options: MapReduceOptions<S, P>): FlowBuilder<S, P> {
  const { items, map, reduce, itemKey = "__mapItem" } = options;

  return new FlowBuilder<S, P>()
    .batch(items, (b) => b.startWith(map), { key: itemKey })
    .then(reduce);
}
