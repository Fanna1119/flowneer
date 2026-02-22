import type { FlowBuilder, FlowneerPlugin, StepMeta } from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Appends a shallow snapshot of `shared` (excluding `__history`) after
     * each step to `shared.__history`.
     */
    withHistory(): this;
  }
}

export const withHistory: FlowneerPlugin = {
  withHistory(this: FlowBuilder<any, any>) {
    (this as any)._setHooks({
      afterStep: (meta: StepMeta, shared: any) => {
        if (!Array.isArray(shared.__history)) shared.__history = [];
        const { __history: _h, ...rest } = shared;
        shared.__history.push({
          index: meta.index,
          type: meta.type,
          snapshot: { ...rest },
        });
      },
    });
    return this;
  },
};
