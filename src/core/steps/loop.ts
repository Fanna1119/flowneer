// ---------------------------------------------------------------------------
// loop step handler
// ---------------------------------------------------------------------------
import type { StepHandler } from "../CoreFlowBuilder";
import type { LoopStep } from "../../steps";

export const loopHandler: StepHandler = async (
  step: LoopStep<any, any>,
  { shared, params, signal, meta, hooks, builder },
) => {
  let iteration = 0;
  while (await step.condition(shared, params)) {
    await builder._runSub(`loop (step ${meta.index})`, () =>
      step.body._execute(shared, params, signal),
    );
    for (const h of hooks.onLoopIteration)
      await h(meta, iteration++, shared, params);
  }
  return undefined;
};
