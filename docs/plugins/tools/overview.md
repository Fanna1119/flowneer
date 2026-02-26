# withTools & ToolRegistry

Register and execute tools (function-calling) in your flows. `withTools` attaches a `ToolRegistry` instance to `shared.__tools` before the flow starts. Steps call tools directly or via `withReActLoop`.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withTools } from "flowneer/plugins/tools";

FlowBuilder.use(withTools);
```

## Defining Tools

```typescript
import type { Tool } from "flowneer/plugins/tools";

const calculatorTool: Tool = {
  name: "calculator",
  description: "Evaluate a mathematical expression and return the result",
  params: {
    expression: {
      type: "string",
      description: "A valid JavaScript math expression, e.g. '2 + 2 * 3'",
      required: true,
    },
  },
  execute: ({ expression }: { expression: string }) => {
    return Function(`"use strict"; return (${expression})`)();
  },
};

const searchTool: Tool = {
  name: "web_search",
  description: "Search the web for up-to-date information",
  params: {
    query: { type: "string", description: "The search query" },
  },
  execute: async ({ query }: { query: string }) => {
    return fetchSearchResults(query);
  },
};
```

## Registering Tools

```typescript
const flow = new FlowBuilder<State>()
  .withTools([calculatorTool, searchTool])
  .startWith(async (s) => {
    const registry = s.__tools!;
    const result = await registry.execute({
      name: "calculator",
      args: { expression: "42 * 7" },
    });
    s.answer = result.result as number;
  });
```

## `ToolRegistry` API

The registry is attached to `shared.__tools`:

| Method        | Signature                       | Description                              |
| ------------- | ------------------------------- | ---------------------------------------- |
| `get`         | `(name) => Tool \| undefined`   | Look up a tool by name                   |
| `has`         | `(name) => boolean`             | Check if a tool is registered            |
| `names`       | `() => string[]`                | List all tool names                      |
| `definitions` | `() => ToolDefinition[]`        | OpenAI-compatible tool schema objects    |
| `execute`     | `async (call) => ToolResult`    | Execute a single tool call               |
| `executeAll`  | `async (calls) => ToolResult[]` | Execute multiple tool calls concurrently |

## Helper Functions

Import for use inside steps:

```typescript
import { getTools, executeTool, executeTools } from "flowneer/plugins/tools";

// Inside a step:
async (s) => {
  const result = await executeTool(s, {
    name: "calculator",
    args: { expression: "2+2" },
  });
  // result: { name: "calculator", result: 4 }

  const results = await executeTools(s, toolCalls);
};
```

## `ToolResult` Type

```typescript
interface ToolResult {
  callId?: string; // matches the call's id if provided
  name: string;
  result?: unknown; // present on success
  error?: string; // present on failure (tool errors don't throw)
}
```

Tool errors are returned as `{ error }` rather than thrown — your step decides how to handle them.

## LLM Tool Schemas

Use `registry.definitions()` to get OpenAI-compatible tool schemas for your LLM API call:

```typescript
async (s) => {
  const tools = s.__tools!.definitions();
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: buildMessages(s),
    tools: tools.map((t) => ({ type: "function", function: t })),
  });
  // parse tool_calls from response...
};
```

## See Also

- [`withReActLoop`](../agent/react-loop.md) — automated ReAct agent loop with tools
