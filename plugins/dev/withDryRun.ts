import type { FlowBuilder, FlowneerPlugin, StepMeta } from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Skips all step bodies — `beforeStep` / `afterStep` hooks still fire so
     * you can validate observability wiring without executing real logic.
     */
    withDryRun(): this;
  }
}

export const withDryRun: FlowneerPlugin = {
  withDryRun(this: FlowBuilder<any, any>) {
    (this as any)._setHooks({
      wrapStep: async (_meta: StepMeta, _next: () => Promise<void>) => {
        /* no-op — step body is intentionally skipped */
      },
    });
    return this;
  },
};
