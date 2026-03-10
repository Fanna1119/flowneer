# mapReduceLlm

Map-reduce over LLM calls: run `map` once per item from an `items` list, then run `reduce` once to aggregate all results.

Core pattern for batch document processing, multi-source summarisation, and any workload that fans out across a list then fans back in.

## Import

```typescript
import { mapReduceLlm } from "flowneer/presets/pipeline";
```

## Usage

```typescript
interface SummariseState {
  documents: string[];
  summaries: string[];
  finalSummary: string;
}

const flow = mapReduceLlm<SummariseState>({
  items: (s) => s.documents,
  map: async (s) => {
    s.summaries ??= [];
    s.summaries.push(await llm(`Summarise: ${(s as any).__mapItem}`));
  },
  reduce: async (s) => {
    s.finalSummary = await llm(
      `Combine these summaries:\n${s.summaries.join("\n")}`,
    );
  },
});

await flow.run({
  documents: ["doc1...", "doc2..."],
  summaries: [],
  finalSummary: "",
});
```

## Options

| Option    | Type                                          | Default       | Description                                                 |
| --------- | --------------------------------------------- | ------------- | ----------------------------------------------------------- |
| `items`   | `(shared, params) => any[] \| Promise<any[]>` | —             | Returns the array of items to process                       |
| `map`     | `NodeFn<S, P>`                                | —             | Per-item step — `shared[itemKey]` holds the current item    |
| `reduce`  | `NodeFn<S, P>`                                | —             | Aggregation step — runs once after all items are processed  |
| `itemKey` | `string`                                      | `"__mapItem"` | Key under which the current item is exposed on shared state |

## How It Works

Internally uses `.batch()` to iterate over `items`, placing each item on `shared[itemKey]` before calling `map`, then calls `reduce` once:

```
batch(items → shared[itemKey]) → map
then → reduce
```

## Return value

Returns a `FlowBuilder<S, P>`:

```typescript
const flow = mapReduceLlm({ items, map, reduce })
  .withCostTracker()
  .withTiming();
```

## See Also

- [`generateUntilValid`](./generate-until-valid.md) — generate with retry on validation failure
- [Batch Document Processing](../../recipes/batch-document-processing.md) — recipe using this pattern
