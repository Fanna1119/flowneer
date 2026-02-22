import type { FlowBuilder, FlowneerPlugin, StepMeta } from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Applies a per-step wall-clock timeout to every step.
     * Throws `"step N timed out after Xms"` if any step exceeds the limit.
     */
    withTimeout(ms: number): this;
  }
}

export const withTimeout: FlowneerPlugin = {
  withTimeout(this: FlowBuilder<any, any>, ms: number) {
    (this as any)._setHooks({
      wrapStep: (meta: StepMeta, next: () => Promise<void>) =>
        Promise.race([
          next(),
          new Promise<void>((_, reject) =>
            setTimeout(
              () =>
                reject(new Error(`step ${meta.index} timed out after ${ms}ms`)),
              ms,
            ),
          ),
        ]),
    });
    return this;
  },
};
