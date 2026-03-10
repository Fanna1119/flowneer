# ragPipeline

Standard RAG (Retrieval-Augmented Generation) pipeline: **retrieve → [augment] → generate**.

The most common LLM pattern. `retrieve` writes context to shared state; `generate` reads it to produce the answer. Use the optional `augment` step to rerank or filter before generation.

## Import

```typescript
import { ragPipeline } from "flowneer/presets/rag";
```

## Usage

```typescript
interface RagState {
  query: string;
  context: string[];
  answer: string;
}

const flow = ragPipeline<RagState>({
  retrieve: async (s) => {
    s.context = await vectorSearch(s.query);
  },
  generate: async (s) => {
    s.answer = await llm(buildPrompt(s.query, s.context));
  },
});

await flow.run({ query: "What is Flowneer?", context: [], answer: "" });
```

### With an augmentation step (reranking)

```typescript
const flow = ragPipeline<RagState>({
  retrieve: async (s) => {
    s.context = await vectorSearch(s.query, { topK: 20 });
  },
  augment: async (s) => {
    s.context = await rerank(s.query, s.context, { topK: 5 });
  },
  generate: async (s) => {
    s.answer = await llm(buildPrompt(s.query, s.context));
  },
});
```

## Options

| Option     | Type           | Required | Description                                                |
| ---------- | -------------- | -------- | ---------------------------------------------------------- |
| `retrieve` | `NodeFn<S, P>` | ✓        | Fetches relevant documents and writes them to shared state |
| `augment`  | `NodeFn<S, P>` | —        | Optional reranking / filtering step                        |
| `generate` | `NodeFn<S, P>` | ✓        | Generates the final answer from the retrieved context      |

## Return value

Returns a `FlowBuilder<S, P>` — all plugins and methods work normally on the result:

```typescript
const flow = ragPipeline({ retrieve, generate }).withTiming().withCostTracker();
```

## See Also

- [`iterativeRag`](./iterative-rag.md) — multi-pass retrieval when one search isn't enough
