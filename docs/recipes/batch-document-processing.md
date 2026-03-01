# Batch Document Processing

Process a large collection of documents: extract structured data from each one in parallel batches, collect results with a reducer, then aggregate into a final report. Demonstrates `.batch()`, nested `.parallel()`, `withStructuredOutput`, and safe concurrent writes.

**Plugins used:** `withStructuredOutput` (LLM), `.batch()` + `.parallel()` (core)

---

## The code

```typescript
import "dotenv/config";
import { FlowBuilder } from "flowneer";
import { withStructuredOutput } from "flowneer/plugins/llm";
import { withRateLimit } from "flowneer/plugins/llm";
import { callLlm } from "./utils/callLlm";

FlowBuilder.use(withStructuredOutput);
FlowBuilder.use(withRateLimit);

// ─── Types ───────────────────────────────────────────────────────────────────

interface Document {
  id: string;
  text: string;
}

interface ExtractedData {
  documentId: string;
  summary: string;
  sentiment: "positive" | "neutral" | "negative";
  keyTopics: string[];
  wordCount: number;
}

interface ProcessingState {
  documents: Document[];
  results: ExtractedData[];
  report: string;
  __batchItem?: Document; // injected by .batch()
  __llmOutput?: string; // used by withStructuredOutput
}

// ─── Extraction prompt ───────────────────────────────────────────────────────

function extractionPrompt(doc: Document) {
  return (
    `Analyse the following document and return a JSON object with these fields:\n` +
    `- summary: string (1-2 sentences)\n` +
    `- sentiment: "positive" | "neutral" | "negative"\n` +
    `- keyTopics: string[] (up to 5 topics)\n\n` +
    `Document:\n${doc.text}\n\n` +
    `Return only valid JSON.`
  );
}

// ─── Inner flow — processes one document ─────────────────────────────────────

const extractFlow = new FlowBuilder<ProcessingState>()
  .withRateLimit({ requestsPerMinute: 30 })
  .startWith(async (s) => {
    const doc = s.__batchItem!;
    s.__llmOutput = await callLlm(extractionPrompt(doc));
  })
  .withStructuredOutput({
    parse: (raw) => JSON.parse(raw),
    retries: 2,
    onSuccess: (parsed, s) => {
      const doc = s.__batchItem!;
      s.results.push({
        documentId: doc.id,
        wordCount: doc.text.split(/\s+/).length,
        ...parsed,
      });
    },
  });

// ─── Outer flow — batches all documents, then aggregates ─────────────────────

const pipeline = new FlowBuilder<ProcessingState>()

  .startWith((s) => {
    s.results = [];
  })

  // Process all documents via the inner flow, one per batch item
  .batch(
    (s) => s.documents,
    (b) => b.add(extractFlow),
  )

  // Aggregate results into a report
  .then(async (s) => {
    const pos = s.results.filter((r) => r.sentiment === "positive").length;
    const neg = s.results.filter((r) => r.sentiment === "negative").length;
    const neu = s.results.filter((r) => r.sentiment === "neutral").length;
    const allTopics = s.results.flatMap((r) => r.keyTopics);
    const topicFreq = allTopics.reduce<Record<string, number>>((acc, t) => {
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {});
    const topTopics = Object.entries(topicFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([t]) => t);

    s.report = [
      `# Document Processing Report`,
      ``,
      `**Total documents:** ${s.results.length}`,
      `**Sentiment:** ${pos} positive / ${neu} neutral / ${neg} negative`,
      `**Top topics:** ${topTopics.join(", ")}`,
      ``,
      `## Summaries`,
      ...s.results.map((r) => `- **${r.documentId}** — ${r.summary}`),
    ].join("\n");
  });

// ─── Run ─────────────────────────────────────────────────────────────────────

const documents: Document[] = [
  {
    id: "doc-1",
    text: "TypeScript 5.0 was released with exciting new features...",
  },
  {
    id: "doc-2",
    text: "The new machine learning framework struggled with performance...",
  },
  {
    id: "doc-3",
    text: "Open source contributors celebrated a major milestone today...",
  },
  // Add as many as you need — .batch() processes them sequentially,
  // or switch to .parallel() for concurrent processing (see variation below)
];

const state: ProcessingState = {
  documents,
  results: [],
  report: "",
};

await pipeline.run(state);
console.log(state.report);
```

---

## Variation — parallel processing

Replace `.batch()` with `.parallel()` to process all documents concurrently. Use a reducer to safely merge results back:

```typescript
.parallel(
  documents.map((doc) => async (s: ProcessingState) => {
    s.__batchItem = doc;
    await extractFlow.run(s);
  }),
  undefined,
  // Reducer: merge results arrays from each isolated draft
  (shared, drafts) => {
    shared.results = drafts.flatMap((d) => d.results);
  },
)
```

::: warning Rate limits
Running many documents in parallel increases your LLM request rate significantly. Make sure `withRateLimit` is configured before enabling this.
:::

## Variation — chunked parallel batches

Process in chunks of N concurrently using nested `.batch()` + `.parallel()`:

```typescript
// chunk the documents array first
const chunkSize = 5;
const chunks: Document[][] = [];
for (let i = 0; i < documents.length; i += chunkSize) {
  chunks.push(documents.slice(i, i + chunkSize));
}

// outer batch over chunks, inner parallel over each chunk
const pipeline = new FlowBuilder<ProcessingState>()
  .startWith((s) => {
    s.results = [];
  })
  .batch(
    () => chunks,
    (b) =>
      b
        .startWith((s) => {
          // parallel within the chunk
        })
        .parallel(
          (s.__batchItem as Document[]).map((doc) => async (s) => {
            /* extract doc */
          }),
          undefined,
          (shared, drafts) => {
            shared.results.push(...drafts.flatMap((d) => d.results));
          },
        ),
  );
```

---

## See also

- [withStructuredOutput](../plugins/llm/structured-output.md)
- [withRateLimit](../plugins/llm/rate-limit.md)
- [Step Types — batch & parallel](../core/step-types.md)
