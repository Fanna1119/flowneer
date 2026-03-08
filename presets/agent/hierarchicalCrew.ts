// ---------------------------------------------------------------------------
// hierarchicalCrew — manager → sub-teams pattern
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import type { NodeFn } from "../../Flowneer";

/**
 * Creates a hierarchical pattern: a top-level manager delegates to
 * sub-team flows (each is its own `FlowBuilder` or supervisor crew).
 *
 * The manager runs first, then each team runs sequentially (for safety;
 * use `parallel` within each team if needed), and a final aggregation
 * step runs at the end.
 *
 * @example
 * const flow = hierarchicalCrew<MyState>(
 *   async (s) => { s.plan = planTasks(s.input); },
 *   [researchTeamFlow, writingTeamFlow],
 *   async (s) => { s.output = mergeTeamResults(s); },
 * );
 */
export function hierarchicalCrew<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
>(
  manager: NodeFn<S, P>,
  teams: FlowBuilder<S, P>[],
  aggregate?: NodeFn<S, P>,
): FlowBuilder<S, P> {
  const flow = new FlowBuilder<S, P>().startWith(manager);
  for (const team of teams) {
    flow.then(async (shared, params) => {
      await team.run(shared, params);
    });
  }
  if (aggregate) flow.then(aggregate);
  return flow;
}
