// ---------------------------------------------------------------------------
// dagExample — Graph-based composition with the withGraph plugin
// ---------------------------------------------------------------------------
//
// Demonstrates the three fundamental DAG patterns supported by withGraph:
//
//   1. Linear pipeline      A → B → C
//      Simple topologically sorted execution. Nodes run in dependency order.
//
//   2. Conditional skip     A →(skip?)→ C, A → B → C
//      A forward conditional edge jumps past a node when its condition fires.
//      Useful for caching / early-exit without restructuring the whole graph.
//
//   3. Conditional back-edge (retry loop)   A → B →(retry?)→ A
//      A conditional edge that points backwards creates a loop. Execution
//      revisits A until the condition is false — no anchors, no goto strings.
//
// All three examples use real lifecycle hooks (withTiming) to show that
// middleware fires per-node exactly like plain .then() steps do.
//
// Run with: bun run examples/graph/dagExample.ts
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import { withGraph } from "../../plugins/graph";
import { withTiming } from "../../plugins/observability";

// ─────────────────────────────────────────────────────────────────────────────
// Builder factory — extend once, reuse
// ─────────────────────────────────────────────────────────────────────────────

const DagFlow = FlowBuilder.extend([withGraph, withTiming]);

// ─────────────────────────────────────────────────────────────────────────────
// Shared-state types
// ─────────────────────────────────────────────────────────────────────────────

interface PipelineState {
  items: string[];
  cleaned: string[];
  enriched: string[];
  report: string;
}

interface RetryState {
  attempts: number;
  maxAttempts: number;
  result: string;
}

interface SkipState {
  cached: boolean;
  data: string;
  processed: string;
  saved: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

function separator(title: string) {
  console.log();
  console.log("─".repeat(60));
  console.log(` ${title}`);
  console.log("─".repeat(60));
}

// ─────────────────────────────────────────────────────────────────────────────
// Example 1 — Linear pipeline (A → B → C)
// ─────────────────────────────────────────────────────────────────────────────

separator("1. Linear pipeline  (fetch → clean → enrich → report)");

const linearState: PipelineState = {
  items: [],
  cleaned: [],
  enriched: [],
  report: "",
};

await (new DagFlow<PipelineState>() as any)
  .withTiming()
  .addNode("fetch", (s: PipelineState) => {
    s.items = ["record_a", "record_b", "record_c"];
    console.log("  [fetch]   loaded", s.items.length, "items");
  })
  .addNode("clean", (s: PipelineState) => {
    s.cleaned = s.items.map((r) => r.trim().toUpperCase());
    console.log("  [clean]   cleaned →", s.cleaned);
  })
  .addNode("enrich", (s: PipelineState) => {
    s.enriched = s.cleaned.map((r) => `${r}_v2`);
    console.log("  [enrich]  enriched →", s.enriched);
  })
  .addNode("report", (s: PipelineState) => {
    s.report = `Processed ${s.enriched.length} records.`;
    console.log("  [report] ", s.report);
  })
  .addEdge("fetch", "clean")
  .addEdge("clean", "enrich")
  .addEdge("enrich", "report")
  .compile()
  .run(linearState);

console.log("\n  Final state:", linearState.report);

// ─────────────────────────────────────────────────────────────────────────────
// Example 2 — Conditional forward edge (cache hit skips processing)
// ─────────────────────────────────────────────────────────────────────────────

separator(
  "2. Conditional skip  (load →[cached?]→ save, load → process → save)",
);

async function runSkipExample(cached: boolean) {
  const state: SkipState = { cached, data: "", processed: "", saved: "" };

  await (new DagFlow<SkipState>() as any)
    .addNode("load", (s: SkipState) => {
      s.data = cached ? "CACHED_DATA" : "RAW_DATA";
      console.log(`  [load]    data="${s.data}", cached=${s.cached}`);
    })
    .addNode("process", (s: SkipState) => {
      s.processed = s.data + "_PROCESSED";
      console.log("  [process] processed →", s.processed);
    })
    .addNode("save", (s: SkipState) => {
      s.saved = s.processed || s.data; // use processed if available
      console.log("  [save]    saved →", s.saved);
    })
    // Unconditional forward edges define the default path
    .addEdge("load", "process")
    .addEdge("process", "save")
    // Conditional edge: skip "process" when the cache is warm
    .addEdge("load", "save", (s: SkipState) => s.cached)
    .compile()
    .run(state);

  return state;
}

console.log("\n  Cache MISS (process runs):");
const miss = await runSkipExample(false);
console.log("  saved:", miss.saved);

console.log("\n  Cache HIT (process skipped):");
const hit = await runSkipExample(true);
console.log("  saved:", hit.saved);

// ─────────────────────────────────────────────────────────────────────────────
// Example 3 — Conditional back-edge (retry loop until success)
// ─────────────────────────────────────────────────────────────────────────────

separator("3. Retry loop  (call → check →[failed?]→ call)");

const retryState: RetryState = { attempts: 0, maxAttempts: 3, result: "" };

await (new DagFlow<RetryState>() as any)
  .addNode("call", (s: RetryState) => {
    s.attempts++;
    // Simulate a flaky operation: succeeds only on the third attempt
    const ok = s.attempts >= s.maxAttempts;
    console.log(
      `  [call]  attempt ${s.attempts} → ${ok ? "SUCCESS" : "failed"}`,
    );
    if (ok) s.result = "ok";
  })
  .addNode("check", (s: RetryState) => {
    console.log(
      `  [check] result="${s.result || "none"}", retrying=${!s.result}`,
    );
  })
  // Unconditional forward edge: call → check
  .addEdge("call", "check")
  // Conditional back-edge: loop back to "call" while result is empty
  .addEdge("check", "call", (s: RetryState) => !s.result)
  .compile()
  .run(retryState);

console.log(
  "\n  Final: attempts =",
  retryState.attempts,
  "| result =",
  retryState.result,
);

// ─────────────────────────────────────────────────────────────────────────────
// Example 4 — Middleware applies per-node (hooks + labels)
// ─────────────────────────────────────────────────────────────────────────────

separator("4. Per-node middleware  (withTiming fires once per graph node)");

interface TimedState {
  log: string[];
}

const timedState: TimedState = { log: [] };

await (new DagFlow<TimedState>() as any)
  .withTiming()
  // Labels set via NodeOptions appear in hook metadata and timing output
  .addNode(
    "step-one",
    (s: TimedState) => {
      s.log.push("one");
    },
    { label: "step-one" },
  )
  .addNode(
    "step-two",
    (s: TimedState) => {
      s.log.push("two");
    },
    { label: "step-two" },
  )
  .addNode(
    "step-three",
    (s: TimedState) => {
      s.log.push("three");
    },
    { label: "step-three" },
  )
  .addEdge("step-one", "step-two")
  .addEdge("step-two", "step-three")
  .compile()
  .run(timedState);

console.log("\n  Execution order:", timedState.log);
console.log(
  "\n  (timing lines above are emitted once per node by withTiming middleware)",
);
