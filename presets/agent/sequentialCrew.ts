// ---------------------------------------------------------------------------
// sequentialCrew — strict sequential pipeline pattern
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import type { NodeFn } from "../../Flowneer";

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
