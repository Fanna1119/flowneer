// ---------------------------------------------------------------------------
// branch step handler
// ---------------------------------------------------------------------------
import { resolveNumber, retry, isAnchorTarget } from "../utils";
import type { StepHandler } from "../CoreFlowBuilder";
import type { BranchStep } from "../../steps";

export const branchHandler: StepHandler = async (
  step: BranchStep<any, any>,
  { shared, params },
) => {
  const r = resolveNumber(step.retries, 1, shared, params);
  const d = resolveNumber(step.delaySec, 0, shared, params);
  const action = await retry(r, d, () => step.router(shared, params));
  const key = action ? String(action) : "default";
  const fn = step.branches[key] ?? step.branches["default"];
  if (fn) {
    const result = await retry(r, d, () => fn(shared, params));
    if (isAnchorTarget(result)) return result.slice(1);
  }
  return undefined;
};
