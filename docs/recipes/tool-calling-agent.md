# Tool-calling Agent

Build a reusable tool-calling agent using `createAgent` and `tool()`. The agent automatically loops through think → tool calls → observation until it produces a final answer.

**Plugins used:** `createAgent`, `tool()` (from `flowneer/plugins/agent`)

---

## The code

```typescript
import "dotenv/config";
import { OpenAI } from "openai";
import { tool, createAgent } from "flowneer/plugins/agent";
import type { LlmAdapter, AgentState } from "flowneer/plugins/agent";

// ─── Tools ───────────────────────────────────────────────────────────────────

const calculator = tool(
  ({ expression }: { expression: string }) => {
    // Safe arithmetic only — replace with a proper parser in production
    return Function(`"use strict"; return (${expression})`)();
  },
  {
    name: "calculator",
    description: "Evaluate a mathematical expression",
    params: {
      expression: {
        type: "string",
        description: "A JavaScript arithmetic expression, e.g. '(12 * 4) / 2'",
        required: true,
      },
    },
  },
);

const getTime = tool(() => new Date().toUTCString(), {
  name: "get_time",
  description: "Get the current UTC date and time",
  params: {},
});

const webSearch = tool(
  async ({ query }: { query: string }) => {
    // Replace with a real search API call
    return `[mock search results for: ${query}]`;
  },
  {
    name: "web_search",
    description: "Search the web for up-to-date information",
    params: {
      query: { type: "string", description: "Search query", required: true },
    },
  },
);

// ─── LLM adapter (OpenAI) ────────────────────────────────────────────────────

const openai = new OpenAI();

const callLlm: LlmAdapter = async (messages, toolDefs) => {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: messages as any,
    tools: toolDefs.map((t) => ({ type: "function" as const, function: t })),
    tool_choice: "auto",
  });

  const msg = res.choices[0]!.message;

  if (msg.tool_calls?.length) {
    return {
      toolCalls: msg.tool_calls.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        args: JSON.parse(tc.function.arguments),
      })),
    };
  }

  return { text: msg.content ?? "" };
};

// ─── Agent (create once, reuse forever) ──────────────────────────────────────

const agent = createAgent({
  tools: [calculator, getTime, webSearch],
  callLlm,
  systemPrompt:
    "You are a helpful assistant. Use the available tools when needed. " +
    "Always show your reasoning before giving a final answer.",
  maxIterations: 8,
});

// ─── Run ─────────────────────────────────────────────────────────────────────

const state: AgentState = {
  input: "What is 1337 * 42, and what time is it right now?",
  messages: [],
};

await agent.run(state);
console.log(state.output);

if (state.__reactExhausted) {
  console.warn("Agent hit the iteration limit without finishing.");
}
```

---

## How it works

1. `tool()` wraps each function with a name, description, and parameter schema.
2. `createAgent()` returns a `FlowBuilder<AgentState>` that wires `.withTools()` + `.withReActLoop()` internally.
3. On each iteration the `callLlm` adapter receives the full conversation history and tool schemas. If the model returns `tool_calls`, Flowneer dispatches them and injects the results into `state.messages` before the next iteration.
4. When the model returns plain text with no tool calls, the loop ends and `state.output` is set.

## Variations

**Swap the model** — change `"gpt-4o-mini"` to `"gpt-4o"` or any Claude / Gemini adapter.

**Add memory** — call `.withMemory(new BufferWindowMemory(10))` on the returned `FlowBuilder` to persist context across runs.

**Cap cost** — add `.withTokenBudget(...)` to stop the loop when the token budget is exceeded.

**Stream chunks** — replace `agent.run(state)` with:

```typescript
for await (const event of agent.stream(state)) {
  if (event.type === "chunk") process.stdout.write(String(event.data));
}
```

## See also

- [createAgent & tool() reference](../plugins/agent/create-agent.md)
- [withReActLoop](../plugins/agent/react-loop.md)
- [withTools & ToolRegistry](../plugins/tools/overview.md)
