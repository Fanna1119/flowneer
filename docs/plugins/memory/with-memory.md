# withMemory

Attaches a `Memory` instance to `shared.__memory` before the flow starts, making it available in all steps without manual wiring.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withMemory } from "flowneer/plugins/memory";

FlowBuilder.use(withMemory);
```

## Usage

```typescript
import { BufferWindowMemory, withMemory } from "flowneer/plugins/memory";

const memory = new BufferWindowMemory({ maxMessages: 20 });

const flow = new FlowBuilder<ChatState>()
  .withMemory(memory)
  .startWith(async (s) => {
    await s.__memory!.add({ role: "user", content: s.input });
    const ctx = await s.__memory!.toContext();
    s.response = await callLlm(ctx);
    await s.__memory!.add({ role: "assistant", content: s.response });
  });
```

## What It Does

Registers a `beforeFlow` hook that sets `shared.__memory = memory` before any step runs.

Memory instances are **stateful** and live outside the flow. The same `memory` object is shared across all flow runs, naturally accumulating conversation history across multiple `.run()` calls.

## Accepted Memory Types

Any object implementing the `Memory` interface works:

- [`BufferWindowMemory`](./buffer-window.md) — sliding window of recent messages
- [`KVMemory`](./kv-memory.md) — key-value entity store
- [`SummaryMemory`](./summary-memory.md) — compressing long-form memory
- Custom implementations

## State Keys

| Key        | Direction            | Description                  |
| ---------- | -------------------- | ---------------------------- |
| `__memory` | **Read** (your step) | The attached Memory instance |
