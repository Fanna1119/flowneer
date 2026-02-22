// ---------------------------------------------------------------------------
// Dev/Testing plugin — withDryRun(), withMocks(map)
// ---------------------------------------------------------------------------
// Usage:
//   FlowBuilder.use(devPlugin);
//
//   // Validate a chain without side-effects
//   await new FlowBuilder<MyState>()
//     .withDryRun()
//     .startWith(expensiveStep)
//     .then(anotherStep)
//     .run(shared);   // steps are skipped; hooks still fire
//
//   // Unit-test specific steps
//   await new FlowBuilder<MyState>()
//     .withMocks({ 1: async (s) => { s.data = "mocked"; } })
//     .startWith(realStep)
//     .then(stepUnderTest)   // index 1 — replaced by mock
//     .then(realStep)
//     .run(shared);

import type {
  FlowBuilder,
  FlowneerPlugin,
  NodeFn,
  StepMeta,
} from "../Flowneer";

declare module "../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Skips all step bodies \u2014 `beforeStep` / `afterStep` hooks still fire so you
     * can validate observability wiring without executing real logic.
     */
    withDryRun(): this;
    /**
     * Replaces step bodies at the given indices with mock functions.
     * Steps whose indices are not in `map` run normally.
     */
    withMocks(map: Record<number, NodeFn<S, P>>): this;
  }
}

export const devPlugin: FlowneerPlugin = {
  withDryRun(this: FlowBuilder<any, any>) {
    (this as any)._setHooks({
      // wrapStep receives `next` but deliberately does not call it
      wrapStep: async (_meta: StepMeta, _next: () => Promise<void>) => {
        /* no-op — step body is intentionally skipped */
      },
    });
    return this;
  },

  withMocks(this: FlowBuilder<any, any>, map: Record<number, NodeFn>) {
    (this as any)._setHooks({
      wrapStep: async (
        meta: StepMeta,
        next: () => Promise<void>,
        shared: any,
        params: any,
      ) => {
        const mock = map[meta.index];
        if (mock !== undefined) {
          await mock(shared, params);
        } else {
          await next();
        }
      },
    });
    return this;
  },
};
