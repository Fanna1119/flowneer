# Blog Post Generator

A multi-step LLM pipeline that research a topic, writes an outline, drafts each section in parallel, then assembles and reviews the final post. Demonstrates sequential flow, parallel fan-out with a reducer, structured output, and cost tracking.

**Plugins used:** `withCostTracker`, `withRateLimit`, `withStructuredOutput` (LLM), `parallel` (core)

---

## The code

```typescript
import "dotenv/config";
import { FlowBuilder } from "flowneer";
import {
  withCostTracker,
  withStructuredOutput,
  withRateLimit,
} from "flowneer/plugins/llm";
import { callLlm, callLlmWithUsage } from "./utils/callLlm"; // your LLM helper

FlowBuilder.use(withCostTracker);
FlowBuilder.use(withRateLimit);
FlowBuilder.use(withStructuredOutput);

// ─── State ───────────────────────────────────────────────────────────────────

interface BlogState {
  topic: string;
  audience: string;
  research: string;
  outline: string[];
  sections: Record<string, string>;
  draft: string;
  finalPost: string;
  __cost?: number;
}

// ─── Flow ────────────────────────────────────────────────────────────────────

const blogFlow = new FlowBuilder<BlogState>()
  .withCostTracker()
  .withRateLimit({ requestsPerMinute: 60 })

  // Step 1 — Research the topic
  .startWith(async (s) => {
    const { text, usage } = await callLlmWithUsage(
      `Research the topic "${s.topic}" for a blog post targeting ${s.audience}. ` +
        `Summarise the 5 most interesting angles in bullet points.`,
    );
    s.research = text;
    s.__stepCost =
      (usage.inputTokens * 0.00015 + usage.outputTokens * 0.0006) / 1000;
  })

  // Step 2 — Generate a structured outline
  .then(async (s) => {
    const { text, usage } = await callLlmWithUsage(
      `Based on this research:\n${s.research}\n\n` +
        `Write a JSON array of 4 section titles for a blog post about "${s.topic}". ` +
        `Return only valid JSON, e.g. ["Introduction", "Section 2", "Section 3", "Conclusion"]`,
    );
    s.__llmOutput = text;
    s.__stepCost =
      (usage.inputTokens * 0.00015 + usage.outputTokens * 0.0006) / 1000;
  })
  .withStructuredOutput({
    parse: (raw) => JSON.parse(raw) as string[],
    onSuccess: (parsed, s) => {
      s.outline = parsed;
    },
  })

  // Step 3 — Write all sections in parallel
  .parallel(
    [0, 1, 2, 3].map((i) => async (s: BlogState) => {
      const title = s.outline[i]!;
      const text = await callLlm(
        `Write the "${title}" section of a blog post about "${s.topic}" ` +
          `for ${s.audience}. 2–3 paragraphs. Research context:\n${s.research}`,
      );
      s.sections[title] = text;
    }),
    undefined,
    // Reducer: merge sections from each draft back into shared
    (shared, drafts) => {
      shared.sections = Object.assign({}, ...drafts.map((d) => d.sections));
    },
  )

  // Step 4 — Assemble the draft
  .then(async (s) => {
    s.draft = s.outline
      .map((title) => `## ${title}\n\n${s.sections[title] ?? ""}`)
      .join("\n\n");
  })

  // Step 5 — Editorial pass
  .then(async (s) => {
    s.finalPost = await callLlm(
      `You are a senior editor. Improve this blog post draft for clarity, ` +
        `flow, and engagement. Keep it under 1000 words.\n\n${s.draft}`,
    );
  });

// ─── Run ─────────────────────────────────────────────────────────────────────

const state: BlogState = {
  topic: "The rise of AI coding assistants",
  audience: "senior software engineers",
  research: "",
  outline: [],
  sections: {},
  draft: "",
  finalPost: "",
};

await blogFlow.run(state);

console.log("=== FINAL POST ===");
console.log(state.finalPost);
console.log(`\nTotal LLM cost: $${(state.__cost ?? 0).toFixed(4)}`);
```

---

## Key patterns

### Parallel fan-out with a reducer

The parallel step runs one writer per section concurrently. Without a reducer, all four writers would race to write `s.sections` on the same object — unsafe. The reducer receives an array of isolated draft copies and merges them:

```typescript
.parallel(writerFns, undefined, (shared, drafts) => {
  shared.sections = Object.assign({}, ...drafts.map((d) => d.sections));
})
```

### Structured output for the outline

`withStructuredOutput` reads `s.__llmOutput`, parses it with your `parse` function, and calls `onSuccess` only when parsing succeeds. If it fails (malformed JSON) it retries the previous step automatically.

### Cost tracking

Every step sets `s.__stepCost` (in USD). `withCostTracker` accumulates these into `s.__cost` so you have a total at the end.

---

## See also

- [withStructuredOutput](../plugins/llm/structured-output.md)
- [withCostTracker](../plugins/llm/cost-tracker.md)
- [withRateLimit](../plugins/llm/rate-limit.md)
- [Multi-agent Patterns](../plugins/agent/patterns.md) — `supervisorCrew` is a clean alternative for this topology
