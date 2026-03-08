// ---------------------------------------------------------------------------
// roundRobinDebate — round-robin debate / critique pattern
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import type { NodeFn } from "../../Flowneer";

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
