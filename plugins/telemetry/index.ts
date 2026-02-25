// ---------------------------------------------------------------------------
// Telemetry plugin wrapper — turns TelemetryDaemon into a FlowneerPlugin
// ---------------------------------------------------------------------------

import type { FlowBuilder, FlowneerPlugin } from "../../Flowneer";
import { TelemetryDaemon } from "./telemetry";
import type { TelemetryOptions } from "./telemetry";

// Re-export everything from the daemon module for convenience
export { TelemetryDaemon, consoleExporter, otlpExporter } from "./telemetry";
export type { Span, TelemetryExporter, TelemetryOptions } from "./telemetry";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Attach a `TelemetryDaemon` to this flow.
     *
     * This is a convenience wrapper — instead of manually calling
     * `flow._setHooks(daemon.hooks())` you can now write:
     *
     * ```ts
     * flow.withTelemetry({ exporter: consoleExporter });
     * ```
     *
     * If no options are provided a default daemon with `consoleExporter`
     * and a 5 s flush interval is created internally.
     *
     * Pass an existing `TelemetryDaemon` instance via `options.daemon`
     * to share a single daemon across multiple flows.
     */
    withTelemetry(
      options?: TelemetryOptions & { daemon?: TelemetryDaemon },
    ): this;
  }
}

export const withTelemetry: FlowneerPlugin = {
  withTelemetry(
    this: FlowBuilder<any, any>,
    options?: TelemetryOptions & { daemon?: TelemetryDaemon },
  ) {
    const daemon = options?.daemon ?? new TelemetryDaemon(options);
    (this as any)._setHooks(daemon.hooks());
    return this;
  },
};
