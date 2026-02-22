import type { FlowBuilder, FlowneerPlugin } from "../../Flowneer";

export interface RateLimitOptions {
  /** Minimum milliseconds between the end of one step and the start of the next. */
  intervalMs: number;
}

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Enforces a minimum delay (`intervalMs` ms) between consecutive step
     * executions to avoid hammering rate-limited APIs.
     */
    withRateLimit(opts: RateLimitOptions): this;
  }
}

export const withRateLimit: FlowneerPlugin = {
  withRateLimit(this: FlowBuilder<any, any>, opts: RateLimitOptions) {
    const { intervalMs } = opts;
    let lastStepEnd = 0;

    (this as any)._setHooks({
      beforeStep: async () => {
        if (lastStepEnd > 0) {
          const elapsed = Date.now() - lastStepEnd;
          if (elapsed < intervalMs) {
            await new Promise<void>((r) => setTimeout(r, intervalMs - elapsed));
          }
        }
      },
      afterStep: () => {
        lastStepEnd = Date.now();
      },
    });
    return this;
  },
};
