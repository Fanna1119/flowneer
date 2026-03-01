# createAgent & tool()

High-level LangChain-style factory functions for building tool-calling agents in a single line of setup. `tool()` defines individual tools and `createAgent()` wires them into a ready-to-run `FlowBuilder`.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { tool, createAgent } from "flowneer/plugins/agent";
```

No `FlowBuilder.use()` calls are needed — `createAgent` registers `withTools` and `withReActLoop` internally.

---

## `tool()`

Create a `Tool` from an execute function and a config object.

```typescript
function tool<TArgs>(
  execute: (args: TArgs) => unknown | Promise<unknown>,
  config: ToolConfigSchema<TArgs> | ToolConfigParams<TArgs>,
): Tool<TArgs>;
```

### With a Zod schema

The preferred style — pass `schema: z.object(...)`. Types are inferred automatically.

```typescript
import { z } from "zod";

const getWeather = tool(
  ({ city }) => `Sunny in ${city}!`, // execute — fully typed from schema
  {
    name: "get_weather",
    description: "Get the current weather for a given city",
    schema: z.object({
      city: z.string().describe("The name of the city"),
    }),
  },
);
```

Zod schemas are duck-typed — no direct Zod import is required at the Flowneer package level.

### With plain `params`

Use the existing Flowneer `ToolParam` shape when you don't want a Zod dependency.

```typescript
const getTime = tool(() => new Date().toUTCString(), {
  name: "get_time",
  description: "Get the current UTC date and time",
  params: {}, // no arguments needed
});

const search = tool(
  async ({ query }: { query: string }) => fetchResults(query),
  {
    name: "web_search",
    description: "Search the web",
    params: {
      query: { type: "string", description: "Search query", required: true },
    },
  },
);
```

### Zod → `ToolParam` type mapping

| Zod type      | `ToolParam.type` |
| ------------- | ---------------- |
| `ZodString`   | `"string"`       |
| `ZodNumber`   | `"number"`       |
| `ZodBoolean`  | `"boolean"`      |
| `ZodObject`   | `"object"`       |
| `ZodArray`    | `"array"`        |
| anything else | `"string"`       |

Optional fields (`z.string().optional()`) are mapped to `required: false`.

---

## `createAgent()`

Build a reusable agent flow.

```typescript
function createAgent(options: CreateAgentOptions): FlowBuilder<AgentState>;
```

Returns a `FlowBuilder<AgentState>`. Call `.run(state)` to execute.

### Options

| Option          | Type         | Default | Description                                  |
| --------------- | ------------ | ------- | -------------------------------------------- |
| `tools`         | `Tool[]`     | —       | Tools the agent can invoke                   |
| `callLlm`       | `LlmAdapter` | —       | Vendor-agnostic LLM adapter (see below)      |
| `systemPrompt`  | `string`     | —       | System message prepended to the conversation |
| `maxIterations` | `number`     | `10`    | Maximum think → act cycles before exhaustion |

### `AgentState`

Initialise a state object and pass it to `.run()`:

```typescript
interface AgentState {
  input: string; // user prompt — required
  output?: string; // final agent answer — set after run completes
  messages: ChatMessage[]; // conversation history (start as empty array)
  systemPrompt?: string; // alternative to the createAgent option
}
```

### `LlmAdapter`

Supply your own LLM integration. The adapter receives the current conversation history and available tool schemas, and returns either a final text answer or a list of tool calls.

```typescript
type LlmAdapter = (
  messages: ChatMessage[],
  tools: LlmToolDef[],
) => Promise<{ text?: string; toolCalls?: ToolCall[] }>;
```

---

## Full example

```typescript
import { z } from "zod";
import { OpenAI } from "openai";
import { tool, createAgent } from "flowneer/plugins/agent";
import type { LlmAdapter, AgentState } from "flowneer/plugins/agent";

// 1. Define tools
const getWeather = tool(
  ({ city }: { city: string }) => `Always sunny in ${city}!`,
  {
    name: "get_weather",
    description: "Get the weather for a given city",
    schema: z.object({ city: z.string().describe("City name") }),
  },
);

const getTime = tool(() => new Date().toUTCString(), {
  name: "get_time",
  description: "Get the current UTC time",
  params: {},
});

// 2. Build an OpenAI adapter
const openai = new OpenAI();

const callLlm: LlmAdapter = async (messages, toolDefs) => {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: messages as any,
    tools: toolDefs.map((t) => ({ type: "function", function: t })),
    tool_choice: "auto",
  });
  const msg = res.choices[0]!.message;
  if (msg.tool_calls?.length) {
    return {
      toolCalls: msg.tool_calls.map((tc) => ({
        id: tc.id,
        name: (tc as any).function.name,
        args: JSON.parse((tc as any).function.arguments),
      })),
    };
  }
  return { text: msg.content ?? "" };
};

// 3. Create the agent (once, reuse for all calls)
const agent = createAgent({
  tools: [getWeather, getTime],
  callLlm,
  systemPrompt: "You are a helpful assistant. Use tools when needed.",
});

// 4. Run it
const state: AgentState = {
  input: "What's the weather in Paris and what time is it?",
  messages: [],
};
await agent.run(state);
console.log(state.output);
```

---

## How it works

`createAgent` composes these Flowneer building blocks internally:

1. **`.withTools(tools)`** — registers the `ToolRegistry` on `shared.__tools`
2. **`.startWith(init)`** — seeds `shared.messages` with the system message + user input
3. **`.withReActLoop({ think, onObservation })`** — calls `callLlm` each iteration; on tool calls appends the assistant turn and dispatches tools; on finish stores the answer
4. **`.then(finalise)`** — copies `shared.__reactOutput` to `shared.output`

The agent is **reusable** — each `.run(state)` call gets its own fresh message history.

---

## Shared state fields set by the agent

| Field              | Type            | Description                                            |
| ------------------ | --------------- | ------------------------------------------------------ |
| `output`           | `string`        | The agent's final answer                               |
| `messages`         | `ChatMessage[]` | Full conversation history after the run                |
| `__reactExhausted` | `boolean`       | `true` when `maxIterations` was reached without finish |
| `__toolResults`    | `ToolResult[]`  | Results from the last tool-execution round             |

---

## See also

- [withReActLoop](./react-loop.md) — low-level ReAct loop primitive
- [withTools](../tools/overview.md) — tool registry API
- [Multi-agent Patterns](./patterns.md) — supervisor, sequential, hierarchical crews
