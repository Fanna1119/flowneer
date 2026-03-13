import type {
  FlowBuilder,
  FlowneerPlugin,
  StepFilter,
  StepMeta,
} from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Applies a per-step wall-clock timeout to every step.
     * Throws `"step N timed out after Xms"` if any step exceeds the limit.
     */
    withTimeout(ms: number, filter?: StepFilter): this;
  }
}

export const withTimeout: FlowneerPlugin = {
  withTimeout(this: FlowBuilder<any, any>, ms: number, filter?: StepFilter) {
    (this as any)._setHooks(
      {
        wrapStep: (meta: StepMeta, next: () => Promise<void>) => {
          let handle: ReturnType<typeof setTimeout>;
          return Promise.race([
            next().finally(() => clearTimeout(handle)),
            new Promise<void>(
              (_, reject) =>
                (handle = setTimeout(
                  () =>
                    reject(
                      new Error(`step ${meta.index} timed out after ${ms}ms`),
                    ),
                  ms,
                )),
            ),
          ]);
        },
      },
      filter,
    );
    return this;
  },
};
