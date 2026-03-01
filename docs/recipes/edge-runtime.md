# Edge Runtime

Run Flowneer flows on Cloudflare Workers, Vercel Edge Runtime, and Deno Deploy — no configuration, no shims, no changes to your flow code.

**Plugins used:** any — the core and all bundled plugins are edge-compatible by default

---

## Why it just works

Flowneer has zero runtime dependencies. The core (`FlowBuilder`, `.run()`, `.stream()`, every built-in plugin) uses only:

- **ECMAScript built-ins** — `Promise`, `AsyncGenerator`, `Array`, `Map`, `Set`
- **Web-standard globals** — `setTimeout`/`clearTimeout` (timers), `fetch`, `globalThis.crypto`
- **Nothing Node-specific** — no `fs`, `path`, `Buffer`, `node:*` imports, `require()`, or Node streams

`.stream()` returns a plain `AsyncGenerator`, not a Node.js `Readable`. You can pipe it straight into a `ReadableStream` response — the same pattern works on every edge runtime.

---

## Cloudflare Workers

```typescript
import { FlowBuilder } from "flowneer";
import { withTiming } from "flowneer/plugins/observability";

FlowBuilder.use(withTiming);

interface SummariseState {
  url: string;
  content: string;
  summary: string;
}

const summariseFlow = new FlowBuilder<SummariseState>()
  .withTiming()
  .startWith(async (s) => {
    const res = await fetch(s.url);
    s.content = await res.text();
  })
  .then(async (s) => {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${(globalThis as any).OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: `Summarise in one paragraph:\n${s.content.slice(0, 4000)}`,
          },
        ],
      }),
    });
    const data = (await res.json()) as any;
    s.summary = data.choices[0].message.content;
  });

export default {
  async fetch(
    request: Request,
    env: Record<string, string>,
    ctx: ExecutionContext,
  ) {
    const url = new URL(request.url).searchParams.get("url");
    if (!url) return new Response("Missing ?url=", { status: 400 });

    const state = await summariseFlow.run({ url, content: "", summary: "" });
    return Response.json({ summary: state.summary });
  },
} satisfies ExportedHandler;
```

### Streaming SSE on Cloudflare Workers

`.stream()` produces an `AsyncGenerator<StreamEvent>`. Wrap it in a `ReadableStream` response — Cloudflare Workers supports chunked `ReadableStream` responses natively.

```typescript
import type { StreamEvent } from "flowneer";

const encoder = new TextEncoder();

export default {
  async fetch(request: Request) {
    const topic = new URL(request.url).searchParams.get("topic") ?? "AI";

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of myFlow.stream({ topic })) {
            if (event.type === "chunk") {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(event.data)}\n\n`),
              );
            }
            if (event.type === "done") break;
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  },
} satisfies ExportedHandler;
```

### ⚠️ Telemetry daemon on Cloudflare Workers

The `TelemetryDaemon` plugin uses a `setInterval`-based background flush loop. Cloudflare Workers execute inside V8 isolates — timers registered after a `Response` is returned **do not fire**. The auto-flush will be silently skipped.

**Fix:** disable auto-flush and call `telemetry.flush()` inside `ctx.waitUntil()` so Cloudflare keeps the isolate alive until the export completes:

```typescript
import { TelemetryDaemon } from "flowneer/plugins/telemetry";

// flushIntervalMs: 0 disables the setInterval background loop
const telemetry = new TelemetryDaemon({
  flushIntervalMs: 0,
  exporter: otlpExporter("https://otel.example.com/v1/traces"),
});
FlowBuilder.use(telemetry.plugin());

export default {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext) {
    const state = await myFlow.run(initialState(request));

    // waitUntil keeps the isolate alive while telemetry drains
    ctx.waitUntil(telemetry.flush());

    return Response.json(state);
  },
} satisfies ExportedHandler;
```

All other plugins — resilience, persistence, observability, memory, messaging, tools, agent, dev, output — are fully compatible with Cloudflare Workers without any changes.

---

## Vercel Edge Runtime

Add `export const runtime = "edge"` to a Next.js Route Handler. Everything works, including `TelemetryDaemon`'s auto-flush (Vercel Edge Runtime is Node-compatible and doesn't have the CF Workers timer restriction).

```typescript
// app/api/summarise/route.ts
import { FlowBuilder } from "flowneer";
import { withTiming } from "flowneer/plugins/observability";
import type { NextRequest } from "next/server";

export const runtime = "edge";

FlowBuilder.use(withTiming);

interface State {
  prompt: string;
  result: string;
}

const flow = new FlowBuilder<State>()
  .withTiming()
  .startWith(async (s) => {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: s.prompt }],
      }),
    });
    const data = (await res.json()) as any;
    s.result = data.choices[0].message.content;
  });

export async function GET(req: NextRequest) {
  const prompt = req.nextUrl.searchParams.get("prompt") ?? "Hello";
  const state = await flow.run({ prompt, result: "" });
  return Response.json({ result: state.result });
}
```

### Streaming on Vercel Edge

```typescript
// app/api/stream/route.ts
import type { NextRequest } from "next/server";

export const runtime = "edge";
const encoder = new TextEncoder();

export async function GET(req: NextRequest) {
  const prompt = req.nextUrl.searchParams.get("prompt") ?? "Hello";

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of myFlow.stream({ prompt })) {
          if (event.type === "chunk") {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event.data)}\n\n`),
            );
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
```

---

## Deno Deploy

```typescript
import { FlowBuilder } from "npm:flowneer";

interface State {
  prompt: string;
  result: string;
}

const flow = new FlowBuilder<State>().startWith(async (s) => {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: s.prompt }],
    }),
  });
  const data = (await res.json()) as any;
  s.result = data.choices[0].message.content;
});

Deno.serve(async (req) => {
  const prompt = new URL(req.url).searchParams.get("prompt") ?? "Hello";
  const state = await flow.run({ prompt, result: "" });
  return Response.json({ result: state.result });
});
```

---

## Compatibility table

| Feature                                                     |     CF Workers     | Vercel Edge | Deno Deploy |
| ----------------------------------------------------------- | :----------------: | :---------: | :---------: |
| `FlowBuilder.run()`                                         |         ✅         |     ✅      |     ✅      |
| `FlowBuilder.stream()`                                      |         ✅         |     ✅      |     ✅      |
| `withTryCatch`, `withFallback`, `withCircuitBreaker`        |         ✅         |     ✅      |     ✅      |
| `withTimeout`                                               |         ✅         |     ✅      |     ✅      |
| `withRateLimit`                                             |         ✅         |     ✅      |     ✅      |
| `withTiming`, `withHistory`, `withCallbacks`, `withVerbose` |         ✅         |     ✅      |     ✅      |
| `withMemory`, `withCheckpoint`, `withAuditLog`              |         ✅         |     ✅      |     ✅      |
| `withStream`, `emit()`                                      |         ✅         |     ✅      |     ✅      |
| `createAgent`, `withReActLoop`                              |         ✅         |     ✅      |     ✅      |
| `withStructuredOutput`, `withTokenBudget`                   |         ✅         |     ✅      |     ✅      |
| `TelemetryDaemon` (auto-flush)                              | ⚠️ use `waitUntil` |     ✅      |     ✅      |
| `.batch()`, `.loop()`, `.parallel()`                        |         ✅         |     ✅      |     ✅      |
