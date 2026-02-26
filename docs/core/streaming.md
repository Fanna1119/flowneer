# Streaming

Flowneer supports two complementary streaming APIs:

1. **`.stream()` on `FlowBuilder`** — pull-based async generator yielding structured `StreamEvent` objects.
2. **Generator step functions** — push token chunks from inside a step.
3. **`.withStream()` plugin** — push-based subscriber registered on `shared.__stream`.

---

## FlowBuilder.stream()

`.stream()` is the recommended API when consuming a flow from the outside. It yields events as the flow runs:

```typescript
for await (const event of flow.stream(shared)) {
  switch (event.type) {
    case "step:before":
      console.log(`→ step ${event.meta.index} starting`);
      break;
    case "step:after":
      console.log(`✓ step ${event.meta.index} done`);
      break;
    case "chunk":
      process.stdout.write(String(event.data));
      break;
    case "error":
      console.error("Flow error:", event.error);
      break;
    case "done":
      console.log("\nFlow complete");
      break;
  }
}
```

### StreamEvent types

| `type`        | Payload          | When                                    |
| ------------- | ---------------- | --------------------------------------- |
| `step:before` | `meta: StepMeta` | Before each step body executes          |
| `step:after`  | `meta, shared`   | After each step body completes          |
| `chunk`       | `data: unknown`  | Yielded by a generator step or `emit()` |
| `error`       | `error: unknown` | Unhandled error during the flow         |
| `done`        | —                | After `afterFlow` hooks complete        |

---

## Generator Step Functions

Declare a step as `async function*` to yield chunks in real-time. Each `yield` value is forwarded as a `chunk` event. The generator's final `return` value is used for anchor routing (just like plain steps).

```typescript
const flow = new FlowBuilder<{ prompt: string; response: string }>().startWith(
  async function* (s) {
    s.response = "";
    for await (const token of callLlmStream(s.prompt)) {
      s.response += token;
      yield token; // → "chunk" event
    }
    // return "#anchorName" // optional routing
  },
);

for await (const event of flow.stream({ prompt: "Hello", response: "" })) {
  if (event.type === "chunk") process.stdout.write(String(event.data));
}
```

---

## withStream Plugin

The `withStream` plugin registers a **push-based subscriber** on `shared.__stream`. Call `emit(shared, chunk)` from any step to trigger it:

```typescript
import { FlowBuilder } from "flowneer";
import { withStream, emit } from "flowneer/plugins/messaging";

FlowBuilder.use(withStream);

const flow = new FlowBuilder<MyState>()
  .withStream((chunk) => {
    process.stdout.write(String(chunk));
  })
  .startWith(async (s) => {
    for await (const token of streamLlm(s.prompt)) {
      s.response += token;
      emit(s, token); // triggers the subscriber
    }
  });
```

`emit()` is a safe no-op when no subscriber is registered.

The subscriber is stored on `shared.__stream` so it is **inherited by sub-flows** (inside `.loop()`, `.batch()`, etc.) automatically.

---

## HTTP Streaming Server

Both APIs compose well with HTTP streaming. Here's a minimal Bun server example:

```typescript
import { FlowBuilder } from "flowneer";

const flow = new FlowBuilder<{ prompt: string; response: string }>().startWith(
  async function* (s) {
    s.response = "";
    for await (const token of streamLlm(s.prompt)) {
      s.response += token;
      yield token;
    }
  },
);

Bun.serve({
  port: 3000,
  async fetch(req) {
    const { prompt } = await req.json();
    const shared = { prompt, response: "" };

    const stream = new ReadableStream({
      async start(controller) {
        for await (const event of flow.stream(shared)) {
          if (event.type === "chunk") {
            controller.enqueue(new TextEncoder().encode(String(event.data)));
          }
          if (event.type === "done") controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
});
```
