// ---------------------------------------------------------------------------
// LLM plugin — withTokenBudget(n), withCostTracker(), withRateLimit(opts)
// ---------------------------------------------------------------------------
// Usage:
//   FlowBuilder.use(llmPlugin);
//   const flow = new FlowBuilder<AgentState>()
//     .withTokenBudget(100_000)
//     .withCostTracker()
//     .withRateLimit({ intervalMs: 1_000 })
//     .startWith(callLlm)
//     .then(parseResponse);
//
// Contract:
//   - Steps increment `shared.tokensUsed` as they consume tokens.
//   - Steps set `shared.__stepCost` (number, USD) before returning;
//     withCostTracker accumulates it into `shared.__cost` and clears __stepCost.
//   - withRateLimit enforces a minimum gap between consecutive step starts.

import type { FlowBuilder, FlowneerPlugin, StepMeta } from "../Flowneer";

export interface RateLimitOptions {
  /** Minimum milliseconds between the end of one step and the start of the next. */
  intervalMs: number;
}

declare module "../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Aborts the flow before any step if `shared.tokensUsed >= limit`.
     * Steps are responsible for incrementing `shared.tokensUsed`.
     */
    withTokenBudget(limit: number): this;
    /**
     * Accumulates `shared.__stepCost` (set by each step) into `shared.__cost`.
     * Clears `__stepCost` after each step so it is never double-counted.
     */
    withCostTracker(): this;
    /**
     * Enforces a minimum delay (`intervalMs` ms) between consecutive step
     * executions to avoid hammering rate-limited APIs.
     */
    withRateLimit(opts: RateLimitOptions): this;
  }
}

export const llmPlugin: FlowneerPlugin = {
  withTokenBudget(this: FlowBuilder<any, any>, limit: number) {
    (this as any)._setHooks({
      beforeStep: (_meta: StepMeta, shared: any) => {
        const used: number = shared.tokensUsed ?? 0;
        if (used >= limit) {
          throw new Error(`token budget exceeded: ${used} >= ${limit}`);
        }
      },
    });
    return this;
  },

  withCostTracker(this: FlowBuilder<any, any>) {
    (this as any)._setHooks({
      afterStep: (_meta: StepMeta, shared: any) => {
        const stepCost: number = shared.__stepCost ?? 0;
        shared.__cost = (shared.__cost ?? 0) + stepCost;
        delete shared.__stepCost;
      },
    });
    return this;
  },

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
