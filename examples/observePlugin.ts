// ---------------------------------------------------------------------------
// Observe plugin — adds `.withTracing(fn)` to FlowBuilder
// ---------------------------------------------------------------------------
// Usage:
//   FlowBuilder.use(observePlugin);
//   const flow = new FlowBuilder<MyState>()
//     .withTracing((meta, event) => console.log(event, meta))
//     .startWith(step1)
//     .then(step2);

import type { FlowBuilder, FlowneerPlugin, StepMeta } from "../Flowneer";

type TraceEvent = "before" | "after" | "error";
type TraceFn = (meta: StepMeta, event: TraceEvent, error?: unknown) => void;

// Augment FlowBuilder's type so `.withTracing()` is known to TypeScript
declare module "../Flowneer" {
  interface FlowBuilder<S, P> {
    withTracing(fn: TraceFn): this;
  }
}

export const observePlugin: FlowneerPlugin = {
  withTracing(this: FlowBuilder<any, any>, fn: TraceFn) {
    (this as any)._setHooks({
      beforeStep: (meta: StepMeta) => fn(meta, "before"),
      afterStep: (meta: StepMeta) => fn(meta, "after"),
      onError: (meta: StepMeta, err: unknown) => fn(meta, "error", err),
    });
    return this;
  },
};
