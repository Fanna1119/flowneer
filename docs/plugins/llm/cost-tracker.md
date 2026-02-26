# withCostTracker

Accumulates per-step cost values stored in `shared.__stepCost` into a running total at `shared.__cost`. After each step the `__stepCost` key is cleared to prevent double-counting.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withCostTracker } from "flowneer/plugins/llm";

FlowBuilder.use(withCostTracker);
```

## Usage

```typescript
interface State {
  prompt: string;
  response: string;
  __stepCost?: number;
  __cost?: number;
}

const flow = new FlowBuilder<State>()
  .withCostTracker()
  .startWith(async (s) => {
    const { text, usage } = await callLlmWithUsage(s.prompt);
    s.response = text;
    // Set __stepCost so the plugin picks it up after this step:
    s.__stepCost = usage.totalTokens * 0.000002; // e.g. $0.000002 per token
  })
  .then((s) => {
    console.log(`Total cost so far: $${s.__cost?.toFixed(6)}`);
  });

await flow.run({ prompt: "Hello!", response: "" });
```

## Behaviour

1. After each step completes, `withCostTracker` reads `shared.__stepCost` (defaulting to `0` if absent).
2. Adds it to `shared.__cost` (initialising to `0` on first run).
3. Deletes `shared.__stepCost` so it isn't counted again in subsequent steps.

## State Keys

| Key          | Direction             | Description                             |
| ------------ | --------------------- | --------------------------------------- |
| `__stepCost` | **Write** (your step) | Cost incurred during this step          |
| `__cost`     | **Read** (your step)  | Running total accumulated by the plugin |

## Tips

- Your LLM utility function is responsible for setting `__stepCost`. The plugin only aggregates it.
- Works seamlessly with `.parallel()` — each parallel function can set `__stepCost` on its draft, and the reducer merges costs into the parent.
- Combine with `withTokenBudget` to both track and cap spending.
