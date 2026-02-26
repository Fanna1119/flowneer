# Memory — Overview

The memory plugin family provides conversational and episodic memory for LLM-powered flows. All memory implementations share the `Memory` interface so they're interchangeable.

## The `Memory` Interface

```typescript
interface Memory {
  add(message: MemoryMessage): void | Promise<void>;
  get(): MemoryMessage[] | Promise<MemoryMessage[]>;
  clear(): void | Promise<void>;
  toContext(): string | Promise<string>;
}

interface MemoryMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  meta?: Record<string, unknown>;
}
```

## Available Implementations

| Class                                      | Description                                   |
| ------------------------------------------ | --------------------------------------------- |
| [`BufferWindowMemory`](./buffer-window.md) | Keeps the last `k` messages                   |
| [`KVMemory`](./kv-memory.md)               | Key-value episodic / entity store             |
| [`SummaryMemory`](./summary-memory.md)     | Compresses old messages via an LLM summarizer |

## Attaching Memory to a Flow

Use `withMemory` to attach any Memory instance to `shared.__memory` before the flow starts:

```typescript
import { FlowBuilder } from "flowneer";
import { withMemory, BufferWindowMemory } from "flowneer/plugins/memory";

FlowBuilder.use(withMemory);

const memory = new BufferWindowMemory({ maxMessages: 20 });

const flow = new FlowBuilder<ChatState>()
  .withMemory(memory)
  .startWith(async (s) => {
    s.__memory!.add({ role: "user", content: s.userInput });
    const context = await s.__memory!.toContext();
    s.response = await callLlm(context);
    s.__memory!.add({ role: "assistant", content: s.response });
  });
```

## Multi-turn Conversation Pattern

Memory instances are **stateful** and live outside the flow. Create them once and reuse across turns:

```typescript
const memory = new BufferWindowMemory({ maxMessages: 30 });

async function chat(userInput: string): Promise<string> {
  const state = { userInput, response: "" };
  await flow.run(state); // flow uses the same memory instance each call
  return state.response;
}
```
