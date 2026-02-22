import type { FlowBuilder, FlowneerPlugin, StepMeta } from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Accumulates `shared.__stepCost` (set by each step) into `shared.__cost`.
     * Clears `__stepCost` after each step so it is never double-counted.
     */
    withCostTracker(): this;
  }
}

export const withCostTracker: FlowneerPlugin = {
  withCostTracker(this: FlowBuilder<any, any>) {
    (this as any)._setHooks({
      afterStep: (_meta: StepMeta, shared: any) => {
        const stepCost: number = shared.__stepCost ?? 0;
        shared.__cost = (shared.__cost ?? 0) + stepCost;
        delete shared.__stepCost;
      },
    });
    return this;
  },
};
