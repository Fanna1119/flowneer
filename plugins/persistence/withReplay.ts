import type { FlowBuilder, FlowneerPlugin, StepMeta } from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Skips execution of all steps before `fromStep`.
     * Combine with `.withCheckpoint()`: restore `shared` from the checkpoint
     * store before calling `.run()`, then call `.withReplay(lastSavedIndex + 1)`
     * so only future steps execute.
     */
    withReplay(fromStep: number): this;
  }
}

export const withReplay: FlowneerPlugin = {
  withReplay(this: FlowBuilder<any, any>, fromStep: number) {
    (this as any)._setHooks({
      wrapStep: async (meta: StepMeta, next: () => Promise<void>) => {
        if (meta.index < fromStep) return;
        await next();
      },
    });
    return this;
  },
};
