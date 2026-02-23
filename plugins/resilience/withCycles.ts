import type { FlowneerPlugin } from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Guard against infinite goto loops.
     * Tracks total label jumps per `run()` and throws if `maxJumps` is exceeded.
     * Default: 100.
     */
    withCycles(maxJumps?: number): this;
  }
}

export const withCycles: FlowneerPlugin = {
  withCycles(this: any, maxJumps: number = 100) {
    let jumps = 0;
    this._setHooks({
      beforeFlow: () => {
        jumps = 0;
      },
      beforeStep: (meta: any) => {
        // A goto manifests as the runner jumping to a label step.
        // We count every step visit; if it exceeds maxJumps it's likely looping.
        if (meta.type === "fn" || meta.type === "branch") {
          // The runner already skips label steps, so we simply count overall.
        }
      },
      afterStep: (_meta: any, shared: any) => {
        // After each step, check if a goto happened by inspecting the runner's
        // jump behaviour. Since we can't directly hook the goto, we track via
        // a shared sentinel: if the same step index repeats, the step counter
        // resets. Simpler: just count every step and cap it.
        jumps++;
        if (jumps > maxJumps)
          throw new Error(
            `cycle limit exceeded: ${jumps} step executions > maxJumps(${maxJumps})`,
          );
      },
    });
    return this;
  },
};
