// ---------------------------------------------------------------------------
// Flowneer — Step Filter example
// ---------------------------------------------------------------------------
// Demonstrates how to scope a plugin (or raw hooks) to a specific subset of
// steps using the StepFilter parameter of `.withRateLimit()` / `.addHooks()`.
//
// Three patterns are shown:
//
//   1. Array filter   — plugin fires only for steps in a label allowlist
//   2. Predicate      — plugin fires only when a custom function returns true
//   3. addHooks filter — apply the same scoping mechanism to raw hook objects
//
// All LLM calls are mocked — no API key required.
// Run with: bun run examples/stepFilter.ts
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import { withRateLimit } from "../../plugins/llm";

const RateLimitFlow = FlowBuilder.extend([withRateLimit]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Fake LLM call — just burns ~50 ms */
async function fakeLlm(prompt: string): Promise<string> {
  await sleep(50);
  return `[LLM response to: "${prompt.slice(0, 40)}…"]`;
}

function separator(title: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(` ${title}`);
  console.log("─".repeat(60));
}

function ts() {
  return new Date().toISOString().slice(11, 23);
}

// ── State ─────────────────────────────────────────────────────────────────────

interface PipelineState {
  input: string;
  summary?: string;
  sentiment?: string;
  keywords?: string[];
  report?: string;
}

// =============================================================================
// Pattern 1 — Array filter
// =============================================================================
// Rate-limit only the two LLM-heavy steps ("summarise" and "sentiment").
// The "keywords" step (labelled "keywords") is NOT in the allowlist —
// it runs immediately with no delay even though the plugin is attached.
// The unlabelled "assemble" step is also unaffected.
// =============================================================================

separator("Pattern 1 — Array filter: rate-limit only LLM steps");

{
  const flow = new RateLimitFlow<PipelineState>()
    // 2000 ms minimum gap, but ONLY between steps labelled "summarise" or "sentiment"
    .withRateLimit({ intervalMs: 2000 }, ["summarise", "sentiment"])

    .startWith(
      async (s) => {
        console.log(`  ${ts()}  [summarise] calling LLM…`);
        s.summary = await fakeLlm(`Summarise: ${s.input}`);
        console.log(`  ${ts()}  [summarise] done`);
      },
      { label: "summarise" },
    )

    .then(
      async (s) => {
        console.log(`  ${ts()}  [sentiment] calling LLM…`);
        s.sentiment = await fakeLlm(`Sentiment of: ${s.summary}`);
        console.log(`  ${ts()}  [sentiment] done`);
      },
      { label: "sentiment" },
    )

    // Not in the allowlist — runs freely
    .then(
      async (s) => {
        console.log(`  ${ts()}  [keywords] CPU work (no rate-limit delay)`);
        s.keywords = s.input.split(" ").slice(0, 5);
      },
      { label: "keywords" },
    )

    // Unlabelled — also unaffected
    .then(async (s) => {
      console.log(`  ${ts()}  [assemble] building report`);
      s.report = `${s.summary} | ${s.sentiment} | [${s.keywords?.join(", ")}]`;
      console.log(`  ${ts()}  [assemble] done`);
      console.log(`\n  Result: ${s.report}`);
    });

  const t0 = Date.now();
  await flow.run({ input: "The quick brown fox jumps over the lazy dog" });
  console.log(`\n  Total time: ${Date.now() - t0} ms`);
  console.log(
    "  (expect ~2000 ms between summarise→sentiment; keywords/assemble run freely)",
  );
}

// =============================================================================
// Pattern 2 — Wildcard filter
// =============================================================================
// Array entries support glob-style "*" wildcards so you don't need a
// predicate just to match a label prefix or suffix convention.
// ["llm:*"] matches any step whose label starts with "llm:".
// =============================================================================

separator('Pattern 2 — Wildcard filter: ["llm:*"]');

{
  const flow = new RateLimitFlow<PipelineState>()
    .withRateLimit({ intervalMs: 300 }, ["llm:*"])

    .startWith(
      async (s) => {
        console.log(`  ${ts()}  [llm:summarise] calling LLM…`);
        s.summary = await fakeLlm(`Summarise: ${s.input}`);
        console.log(`  ${ts()}  [llm:summarise] done`);
      },
      { label: "llm:summarise" },
    )

    .then(
      async (s) => {
        console.log(`  ${ts()}  [llm:sentiment] calling LLM…`);
        s.sentiment = await fakeLlm(`Sentiment of: ${s.summary}`);
        console.log(`  ${ts()}  [llm:sentiment] done`);
      },
      { label: "llm:sentiment" },
    )

    // label does NOT match "llm:*" — runs freely
    .then(
      async (s) => {
        console.log(`  ${ts()}  [preprocess] fast CPU step (no delay)`);
        s.keywords = s.input.split(" ").slice(0, 5);
      },
      { label: "preprocess" },
    );

  const t0 = Date.now();
  await flow.run({ input: "The quick brown fox jumps over the lazy dog" });
  console.log(`\n  Total time: ${Date.now() - t0} ms`);
}

// =============================================================================
// Pattern 3 — _setHooks() with a filter
// =============================================================================
// The same StepFilter parameter is available on the lower-level `_setHooks()`
// API, letting you scope any custom hook to a subset of steps without
// writing the meta.label check yourself inside the hook body.
// =============================================================================

separator("Pattern 3 — _setHooks() with a filter");

{
  const timings: Record<string, number> = {};

  const flow = new FlowBuilder<PipelineState>();

  // Only record timing for the two LLM steps — ignore cheap prep steps
  (flow as any)._setHooks(
    {
      beforeStep: (meta) => {
        timings[meta.label!] = Date.now();
      },
      afterStep: (meta) => {
        const dur = Date.now() - timings[meta.label!]!;
        console.log(`  ${ts()}  [${meta.label}] finished in ${dur} ms`);
      },
    },
    ["llm:summarise", "llm:sentiment"], // filter — only these labels
  );

  flow
    .startWith(
      async (s) => {
        // Fast prep — no timing hook fires here
        s.keywords = s.input.split(" ").slice(0, 5);
      },
      { label: "prep" },
    )
    .then(
      async (s) => {
        s.summary = await fakeLlm(`Summarise: ${s.input}`);
      },
      { label: "llm:summarise" },
    )
    .then(
      async (s) => {
        s.sentiment = await fakeLlm(`Sentiment of: ${s.summary}`);
      },
      { label: "llm:sentiment" },
    );

  await flow.run({ input: "The quick brown fox jumps over the lazy dog" });
  console.log("\n  Timings only recorded for labelled LLM steps ✓");
  console.log("  'prep' step was silently excluded by the filter ✓");
}

console.log("\n✅  All patterns complete.\n");
