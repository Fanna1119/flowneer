import type { FlowneerPlugin, NodeFn, NodeOptions } from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Safe parallel execution with a reducer.
     * Each fn receives its own shallow draft of `shared`.
     * After all fns complete, `reducer(shared, drafts)` merges results.
     */
    parallelAtomic(
      fns: NodeFn<S, P>[],
      reducer: (shared: S, drafts: S[]) => void,
      options?: NodeOptions,
    ): this;
  }
}

export const withAtomicUpdates: FlowneerPlugin = {
  parallelAtomic(this: any, fns: any[], reducer: any, options?: any) {
    return this.parallel(fns, options, reducer);
  },
};
