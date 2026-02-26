# withReActLoop

Inserts a built-in [ReAct](https://arxiv.org/abs/2210.03629) (Reason + Act) agent loop into the flow. Automatically handles the `think → tool calls → observation → repeat` cycle until the agent signals it's done or the iteration limit is reached.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withReActLoop } from "flowneer/plugins/agent";
import { withTools } from "flowneer/plugins/tools";

FlowBuilder.use(withTools);
FlowBuilder.use(withReActLoop);
```

## Usage

```typescript
import { z } from "zod";

interface AgentState {
  question: string;
  history: string[];
  __toolResults?: any[];
  __reactOutput?: string;
  __reactExhausted?: boolean;
}

const calculatorTool = {
  name: "calculator",
  description: "Evaluate a math expression",
  params: {
    expression: {
      type: "string" as const,
      description: "The expression to evaluate",
    },
  },
  execute: ({ expression }: { expression: string }) => eval(expression),
};

const flow = new FlowBuilder<AgentState>()
  .withTools([calculatorTool])
  .withReActLoop({
    think: async (s) => {
      const response = await callLlm(buildReActPrompt(s));

      // Parse tool calls from LLM response
      const toolCalls = parseToolCalls(response);
      if (toolCalls.length > 0) {
        return { action: "tool", calls: toolCalls };
      }

      return { action: "finish", output: response };
    },
    maxIterations: 10,
    onObservation: async (results, s) => {
      s.history.push(`Tool results: ${JSON.stringify(results)}`);
    },
  })
  .then((s) => {
    if (s.__reactExhausted) {
      console.log("Agent hit iteration limit");
    } else {
      console.log("Answer:", s.__reactOutput);
    }
  });
```

## Options

| Option          | Type                                                      | Default | Description                            |
| --------------- | --------------------------------------------------------- | ------- | -------------------------------------- |
| `think`         | `(shared, params) => ThinkResult \| Promise<ThinkResult>` | —       | The reasoning step                     |
| `maxIterations` | `number`                                                  | `10`    | Maximum think→act cycles               |
| `onObservation` | `(results, shared, params) => void \| Promise<void>`      | —       | Called after each tool execution round |

## `ThinkResult` Type

```typescript
type ThinkResult =
  | { action: "finish"; output?: unknown } // done — stop the loop
  | { action: "tool"; calls: ToolCall[] }; // call these tools and loop
```

## State Keys

| Key                | Direction           | Description                                        |
| ------------------ | ------------------- | -------------------------------------------------- |
| `__tools`          | Set by `withTools`  | The `ToolRegistry` — required                      |
| `__toolResults`    | **Read** in `think` | Results from the last tool round                   |
| `__reactOutput`    | **Read** after loop | The `output` from the final `{ action: "finish" }` |
| `__reactExhausted` | **Read** after loop | `true` if `maxIterations` was reached              |

## How It Works

Behind the scenes, `withReActLoop` compiles down to:

```
.loop(
  (s) => !s.__reactFinished && iterations < maxIterations,
  (b) => b
    .startWith(think → set __pendingToolCalls or __reactFinished)
    .then(execute tools from __pendingToolCalls → set __toolResults)
)
.then(mark __reactExhausted if needed)
```

## Requires `withTools`

`withReActLoop` expects `shared.__tools` to be a `ToolRegistry`. Always call `.withTools([...])` before `.withReActLoop()`.

## See Also

- [`withTools`](../tools/overview.md) — tool registry and execution
- [Agent Patterns](./patterns.md) — multi-agent orchestration
