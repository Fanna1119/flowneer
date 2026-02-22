// ---------------------------------------------------------------------------
// Resilience plugin — withFallback(fn), withCircuitBreaker(opts), withTimeout(ms)
// ---------------------------------------------------------------------------
// Usage:
//   FlowBuilder.use(resiliencePlugin);
//   const flow = new FlowBuilder<MyState>()
//     .withTimeout(5_000)
//     .withCircuitBreaker({ maxFailures: 3, resetMs: 60_000 })
//     .withFallback(async (s) => { s.result = "default"; })
//     .startWith(step1)
//     .then(step2);

import type {
  FlowBuilder,
  FlowneerPlugin,
  NodeFn,
  StepMeta,
} from "../Flowneer";

export interface CircuitBreakerOptions {
  /** Number of consecutive failures that open the circuit. Default: 3 */
  maxFailures?: number;
  /**
   * Milliseconds after which the circuit resets and allows one probe attempt.
   * Default: 30 000
   */
  resetMs?: number;
}

declare module "../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Catches any step error and calls `fn` instead of propagating.
     * The flow continues normally after the fallback runs.
     */
    withFallback(fn: NodeFn<S, P>): this;
    /**
     * Trips an open-circuit after `maxFailures` consecutive failures.
     * While open, every step throws immediately without executing.
     * Resets after `resetMs` milliseconds.
     */
    withCircuitBreaker(opts?: CircuitBreakerOptions): this;
    /**
     * Applies a per-step wall-clock timeout to every step.
     * Throws `"step N timed out after Xms"` if any step exceeds the limit.
     * (Complements per-step `timeoutMs` in NodeOptions.)
     */
    withTimeout(ms: number): this;
  }
}

export const resiliencePlugin: FlowneerPlugin = {
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

  withCircuitBreaker(
    this: FlowBuilder<any, any>,
    opts: CircuitBreakerOptions = {},
  ) {
    const { maxFailures = 3, resetMs = 30_000 } = opts;
    let consecutiveFailures = 0;
    let openedAt: number | null = null;

    (this as any)._setHooks({
      beforeStep: () => {
        if (openedAt !== null) {
          if (Date.now() - openedAt >= resetMs) {
            // Half-open: allow one probe attempt
            consecutiveFailures = 0;
            openedAt = null;
          } else {
            throw new Error(
              `circuit open after ${consecutiveFailures} consecutive failures`,
            );
          }
        }
      },
      afterStep: () => {
        consecutiveFailures = 0;
      },
      onError: () => {
        consecutiveFailures += 1;
        if (consecutiveFailures >= maxFailures) {
          openedAt = Date.now();
        }
      },
    });
    return this;
  },

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
