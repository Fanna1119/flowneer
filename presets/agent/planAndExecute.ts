// ---------------------------------------------------------------------------
// planAndExecute — planner LLM + executor LLM pattern
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import type { NodeFn } from "../../Flowneer";

export interface PlanAndExecuteOptions<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * Planner step — generates the task list and writes it to shared state.
   * After this runs, `getPlan(shared)` must return a non-empty array.
   */
  plan: NodeFn<S, P>;
  /**
   * Executor step — processes a single plan item.
   * - `(shared as any).__planStep`  — the current item
   * - `(shared as any).__planIndex` — its zero-based index
   */
  execute: NodeFn<S, P>;
  /** Extracts the ordered plan array from shared state. */
  getPlan: (shared: S) => unknown[];
}

/**
 * Plan-and-execute agent: a planner LLM creates a task list, then an
 * executor LLM (or tool) processes each step sequentially.
 *
 * Handles long-horizon tasks better than a single ReAct loop by separating
 * high-level planning from low-level execution.
 *
 * @example
 * const flow = planAndExecute({
 *   plan: async (s) => { s.plan = await plannerLlm(s.goal); },
 *   execute: async (s) => {
 *     s.results ??= [];
 *     s.results.push(await executorLlm(s.__planStep as string));
 *   },
 *   getPlan: (s) => s.plan,
 * });
 */
export function planAndExecute<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
>(options: PlanAndExecuteOptions<S, P>): FlowBuilder<S, P> {
  const { plan, execute, getPlan } = options;

  return new FlowBuilder<S, P>()
    .startWith(async (shared: S, params: P) => {
      (shared as any).__planIndex = 0;
      await plan(shared, params);
    })
    .loop(
      (shared: S) => (shared as any).__planIndex < getPlan(shared).length,
      (b) => {
        b.startWith((shared: S) => {
          (shared as any).__planStep =
            getPlan(shared)[(shared as any).__planIndex];
        })
          .then(execute)
          .then((shared: S) => {
            (shared as any).__planIndex++;
          });
      },
    )
    .then((shared: S) => {
      delete (shared as any).__planIndex;
      delete (shared as any).__planStep;
    });
}
