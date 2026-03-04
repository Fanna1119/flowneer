import type { FlowneerPlugin } from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * @deprecated Use `.anchor("name", maxVisits)` instead.
     *
     * `.anchor("refine", 5)` is the built-in equivalent and requires no plugin.
     *
     * `withCycles` will be removed in a future major version.
     */
    withCycles(maxJumps: number, anchor?: string): this;
  }
}

export const withCycles: FlowneerPlugin = {
  withCycles(this: any, maxJumps: number, anchor?: string) {
    // Each call to withCycles registers a single, independent limit.
    // Multiple calls stack naturally via the hook system.
    let count = 0;
    let prevIndex = -1;

    this._setHooks({
      beforeFlow: () => {
        count = 0;
        prevIndex = -1;
      },
      beforeStep: (meta: any) => {
        // A backward (or repeated) index means a goto just fired.
        if (prevIndex !== -1 && meta.index <= prevIndex) {
          // Resolve which anchor was jumped to by scanning back from
          // meta.index - 1 through any consecutive anchor steps.
          let jumpedAnchor: string | undefined;
          for (let k = meta.index - 1; k >= 0; k--) {
            const s = this.steps[k];
            if (s?.type === "anchor") {
              jumpedAnchor = s.name;
            } else {
              break;
            }
          }

          count++;

          if (anchor === undefined) {
            // Global jump counter
            if (count > maxJumps)
              throw new Error(
                `cycle limit exceeded: ${count} anchor jumps > maxJumps(${maxJumps})`,
              );
          } else {
            // Per-anchor counter
            if (jumpedAnchor === anchor && count > maxJumps)
              throw new Error(
                `cycle limit exceeded for anchor "${anchor}": ${count} visits > limit(${maxJumps})`,
              );
          }
        }
        prevIndex = meta.index;
      },
    });
    return this;
  },
};
