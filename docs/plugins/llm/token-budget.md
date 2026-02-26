# withTokenBudget

Aborts the flow before any step runs if the cumulative token usage has reached or exceeded a configured limit.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withTokenBudget } from "flowneer/plugins/llm";

FlowBuilder.use(withTokenBudget);
```

## Usage

```typescript
interface State {
  prompt: string;
  response: string;
  tokensUsed: number;
}

const flow = new FlowBuilder<State>()
  .withTokenBudget(100_000) // abort if tokensUsed >= 100 000
  .startWith(async (s) => {
    const { text, usage } = await callLlmWithUsage(s.prompt);
    s.response = text;
    s.tokensUsed = (s.tokensUsed ?? 0) + usage.totalTokens;
  })
  .then(async (s) => {
    // If this step runs, we know tokensUsed < 100 000
    await summarize(s);
  });

await flow.run({ prompt: "...", response: "", tokensUsed: 0 });
```

## Behaviour

- Before each step, reads `shared.tokensUsed ?? 0`.
- If `tokensUsed >= limit`, throws `Error("token budget exceeded: {used} >= {limit}")`.
- Wrapped in a `FlowError` like any other step error.

## State Keys

| Key          | Direction             | Description                                      |
| ------------ | --------------------- | ------------------------------------------------ |
| `tokensUsed` | **Write** (your step) | Running token count; your steps must update this |

## Combining with withCostTracker

```typescript
const flow = new FlowBuilder<State>()
  .withTokenBudget(50_000) // hard cap
  .withCostTracker() // accumulate dollar cost in __cost
  .startWith(async (s) => {
    const { text, usage } = await callLlm(s.prompt);
    s.response = text;
    s.tokensUsed = (s.tokensUsed ?? 0) + usage.totalTokens;
    s.__stepCost = usage.totalTokens * 0.000002;
  });
```
