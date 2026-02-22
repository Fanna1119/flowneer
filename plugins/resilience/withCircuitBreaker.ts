import type { FlowBuilder, FlowneerPlugin } from "../../Flowneer";

export interface CircuitBreakerOptions {
  /** Number of consecutive failures that open the circuit. Default: 3 */
  maxFailures?: number;
  /**
   * Milliseconds after which the circuit resets and allows one probe attempt.
   * Default: 30 000
   */
  resetMs?: number;
}

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Trips an open-circuit after `maxFailures` consecutive failures.
     * While open, every step throws immediately without executing.
     * Resets after `resetMs` milliseconds.
     */
    withCircuitBreaker(opts?: CircuitBreakerOptions): this;
  }
}

export const withCircuitBreaker: FlowneerPlugin = {
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
};
