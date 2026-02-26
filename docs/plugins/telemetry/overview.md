# TelemetryDaemon

A lightweight background daemon that collects per-step spans and exports them in batches. Completely external to core — wired via the `FlowHooks` API with zero coupling.

## Import

```typescript
import { TelemetryDaemon, consoleExporter } from "flowneer/plugins/telemetry";
```

## Usage

```typescript
import { TelemetryDaemon, consoleExporter } from "flowneer/plugins/telemetry";
import { FlowBuilder } from "flowneer";

const telemetry = new TelemetryDaemon({
  exporter: consoleExporter,
  flushIntervalMs: 5000,
  maxBuffer: 100,
});

const flow = new FlowBuilder<State>();
// Attach telemetry hooks — each call generates isolated traceId + spans
flow._setHooks(telemetry.hooks());

flow.startWith(stepA).then(stepB).then(stepC);

await flow.run(shared);

// Flush remaining spans on shutdown
process.on("SIGTERM", () => telemetry.stop());
```

## Constructor Options

| Option            | Type                | Default           | Description                                |
| ----------------- | ------------------- | ----------------- | ------------------------------------------ |
| `exporter`        | `TelemetryExporter` | `consoleExporter` | Where to send spans                        |
| `flushIntervalMs` | `number`            | `5000`            | How often to flush the span buffer (ms)    |
| `maxBuffer`       | `number`            | `100`             | Force flush after this many buffered spans |

## `Span` Object

```typescript
interface Span {
  traceId: string; // per-run unique ID
  spanId: string; // per-step unique ID
  parentId?: string; // spans inside sub-flows point to their parent
  name: string; // e.g. "fn[0]", "batch[2]"
  startMs: number; // Unix ms
  endMs: number;
  durationMs: number;
  status: "ok" | "error";
  attrs: Record<string, unknown>;
}
```

## Custom Exporter

Implement `TelemetryExporter` to send spans to any backend (OpenTelemetry, Jaeger, Datadog, etc.):

```typescript
import type { TelemetryExporter, Span } from "flowneer/plugins/telemetry";

const otlpExporter: TelemetryExporter = {
  export(spans: Span[]) {
    return fetch("http://otel-collector:4318/v1/traces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spans }),
    });
  },
};

const telemetry = new TelemetryDaemon({ exporter: otlpExporter });
```

## `consoleExporter`

A built-in exporter that pretty-prints spans to `console.log`:

```
[telemetry] fn[0] ok 142ms { stepType: "fn", stepIndex: 0 }
[telemetry] fn[1] ok 8ms { stepType: "fn", stepIndex: 1 }
```

## `TelemetryDaemon` Methods

| Method          | Description                                                           |
| --------------- | --------------------------------------------------------------------- |
| `hooks<S, P>()` | Returns `FlowHooks` to attach to a flow. Call once per flow instance. |
| `flush()`       | Force-flush the current buffer immediately                            |
| `stop()`        | Clear the flush timer and flush remaining spans                       |
| `record(span)`  | Manually record a span (advanced)                                     |

## Multiple Flows

`hooks()` creates an isolated traceId and span context each time it's called, so multiple concurrent flows don't bleed into each other:

```typescript
const flow1 = new FlowBuilder<StateA>();
flow1._setHooks(telemetry.hooks()); // traceId: "abc..."

const flow2 = new FlowBuilder<StateB>();
flow2._setHooks(telemetry.hooks()); // traceId: "xyz..."
```
