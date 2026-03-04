// ---------------------------------------------------------------------------
// batch step handler
// ---------------------------------------------------------------------------
import type { StepHandler } from "../CoreFlowBuilder";
import type { BatchStep } from "../../steps";

export const batchHandler: StepHandler = async (
  step: BatchStep<any, any>,
  { shared, params, signal, meta, builder },
) => {
  const { key, itemsExtractor, processor } = step;
  const prev = (shared as any)[key];
  const hadKey = Object.prototype.hasOwnProperty.call(shared, key);
  const list = await itemsExtractor(shared, params);
  for (const item of list) {
    (shared as any)[key] = item;
    await builder._runSub(`batch (step ${meta.index})`, () =>
      processor._execute(shared, params, signal),
    );
  }
  if (!hadKey) delete (shared as any)[key];
  else (shared as any)[key] = prev;
  return undefined;
};
