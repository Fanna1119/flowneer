import type {
  FlowneerPlugin,
  PluginContext,
  StepFilter,
  StepMeta,
} from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Accumulates `shared.__stepCost` (set by each step) into `shared.__cost`.
     * Clears `__stepCost` after each step so it is never double-counted.
     */
    withCostTracker(filter?: StepFilter): this;
  }
  interface AugmentedState {
    /** Accumulated total cost across all steps. Written by `.withCostTracker()`. */
    __cost?: number;
    /**
     * Cost of the current step — set by your step function, read and cleared
     * by `.withCostTracker()` after each step.
     * @example s.__stepCost = calcCost(inputTokens, outputTokens);
     */
    __stepCost?: number;
  }
}

export const withCostTracker: FlowneerPlugin = {
  withCostTracker(this: PluginContext, filter?: StepFilter) {
    this._setHooks(
      {
        afterStep: (_meta: StepMeta, shared: any) => {
          const stepCost: number = shared.__stepCost ?? 0;
          shared.__cost = (shared.__cost ?? 0) + stepCost;
          delete shared.__stepCost;
        },
      },
      filter,
    );
    return this;
  },
};
