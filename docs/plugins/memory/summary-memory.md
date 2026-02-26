# SummaryMemory

A memory implementation that automatically compresses old messages into a running summary when the buffer grows too large. Ideal for long conversations that must stay within an LLM's context window.

## Usage

```typescript
import { SummaryMemory } from "flowneer/plugins/memory";
import { callLlm } from "./utils/callLlm";

const memory = new SummaryMemory({
  maxMessages: 10,
  summarize: async (messages) => {
    const text = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
    return callLlm(`Summarize this conversation concisely:\n${text}`);
  },
});
```

## Constructor Options

| Option        | Type                                  | Required | Default | Description                                  |
| ------------- | ------------------------------------- | -------- | ------- | -------------------------------------------- |
| `summarize`   | `(msgs) => string \| Promise<string>` | ✅       | —       | Summarisation function (usually an LLM call) |
| `maxMessages` | `number`                              |          | `10`    | Number of recent messages to keep verbatim   |

## Methods

| Method      | Signature                      | Description                                         |
| ----------- | ------------------------------ | --------------------------------------------------- |
| `add`       | `async (msg) => Promise<void>` | Append a message; may trigger summarisation         |
| `get`       | `() => MemoryMessage[]`        | Current messages, prepended with summary if present |
| `clear`     | `() => void`                   | Remove all messages and the running summary         |
| `toContext` | `() => string`                 | Formatted context: summary block + recent messages  |

> **Note:** `add()` is async because it may call your `summarize` function. Await it in your steps.

## Compression Behaviour

When `messages.length > maxMessages`:

1. The **oldest half** of messages is passed to `summarize`.
2. If a previous summary exists it is prepended as context for the new summary.
3. The compressed messages are replaced by a single `[Summary] ...` system message.

This keeps the conversation context manageable for long sessions.

## Example with `withMemory`

```typescript
import { FlowBuilder } from "flowneer";
import { withMemory, SummaryMemory } from "flowneer/plugins/memory";

FlowBuilder.use(withMemory);

const memory = new SummaryMemory({
  maxMessages: 8,
  summarize: (msgs) =>
    callLlm(
      "Summarize:\n" + msgs.map((m) => `${m.role}: ${m.content}`).join("\n"),
    ),
});

const flow = new FlowBuilder<ChatState>()
  .withMemory(memory)
  .startWith(async (s) => {
    await s.__memory!.add({ role: "user", content: s.userInput });
    const ctx = await s.__memory!.toContext();
    s.response = await callLlm(`${ctx}\nassistant:`);
    await s.__memory!.add({ role: "assistant", content: s.response });
  });
```
