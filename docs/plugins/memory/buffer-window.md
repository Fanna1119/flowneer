# BufferWindowMemory

A sliding-window message buffer. Keeps the last `k` messages and discards older ones. The simplest and most commonly used memory implementation.

## Usage

```typescript
import { BufferWindowMemory } from "flowneer/plugins/memory";

const memory = new BufferWindowMemory({ maxMessages: 20 });

memory.add({ role: "user", content: "Hello!" });
memory.add({ role: "assistant", content: "Hi there!" });

const context = memory.toContext();
// "user: Hello!\nassistant: Hi there!"

const messages = memory.get();
// [{ role: "user", content: "Hello!" }, ...]
```

## Constructor Options

| Option        | Type     | Default | Description                          |
| ------------- | -------- | ------- | ------------------------------------ |
| `maxMessages` | `number` | `20`    | Maximum number of messages to retain |

## Methods

| Method      | Signature                      | Description                              |
| ----------- | ------------------------------ | ---------------------------------------- |
| `add`       | `(msg: MemoryMessage) => void` | Append a message; prunes when over limit |
| `get`       | `() => MemoryMessage[]`        | Return a copy of current messages        |
| `clear`     | `() => void`                   | Remove all messages                      |
| `toContext` | `() => string`                 | Format as `"role: content\n..."` string  |

## With `withMemory`

```typescript
import { FlowBuilder } from "flowneer";
import { withMemory, BufferWindowMemory } from "flowneer/plugins/memory";

FlowBuilder.use(withMemory);

const memory = new BufferWindowMemory({ maxMessages: 10 });
const flow = new FlowBuilder<ChatState>()
  .withMemory(memory)
  .startWith(async (s) => {
    s.__memory!.add({ role: "user", content: s.input });
    const ctx = s.__memory!.toContext();
    s.response = await callLlm(ctx);
    s.__memory!.add({ role: "assistant", content: s.response });
  });
```

## Pruning Behaviour

When `messages.length > maxMessages`, the **oldest** messages are dropped so only the most recent `maxMessages` remain:

```
[msg1, msg2, ..., msg20, msg21]  →  [msg2, msg3, ..., msg21]
```

This preserves the most recent context without unbounded growth.
