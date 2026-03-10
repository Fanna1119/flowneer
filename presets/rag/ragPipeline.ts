// ---------------------------------------------------------------------------
// RAG (Retrieval-Augmented Generation) presets
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import type { NodeFn } from "../../Flowneer";

// ─────────────────────────────────────────────────────────────────────────────
// ragPipeline — retrieve → (augment) → generate
// ─────────────────────────────────────────────────────────────────────────────

export interface RagOptions<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Retrieves relevant documents/chunks and writes them to shared state. */
  retrieve: NodeFn<S, P>;
  /**
   * Optional augmentation step — rerank, filter, or transform the retrieved
   * context before it reaches the generator.
   */
  augment?: NodeFn<S, P>;
  /** Generates the final answer using the retrieved context. */
  generate: NodeFn<S, P>;
}

/**
 * Standard RAG pipeline: retrieve → [augment] → generate.
 *
 * The most universal LLM pattern. `retrieve` writes context to shared;
 * `generate` reads it to produce the answer. Use `augment` to rerank or
 * filter before generation.
 *
 * @example
 * const flow = ragPipeline({
 *   retrieve: async (s) => { s.context = await vectorSearch(s.query); },
 *   generate: async (s) => { s.answer = await llm(buildPrompt(s)); },
 * });
 *
 * // With reranking:
 * const flow = ragPipeline({
 *   retrieve: async (s) => { s.context = await vectorSearch(s.query, { topK: 20 }); },
 *   augment: async (s) => { s.context = await rerank(s.query, s.context, { topK: 5 }); },
 *   generate: async (s) => { s.answer = await llm(buildPrompt(s)); },
 * });
 */
export function ragPipeline<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
>(options: RagOptions<S, P>): FlowBuilder<S, P> {
  const { retrieve, augment, generate } = options;
  const flow = new FlowBuilder<S, P>().startWith(retrieve);
  if (augment) flow.then(augment);
  flow.then(generate);
  return flow;
}

// ─────────────────────────────────────────────────────────────────────────────
// iterativeRag — RAG with follow-up retrieval loop
// ─────────────────────────────────────────────────────────────────────────────

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
