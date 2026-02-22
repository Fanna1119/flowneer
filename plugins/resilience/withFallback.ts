import type {
  FlowBuilder,
  FlowneerPlugin,
  NodeFn,
  StepMeta,
} from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Catches any step error and calls `fn` instead of propagating.
     * The flow continues normally after the fallback runs.
     */
    withFallback(fn: NodeFn<S, P>): this;
  }
}

export const withFallback: FlowneerPlugin = {
  withFallback(this: FlowBuilder<any, any>, fn: NodeFn) {
    (this as any)._setHooks({
      wrapStep: async (
        _meta: StepMeta,
        next: () => Promise<void>,
        shared: any,
        params: any,
      ) => {
        try {
          await next();
        } catch {
          await fn(shared, params);
        }
      },
    });
    return this;
  },
};
