import type { FlowneerPlugin, PluginContext, StepMeta } from "../../Flowneer";

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
  withDryRun(this: PluginContext) {
    this._setHooks({
      wrapStep: async (_meta: StepMeta, _next: () => Promise<void>) => {
        /* no-op — step body is intentionally skipped */
      },
    });
    return this;
  },
};
