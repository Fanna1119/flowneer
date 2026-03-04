// ---------------------------------------------------------------------------
// parallel step handler
// ---------------------------------------------------------------------------
import { resolveNumber, retry } from "../utils";
import type { StepHandler } from "../CoreFlowBuilder";
import type { ParallelStep } from "../../steps";
import type { NodeFn } from "../../types";

export const parallelHandler: StepHandler = async (
  step: ParallelStep<any, any>,
  { shared, params, signal, meta, hooks },
) => {
  const r = resolveNumber(step.retries, 1, shared, params);
  const d = resolveNumber(step.delaySec, 0, shared, params);
  const wrappers = hooks.wrapParallelFn;

  const runFn = (fn: NodeFn<any, any>, s: any, fi: number): Promise<void> => {
    const exec = async () => {
      signal?.throwIfAborted();
      await retry(r, d, () => fn(s, params));
    };
    return wrappers.reduceRight<() => Promise<void>>(
      (next, wrap) => () => wrap(meta, fi, next, s, params),
      exec,
    )();
  };

  if (step.reducer) {
    const drafts = step.fns.map(() => ({ ...shared }));
    await Promise.all(step.fns.map((fn, fi) => runFn(fn, drafts[fi]!, fi)));
    step.reducer(shared, drafts);
  } else {
    await Promise.all(step.fns.map((fn, fi) => runFn(fn, shared, fi)));
  }

  return undefined;
};
