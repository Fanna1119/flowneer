// ---------------------------------------------------------------------------
// critiqueAndRevise — two-agent generate → critique → revise loop
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import type { NodeFn } from "../../Flowneer";

/**
 * Two-agent critique-and-revise loop: generate once, then run
 * critique → revise for `rounds` iterations.
 *
 * Simpler than a full debate — ideal for a dedicated editor or reviewer agent.
 * The `critique` step can write its notes anywhere on shared state; the
 * `revise` step reads them in the same turn.
 *
 * @example
 * const flow = critiqueAndRevise(
 *   async (s) => { s.draft = await writerLlm(s.prompt); },
 *   async (s) => { s.critique = await criticLlm(s.draft); },
 *   async (s) => { s.draft = await reviserLlm(s.draft, s.critique); },
 *   2,
 * );
 */
export function critiqueAndRevise<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
>(
  generate: NodeFn<S, P>,
  critique: NodeFn<S, P>,
  revise: NodeFn<S, P>,
  rounds: number = 1,
): FlowBuilder<S, P> {
  return new FlowBuilder<S, P>()
    .startWith(generate)
    .loop(
      (shared: S) => ((shared as any).__critiqueRound ?? 0) < rounds,
      (b) => {
        b.startWith(critique)
          .then(revise)
          .then((shared: S) => {
            (shared as any).__critiqueRound =
              ((shared as any).__critiqueRound ?? 0) + 1;
          });
      },
    )
    .then((shared: S) => {
      delete (shared as any).__critiqueRound;
    });
}
