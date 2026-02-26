# Eval

Zero-dependency evaluation primitives for testing flows against datasets. Includes pure scoring functions and a dataset runner that executes a `FlowBuilder` over an array of inputs and aggregates metric averages.

## Import

```typescript
import {
  exactMatch,
  containsMatch,
  f1Score,
  retrievalPrecision,
  retrievalRecall,
  answerRelevance,
  runEvalSuite,
} from "flowneer/plugins/eval";
import type { ScoreFn, EvalResult, EvalSummary } from "flowneer/plugins/eval";
```

> No `FlowBuilder.use()` registration needed — this plugin exports standalone functions only.

## Scoring Functions

All scoring functions are pure and synchronous, returning a `number` between `0.0` and `1.0`.

### `exactMatch(predicted, expected)`

Case-insensitive exact string comparison.

```typescript
exactMatch("Paris", "paris"); // 1.0
exactMatch("London", "paris"); // 0.0
```

### `containsMatch(predicted, expected)`

Returns `1.0` if `expected` is a substring of `predicted`.

```typescript
containsMatch("The capital is Paris, France", "paris"); // 1.0
containsMatch("The capital is London", "paris"); // 0.0
```

### `f1Score(predicted, expected)`

Token-level F1 score — harmonic mean of token precision and token recall.

```typescript
f1Score("the quick brown fox", "the quick fox"); // ~0.857
f1Score("completely wrong answer", "the quick fox"); // 0.0
```

### `retrievalPrecision(retrieved, relevant)`

Fraction of retrieved items that are in the relevant set.

```typescript
retrievalPrecision(["a", "b", "c"], ["a", "c", "d"]); // 0.667
```

### `retrievalRecall(retrieved, relevant)`

Fraction of relevant items that were retrieved.

```typescript
retrievalRecall(["a", "b"], ["a", "b", "c", "d"]); // 0.5
```

### `answerRelevance(answer, keywords)`

Fraction of `keywords` that appear in `answer`. Returns `1.0` if `keywords` is empty.

```typescript
answerRelevance("Paris is the capital of France", [
  "paris",
  "capital",
  "france",
]); // 1.0
answerRelevance("London is a city", ["paris", "capital", "france"]); // 0.0
```

## Dataset Runner

### `runEvalSuite(dataset, flow, scoreFns)`

Runs a `FlowBuilder` over each item in `dataset` and collects named scores.

```typescript
const { results, summary } = await runEvalSuite(dataset, flow, scoreFns);
```

| Parameter  | Type                         | Description                                                |
| ---------- | ---------------------------- | ---------------------------------------------------------- |
| `dataset`  | `S[]`                        | Array of initial shared-state objects (one per test case)  |
| `flow`     | `FlowBuilder<S, any>`        | The flow to execute for each item                          |
| `scoreFns` | `Record<string, ScoreFn<S>>` | Named functions `(shared: S) => number \| Promise<number>` |

Each dataset item is deep-cloned before the flow runs to prevent cross-contamination between test cases. Items that throw are counted as `failed` and excluded from metric averages.

### `ScoreFn<S>`

```typescript
type ScoreFn<S> = (shared: S) => number | Promise<number>;
```

Receives the final shared state after the flow completes, returns a score between `0.0` and `1.0`.

### `EvalResult<S>`

```typescript
interface EvalResult<S> {
  index: number; // Position in the dataset array
  shared: S; // Final shared state after the flow ran
  scores: Record<string, number>; // Score per named metric
  error?: unknown; // Set if the flow threw
}
```

### `EvalSummary`

```typescript
interface EvalSummary {
  total: number; // Total items
  passed: number; // Items that ran without error
  failed: number; // Items that threw
  averages: Record<string, number>; // Per-metric average (error items excluded)
}
```

## Full Example

```typescript
import { FlowBuilder } from "flowneer";
import {
  exactMatch,
  f1Score,
  answerRelevance,
  runEvalSuite,
} from "flowneer/plugins/eval";

interface QAState {
  question: string;
  expectedAnswer: string;
  output?: string;
}

const qaFlow = new FlowBuilder<QAState>().then(async (s) => {
  s.output = await callLlm(`Answer this question: ${s.question}`);
});

const testCases: QAState[] = [
  { question: "What is the capital of France?", expectedAnswer: "Paris" },
  { question: "What is 2 + 2?", expectedAnswer: "4" },
  { question: "Who wrote Hamlet?", expectedAnswer: "Shakespeare" },
];

const { results, summary } = await runEvalSuite(testCases, qaFlow, {
  exact: (s) => exactMatch(s.output ?? "", s.expectedAnswer),
  f1: (s) => f1Score(s.output ?? "", s.expectedAnswer),
  relevance: (s) =>
    answerRelevance(
      s.output ?? "",
      s.expectedAnswer.toLowerCase().split(/\s+/),
    ),
});

console.log(summary);
// {
//   total: 3,
//   passed: 3,
//   failed: 0,
//   averages: { exact: 0.67, f1: 0.78, relevance: 0.89 }
// }

// Inspect individual results
for (const r of results) {
  if (r.error) {
    console.error(`Item ${r.index} failed:`, r.error);
  } else {
    console.log(`Item ${r.index}:`, r.scores);
  }
}
```

## Combining with Other Plugins

Eval works with any flow, including flows that use `withMocks` to replace LLM calls with deterministic outputs during testing:

```typescript
import { withMocks } from "flowneer/plugins/dev";

FlowBuilder.use(withMocks);

const testFlow = new FlowBuilder<QAState>()
  .then(async (s) => {
    s.output = await callLlm(s.question);
  })
  .withMocks([
    {
      stepIndex: 0,
      mockFn: (s) => {
        s.output = s.expectedAnswer;
      },
    },
  ]);

const { summary } = await runEvalSuite(testCases, testFlow, scoreFns);
// Deterministic: exact average will be 1.0
```
