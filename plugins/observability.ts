// ---------------------------------------------------------------------------
// Observability plugin — withTiming(), withHistory(), withVerbose()
// ---------------------------------------------------------------------------
// Usage:
//   FlowBuilder.use(observabilityPlugin);
//   const flow = new FlowBuilder<MyState>()
//     .withTiming()
//     .withHistory()
//     .startWith(step1)
//     .then(step2);
//
// After .run(), inspect:
//   shared.__timings  — { [stepIndex]: durationMs }
//   shared.__history  — [{ index, type, snapshot }, ...]

import type { FlowBuilder, FlowneerPlugin, StepMeta } from "../Flowneer";

declare module "../Flowneer" {
  interface FlowBuilder<S, P> {
    /** Records wall-clock duration of each step in `shared.__timings[index]` (ms). */
    withTiming(): this;
    /**
     * Appends a shallow snapshot of `shared` (excluding `__history`) after
     * each step to `shared.__history`.
     */
    withHistory(): this;
    /** Prints the full `shared` object to stdout after each step. */
    withVerbose(): this;
  }
}

export const observabilityPlugin: FlowneerPlugin = {
  withTiming(this: FlowBuilder<any, any>) {
    const starts = new Map<number, number>();
    (this as any)._setHooks({
      beforeStep: (meta: StepMeta) => {
        starts.set(meta.index, Date.now());
      },
      afterStep: (meta: StepMeta, shared: any) => {
        const start = starts.get(meta.index) ?? Date.now();
        if (!shared.__timings) shared.__timings = {};
        shared.__timings[meta.index] = Date.now() - start;
        starts.delete(meta.index);
      },
    });
    return this;
  },

  withHistory(this: FlowBuilder<any, any>) {
    (this as any)._setHooks({
      afterStep: (meta: StepMeta, shared: any) => {
        if (!Array.isArray(shared.__history)) shared.__history = [];
        // Shallow clone, excluding __history to avoid circular growth
        const { __history: _h, ...rest } = shared;
        shared.__history.push({
          index: meta.index,
          type: meta.type,
          snapshot: { ...rest },
        });
      },
    });
    return this;
  },

  withVerbose(this: FlowBuilder<any, any>) {
    (this as any)._setHooks({
      afterStep: (meta: StepMeta, shared: any) => {
        console.log(
          `[flowneer] step ${meta.index} (${meta.type}):`,
          JSON.stringify(shared, null, 2),
        );
      },
    });
    return this;
  },
};
