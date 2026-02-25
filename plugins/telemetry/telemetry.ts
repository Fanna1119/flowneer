// ---------------------------------------------------------------------------
// Flowneer — TelemetryDaemon plugin
// ---------------------------------------------------------------------------
// A lightweight background daemon that collects per-step spans and exports
// them in batches. Completely external to core — zero core changes needed.
//
// Usage:
//   import { TelemetryDaemon, consoleExporter } from "./plugins/telemetry";
//   const telemetry = new TelemetryDaemon({ exporter: consoleExporter });
//   flow._setHooks(telemetry.hooks());          // attach to any flow
//   process.on("SIGTERM", () => telemetry.stop());
// ---------------------------------------------------------------------------

import type { FlowHooks, StepMeta } from "../../Flowneer";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface Span {
  traceId: string;
  spanId: string;
  parentId?: string;
  name: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  status: "ok" | "error";
  attrs: Record<string, unknown>;
}

export interface TelemetryExporter {
  export(spans: Span[]): void | Promise<void>;
}

export interface TelemetryOptions {
  /** Exporter implementation. Defaults to `consoleExporter`. */
  exporter?: TelemetryExporter;
  /** How often to flush the buffer (ms). Defaults to 5 000. */
  flushIntervalMs?: number;
  /** Force a flush after this many buffered spans. Defaults to 100. */
  maxBuffer?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ID helpers
// ─────────────────────────────────────────────────────────────────────────────

const hex = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

// ─────────────────────────────────────────────────────────────────────────────
// TelemetryDaemon
// ─────────────────────────────────────────────────────────────────────────────

export class TelemetryDaemon {
  private buffer: Span[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly exporter: TelemetryExporter;
  private readonly maxBuffer: number;

  constructor(opts: TelemetryOptions = {}) {
    this.exporter = opts.exporter ?? consoleExporter;
    this.maxBuffer = opts.maxBuffer ?? 100;

    const intervalMs = opts.flushIntervalMs ?? 5_000;
    this.timer = setInterval(() => this.flush(), intervalMs);
    // Don't hold the process open just for telemetry
    if (typeof (this.timer as any).unref === "function")
      (this.timer as any).unref();
  }

  record(span: Span): void {
    this.buffer.push(span);
    if (this.buffer.length >= this.maxBuffer) this.flush();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    await Promise.resolve(this.exporter.export(batch)).catch(() => {
      /* telemetry must never crash the host */
    });
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  /**
   * Returns a fresh `FlowHooks` closure to hand to any `FlowBuilder`.
   * Each call produces an isolated traceId + span stack so multiple
   * concurrent flows don't bleed into each other.
   */
  hooks<S, P extends Record<string, unknown>>(): Partial<FlowHooks<S, P>> {
    let traceId = "";
    // Stack tracks nested sub-flow spans (batch / loop bodies)
    const stack: Span[] = [];

    return {
      beforeFlow: () => {
        traceId = hex(16);
      },

      wrapStep: async (meta: StepMeta, next: () => Promise<void>) => {
        const span: Span = {
          traceId,
          spanId: hex(8),
          parentId: stack.at(-1)?.spanId,
          name: `${meta.type}[${meta.index}]`,
          startMs: Date.now(),
          endMs: 0,
          durationMs: 0,
          status: "ok",
          attrs: { stepType: meta.type, stepIndex: meta.index },
        };
        stack.push(span);
        try {
          await next();
        } catch (err) {
          span.status = "error";
          span.attrs["error"] =
            err instanceof Error ? err.message : String(err);
          throw err;
        } finally {
          span.endMs = Date.now();
          span.durationMs = span.endMs - span.startMs;
          stack.pop();
          this.record(span);
        }
      },

      // Flush immediately when a flow completes so short scripts don't lose spans
      afterFlow: async () => {
        await this.flush();
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in exporters
// ─────────────────────────────────────────────────────────────────────────────

/** Pretty-prints spans to stdout. */
export const consoleExporter: TelemetryExporter = {
  export(spans) {
    for (const s of spans) {
      const icon =
        s.status === "error" ? "\x1b[31m✗\x1b[0m" : "\x1b[32m✓\x1b[0m";
      console.log(
        `\x1b[2m[telemetry]\x1b[0m ${icon} ${s.name.padEnd(20)} ` +
          `${String(s.durationMs).padStart(5)}ms  ` +
          `trace=${s.traceId.slice(0, 8)}  span=${s.spanId}` +
          (s.parentId ? `  parent=${s.parentId}` : ""),
      );
    }
  },
};

/** Sends spans as OTLP/HTTP JSON to a collector endpoint. */
export function otlpExporter(endpoint: string): TelemetryExporter {
  return {
    async export(spans) {
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spans }),
      }).catch(() => {
        /* swallow network errors */
      });
    },
  };
}
