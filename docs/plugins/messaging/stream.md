# withStream & emit()

Push-based streaming for token-by-token or progress output. Register a subscriber with `.withStream()`, then call `emit(shared, chunk)` from any step to trigger it in real-time.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withStream, emit } from "flowneer/plugins/messaging";

FlowBuilder.use(withStream);
```

## Usage

```typescript
import { emit } from "flowneer/plugins/messaging";

const flow = new FlowBuilder<State>()
  .withStream((chunk) => {
    process.stdout.write(String(chunk));
  })
  .startWith(async (s) => {
    for await (const token of streamFromLlm(s.prompt)) {
      s.response += token;
      emit(s, token); // triggers the subscriber immediately
    }
  });

await flow.run({ prompt: "Tell me a story", response: "" });
```

## `.withStream(subscriber)` Plugin

```typescript
type StreamSubscriber<T = unknown> = (chunk: T) => void;

.withStream<T>(subscriber: StreamSubscriber<T>): this
```

Stores `subscriber` on `shared.__stream` before the first step. Because it lives on `shared`, it is automatically inherited by all sub-flows (loop bodies, batch processors, etc.).

## `emit(shared, chunk)` Helper

```typescript
function emit<T>(shared: { __stream?: StreamSubscriber<T> }, chunk: T): void;
```

A safe no-op when no subscriber is registered. Call it freely — it only executes if `.withStream()` was called.

## Multiple Subscribers

Multiple calls to `.withStream()` replace the subscriber (only the last one is active at runtime). For multiple consumers, compose them in your subscriber:

```typescript
.withStream((chunk) => {
  wsClient.send(chunk);
  logStream.write(chunk);
})
```

## Comparison with `.stream()`

|                   | `withStream` + `emit`      | `FlowBuilder.stream()`                                |
| ----------------- | -------------------------- | ----------------------------------------------------- |
| API style         | Push (subscriber callback) | Pull (async generator)                                |
| Event granularity | Chunk only                 | `step:before`, `step:after`, `chunk`, `error`, `done` |
| Use case          | Simple token streaming     | Full observability pipeline                           |

Both work with generator step functions — `yield` in a generator step sends to whichever mechanism is active.

## Example: HTTP Server

```typescript
Bun.serve({
  async fetch(req) {
    const { prompt } = await req.json();
    const shared = { prompt, response: "" };

    const body = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        flow.withStream((chunk) =>
          controller.enqueue(enc.encode(String(chunk))),
        );
        await flow.run(shared);
        controller.close();
      },
    });

    return new Response(body, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
});
```
