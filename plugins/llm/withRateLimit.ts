import type { FlowBuilder, FlowneerPlugin, StepFilter } from "../../Flowneer";

export interface RateLimitOptions {
  /** Minimum milliseconds between the end of one step and the start of the next. */
  intervalMs: number;
}

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Enforces a minimum delay (`intervalMs` ms) between consecutive step
     * executions to avoid hammering rate-limited APIs.
     *
     * Pass a `filter` as the second argument to restrict rate-limiting to
     * specific steps by label.
     *
     * @example
     * // Rate-limit all steps
     * new FlowBuilder()
     *   .withRateLimit({ intervalMs: 1000 })
     *   .then(callSomeApi)
     *
     * @example
     * // Rate-limit only labelled steps
     * new FlowBuilder()
     *   .withRateLimit({ intervalMs: 1000 }, ["callLlm", "callEmbeddings"])
     *   .then(doOtherWork)              // not rate-limited
     *   .then(callLlm, { label: "callLlm" })  // rate-limited
     */
    withRateLimit(opts: RateLimitOptions, filter?: StepFilter): this;
  }
}

export const withRateLimit: FlowneerPlugin = {
  withRateLimit(
    this: FlowBuilder<any, any>,
    opts: RateLimitOptions,
    filter?: StepFilter,
  ) {
    const { intervalMs } = opts;
    let lastStepEnd = 0;

    (this as any)._setHooks(
      {
        beforeStep: async () => {
          if (lastStepEnd > 0) {
            const elapsed = Date.now() - lastStepEnd;
            if (elapsed < intervalMs) {
              await new Promise<void>((r) =>
                setTimeout(r, intervalMs - elapsed),
              );
            }
          }
        },
        afterStep: () => {
          lastStepEnd = Date.now();
        },
      },
      filter,
    );
    return this;
  },
};
