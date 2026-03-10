# iterativeRag

Multi-pass RAG loop: **retrieve → generate → if still unsatisfied, retrieve again**.

Useful when a single retrieval isn't enough and the model needs to issue follow-up searches with a refined query. The current pass number is available as `(shared as any).__ragIter` (0-based) so `retrieve` can adapt its strategy.

## Import

```typescript
import { iterativeRag } from "flowneer/presets/rag";
```

## Usage

```typescript
interface RagState {
  question: string;
  context: string[];
  answer: string;
  followUpQuery?: string;
}

const flow = iterativeRag<RagState>({
  retrieve: async (s) => {
    const query =
      (s as any).__ragIter === 0 ? s.question : (s.followUpQuery ?? s.question);
    s.context = await vectorSearch(query);
  },
  generate: async (s) => {
    const result = await llm(buildPrompt(s));
    s.answer = result.answer;
    s.followUpQuery = result.followUpQuery; // set when more info is needed
  },
  needsMoreInfo: (s) => Boolean(s.followUpQuery),
  maxIterations: 3,
});

await flow.run({
  question: "Explain Flowneer presets",
  context: [],
  answer: "",
});
```

## Options

| Option          | Type                                              | Default | Description                                                                         |
| --------------- | ------------------------------------------------- | ------- | ----------------------------------------------------------------------------------- |
| `retrieve`      | `NodeFn<S, P>`                                    | —       | Fetches documents; `(shared as any).__ragIter` (0-based) indicates the current pass |
| `generate`      | `NodeFn<S, P>`                                    | —       | Generates a (potentially partial) answer; can signal more info is needed            |
| `needsMoreInfo` | `(shared, params) => boolean \| Promise<boolean>` | —       | Return `true` to trigger another retrieve → generate pass                           |
| `maxIterations` | `number`                                          | `3`     | Maximum passes before the loop exits regardless                                     |

## How It Works

```
initialize(__ragIter = 0, __ragDone = false)
loop(while !__ragDone && __ragIter < maxIterations):
  retrieve
  generate
  check needsMoreInfo → set __ragDone or increment __ragIter
cleanup(__ragIter, __ragDone)
```

## Return value

Returns a `FlowBuilder<S, P>` — composable with all Flowneer plugins:

```typescript
const flow = iterativeRag({ retrieve, generate, needsMoreInfo })
  .withCostTracker()
  .withTiming();
```

## See Also

- [`ragPipeline`](./rag-pipeline.md) — single-pass RAG
