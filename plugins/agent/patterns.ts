// ---------------------------------------------------------------------------
// Multi-agent orchestration patterns
// ---------------------------------------------------------------------------
// Factory functions that return pre-configured FlowBuilder instances
// implementing common multi-agent topologies.
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import type { NodeFn } from "../../Flowneer";

// ─────────────────────────────────────────────────────────────────────────────
// Supervisor → Workers
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Sequential Crew
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a strict sequential pipeline: each step runs in order,
 * reading/writing to shared state as a baton pass.
 *
 * @example
 * const flow = sequentialCrew<MyState>([
 *   async (s) => { s.research = await research(s.query); },
 *   async (s) => { s.draft = await writeDraft(s.research); },
 *   async (s) => { s.final = await editDraft(s.draft); },
 * ]);
 */
export function sequentialCrew<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
>(steps: NodeFn<S, P>[]): FlowBuilder<S, P> {
  const flow = new FlowBuilder<S, P>();
  for (let i = 0; i < steps.length; i++) {
    if (i === 0) flow.startWith(steps[i]!);
    else flow.then(steps[i]!);
  }
  return flow;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hierarchical Manager → Sub-teams
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Round-Robin Debate / Critique
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a round-robin debate: each agent step runs in sequence,
 * repeated `rounds` times, appending perspectives to shared state.
 *
 * @example
 * const flow = roundRobinDebate<MyState>(
 *   [
 *     async (s) => { s.debate.push({ agent: "optimist", text: await optimist(s) }); },
 *     async (s) => { s.debate.push({ agent: "critic", text: await critic(s) }); },
 *     async (s) => { s.debate.push({ agent: "synthesiser", text: await synth(s) }); },
 *   ],
 *   3, // 3 rounds
 * );
 */
export function roundRobinDebate<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
>(agents: NodeFn<S, P>[], rounds: number): FlowBuilder<S, P> {
  const flow = new FlowBuilder<S, P>();
  let round = 0;

  flow
    .startWith((shared: S) => {
      round = 0;
      (shared as any).__debateRound = 0;
    })
    .loop(
      () => round < rounds,
      (b) => {
        for (let i = 0; i < agents.length; i++) {
          if (i === 0) b.startWith(agents[i]!);
          else b.then(agents[i]!);
        }
        b.then((shared: S) => {
          round++;
          (shared as any).__debateRound = round;
        });
      },
    );

  return flow;
}
