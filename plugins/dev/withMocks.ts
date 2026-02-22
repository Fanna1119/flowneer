import type {
  FlowBuilder,
  FlowneerPlugin,
  NodeFn,
  StepMeta,
} from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Replaces step bodies at the given indices with mock functions.
     * Steps whose indices are not in `map` run normally.
     */
    withMocks(map: Record<number, NodeFn<S, P>>): this;
  }
}

export const withMocks: FlowneerPlugin = {
  withMocks(this: FlowBuilder<any, any>, map: Record<number, NodeFn>) {
    (this as any)._setHooks({
      wrapStep: async (
        meta: StepMeta,
        next: () => Promise<void>,
        shared: any,
        params: any,
      ) => {
        const mock = map[meta.index];
        if (mock !== undefined) {
          await mock(shared, params);
        } else {
          await next();
        }
      },
    });
    return this;
  },
};
