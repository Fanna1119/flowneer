import type {
  FlowneerPlugin,
  NodeFn,
  PluginContext,
  StepFilter,
  StepMeta,
} from "../../Flowneer";
import { InterruptError } from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Catches any step error and calls `fn` instead of propagating.
     * The flow continues normally after the fallback runs.
     */
    withFallback(fn: NodeFn<S, P>, filter?: StepFilter): this;
  }
  interface AugmentedState {
    /** Details of the error that triggered the fallback. Written by `.withFallback()`. */
    __fallbackError?: {
      stepIndex: number;
      stepType: string;
      message: string;
      stack?: string;
    };
  }
}

export const withFallback: FlowneerPlugin = {
  withFallback(this: PluginContext, fn: NodeFn, filter?: StepFilter) {
    this._setHooks(
      {
        wrapStep: async (
          meta: StepMeta,
          next: () => Promise<void>,
          shared: any,
          params: any,
        ) => {
          try {
            await next();
          } catch (e) {
            // InterruptError must propagate — it signals flow cancellation
            if (e instanceof InterruptError) throw e;
            shared.__fallbackError = {
              stepIndex: meta.index,
              stepType: meta.type,
              message: e instanceof Error ? e.message : String(e),
              stack: e instanceof Error ? e.stack : undefined,
            };
            await fn(shared, params);
          }
        },
      },
      filter,
    );
    return this;
  },
};
