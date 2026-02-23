import { InterruptError } from "../../Flowneer";
import type { FlowneerPlugin, NodeFn } from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Insert an interrupt point.
     * If `condition(shared, params)` returns true, the flow throws
     * an `InterruptError` carrying a deep clone of `shared`.
     *
     * Catch `InterruptError` in your runner to implement human-in-the-loop,
     * approval gates, or external-resume patterns.
     */
    interruptIf(
      condition: (shared: S, params: P) => boolean | Promise<boolean>,
    ): this;
  }
}

export const withInterrupts: FlowneerPlugin = {
  interruptIf(this: any, condition: any) {
    const interruptFn: NodeFn = async (shared, params) => {
      const shouldInterrupt = await condition(shared, params);
      if (shouldInterrupt) {
        throw new InterruptError(JSON.parse(JSON.stringify(shared)));
      }
    };
    return this.then(interruptFn);
  },
};
