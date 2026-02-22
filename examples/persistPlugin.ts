// ---------------------------------------------------------------------------
// Persist plugin — adds `.withCheckpoint(store)` to FlowBuilder
// ---------------------------------------------------------------------------
// Usage:
//   FlowBuilder.use(persistPlugin);
//   const flow = new FlowBuilder<MyState>()
//     .withCheckpoint({ save: async (i, s) => db.set(id, { i, s }) })
//     .startWith(step1)
//     .then(step2);

import type { FlowBuilder, FlowneerPlugin, StepMeta } from "../Flowneer";

export interface CheckpointStore<S = any> {
  /** Called after each successful step with the step index and current shared state. */
  save: (stepIndex: number, shared: S) => void | Promise<void>;
}

// Augment FlowBuilder's type so `.withCheckpoint()` is known to TypeScript
declare module "../Flowneer" {
  interface FlowBuilder<S, P> {
    withCheckpoint(store: CheckpointStore<S>): this;
  }
}

export const persistPlugin: FlowneerPlugin = {
  withCheckpoint(this: FlowBuilder<any, any>, store: CheckpointStore) {
    (this as any)._setHooks({
      afterStep: async (meta: StepMeta, shared: unknown) => {
        await store.save(meta.index, shared);
      },
    });
    return this;
  },
};
