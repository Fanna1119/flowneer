import type {
  FlowBuilder,
  FlowneerPlugin,
  StepFilter,
  StepMeta,
} from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Appends a shallow snapshot of `shared` (excluding `__history`) after
     * each step to `shared.__history`.
     */
    withHistory(filter?: StepFilter): this;
  }
  interface AugmentedState {
    /** Shallow snapshots of shared state after each step. Written by `.withHistory()`. */
    __history?: Array<{
      index: number;
      type: string;
      snapshot: Record<string, unknown>;
    }>;
  }
}

export const withHistory: FlowneerPlugin = {
  withHistory(this: FlowBuilder<any, any>, filter?: StepFilter) {
    (this as any)._setHooks(
      {
        afterStep: (meta: StepMeta, shared: any) => {
          if (!Array.isArray(shared.__history)) shared.__history = [];
          const { __history: _h, ...rest } = shared;
          shared.__history.push({
            index: meta.index,
            type: meta.type,
            snapshot: { ...rest },
          });
        },
      },
      filter,
    );
    return this;
  },
};
