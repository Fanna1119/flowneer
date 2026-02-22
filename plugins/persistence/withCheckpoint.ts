import type { FlowBuilder, FlowneerPlugin, StepMeta } from "../../Flowneer";

export interface CheckpointStore<S = any> {
  /** Called after each successful step with the step index and current shared state. */
  save: (stepIndex: number, shared: S) => void | Promise<void>;
}

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /** Saves `shared` to `store` after each successful step. */
    withCheckpoint(store: CheckpointStore<S>): this;
  }
}

export const withCheckpoint: FlowneerPlugin = {
  withCheckpoint(this: FlowBuilder<any, any>, store: CheckpointStore) {
    (this as any)._setHooks({
      afterStep: async (meta: StepMeta, shared: unknown) => {
        await store.save(meta.index, shared);
      },
    });
    return this;
  },
};
