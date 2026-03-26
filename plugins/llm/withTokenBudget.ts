import type {
  FlowneerPlugin,
  PluginContext,
  StepFilter,
  StepMeta,
} from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Aborts the flow before any step if `shared.tokensUsed >= limit`.
     * Steps are responsible for incrementing `shared.tokensUsed`.
     */
    withTokenBudget(limit: number, filter?: StepFilter): this;
  }
}

export const withTokenBudget: FlowneerPlugin = {
  withTokenBudget(this: PluginContext, limit: number, filter?: StepFilter) {
    this._setHooks(
      {
        beforeStep: (_meta: StepMeta, shared: any) => {
          const used: number = shared.tokensUsed ?? 0;
          if (used >= limit) {
            throw new Error(`token budget exceeded: ${used} >= ${limit}`);
          }
        },
      },
      filter,
    );
    return this;
  },
};
