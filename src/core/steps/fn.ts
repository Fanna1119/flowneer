// ---------------------------------------------------------------------------
// fn step handler
// ---------------------------------------------------------------------------
import { resolveNumber, retry, runFnResult } from "../utils";
import type { StepHandler } from "../CoreFlowBuilder";
import type { FnStep } from "../../steps";

export const fnHandler: StepHandler = async (
  step: FnStep<any, any>,
  { shared, params },
) => {
  const result = await retry(
    resolveNumber(step.retries, 1, shared, params),
    resolveNumber(step.delaySec, 0, shared, params),
    () => step.fn(shared, params),
  );
  return runFnResult(result, shared);
};
