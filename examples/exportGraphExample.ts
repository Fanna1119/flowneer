// ---------------------------------------------------------------------------
// exportGraphExample — visualise flow structure with withExportGraph &
//                      withExportFlow
// ---------------------------------------------------------------------------
//
// Demonstrates two complementary export plugins:
//
//   withExportGraph  — serialises a graph-based flow (addNode / addEdge)
//                      into a JSON structure of nodes + edges.
//
//   withExportFlow   — serialises any FlowBuilder (sequential or graph) into
//                      a richer JSON structure with a `flow` section and an
//                      optional `graph` section.
//
// Run with: bun run examples/exportGraphExample.ts
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../Flowneer";
import { withGraph } from "../plugins/graph";
import { withExportGraph } from "../plugins/graph/withExportGraph";
import { withExportFlow } from "../plugins/graph/withExportFlow";

// Register plugins once — order matters.
// withExportFlow overrides `exportGraph` and must be loaded last.
FlowBuilder.use(withGraph);
FlowBuilder.use(withExportGraph);
FlowBuilder.use(withExportFlow);

// ─────────────────────────────────────────────────────────────────────────────
// Shared state type
// ─────────────────────────────────────────────────────────────────────────────

interface PipelineState {
  rawData?: string[];
  cleaned?: string[];
  enriched?: string[];
  validated?: boolean;
  report?: string;
  needsRetry?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step functions
// ─────────────────────────────────────────────────────────────────────────────

async function fetchData(state: PipelineState) {
  console.log("  [fetchData] fetching...");
  state.rawData = ["record_1", "record_2", "record_3"];
}

async function cleanData(state: PipelineState) {
  console.log("  [cleanData] cleaning...");
  state.cleaned = state.rawData?.map((r) => r.trim()) ?? [];
}

async function enrichData(state: PipelineState) {
  console.log("  [enrichData] enriching...");
  state.enriched = state.cleaned?.map((r) => `${r}_enriched`) ?? [];
}

async function validateData(state: PipelineState) {
  console.log("  [validateData] validating...");
  state.validated = (state.enriched?.length ?? 0) > 0;
  // Force a retry on the first pass to demonstrate the conditional back-edge
  state.needsRetry = !state.needsRetry; // flips false → true → false
}

async function generateReport(state: PipelineState) {
  console.log("  [generateReport] building report...");
  state.report = `Processed ${state.enriched?.length ?? 0} records.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Example 1 — withExportGraph
// Inspect a graph-based flow *before* compiling it.
// ─────────────────────────────────────────────────────────────────────────────

console.log("=".repeat(60));
console.log("Example 1 — withExportGraph (graph-only export)");
console.log("=".repeat(60));

const graphFlow = new FlowBuilder<PipelineState>()
  .addNode("fetch", fetchData)
  .addNode("clean", cleanData)
  .addNode("enrich", enrichData, { retries: 2 })
  .addNode("validate", validateData)
  .addNode("report", generateReport)
  // Linear happy path
  .addEdge("fetch", "clean")
  .addEdge("clean", "enrich")
  .addEdge("enrich", "validate")
  // Conditional back-edge: retry enrichment when validation fails
  .addEdge("validate", "enrich", (s) => s.needsRetry === true)
  .addEdge("validate", "report");

// Export before compile — non-destructive, compile() can still follow
const graphExport = graphFlow.exportGraph("json");

console.log("\nGraph nodes:");
for (const node of graphExport.graph!.nodes) {
  const opts = node.options ? ` (retries=${node.options.retries ?? "-"})` : "";
  console.log(`  • ${node.name}${opts}`);
}

console.log("\nGraph edges:");
for (const edge of graphExport.graph!.edges) {
  const cond = edge.conditional ? " [conditional]" : "";
  console.log(`  ${edge.from} → ${edge.to}${cond}`);
}

// Now compile and run
console.log("\nRunning compiled graph flow...");
await graphFlow.compile().run({});
console.log("Done.\n");

// ─────────────────────────────────────────────────────────────────────────────
// Example 2 — withExportFlow on a sequential flow
// Visualise a conventional .then() chain.
// ─────────────────────────────────────────────────────────────────────────────

console.log("=".repeat(60));
console.log("Example 2 — withExportFlow (sequential flow)");
console.log("=".repeat(60));

function routeByStatus(state: PipelineState) {
  return state.validated ? "ok" : "fail";
}
function handleOk(state: PipelineState) {
  state.report = "✓ All records valid.";
}
function handleFail(state: PipelineState) {
  state.report = "✗ Validation failed.";
}

const seqFlow = new FlowBuilder<PipelineState>()
  .then(fetchData)
  .then(cleanData)
  .then(enrichData, { retries: 2, timeoutMs: 5000 })
  .branch(routeByStatus, { ok: handleOk, fail: handleFail });

const seqExport = seqFlow.exportGraph();

console.log("\nFlow section — nodes:");
for (const node of seqExport.flow.nodes) {
  const opts = node.options
    ? ` (${Object.entries(node.options)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")})`
    : "";
  const meta =
    node.meta && node.type === "branch"
      ? ` branches=[${(node.meta.branches as string[]).join(", ")}]`
      : "";
  console.log(
    `  [${node.type.padEnd(8)}] ${node.id}  label="${node.label}"${opts}${meta}`,
  );
}

console.log("\nFlow section — edges:");
for (const edge of seqExport.flow.edges) {
  const label = edge.label ? ` (${edge.label})` : "";
  console.log(`  ${edge.from} --[${edge.kind}]--> ${edge.to}${label}`);
}

console.log("\nRunning sequential flow...");
await seqFlow.run({ validated: true });
console.log("Done.\n");

// ─────────────────────────────────────────────────────────────────────────────
// Example 3 — withExportFlow on a graph flow (unified export)
// Both `flow` and `graph` sections are present.
// ─────────────────────────────────────────────────────────────────────────────

console.log("=".repeat(60));
console.log("Example 3 — withExportFlow with graph store (unified export)");
console.log("=".repeat(60));

const unifiedFlow = new FlowBuilder<PipelineState>()
  .addNode("fetch", fetchData)
  .addNode("clean", cleanData)
  .addNode("enrich", enrichData, { retries: 3 })
  .addNode("report", generateReport)
  .addEdge("fetch", "clean")
  .addEdge("clean", "enrich")
  .addEdge("enrich", "report");

const unifiedExport = unifiedFlow.exportGraph();

console.log(`\nformat: ${unifiedExport.format}`);
console.log(`flow nodes:  ${unifiedExport.flow.nodes.length}`);
console.log(`flow edges:  ${unifiedExport.flow.edges.length}`);
console.log(`graph nodes: ${unifiedExport.graph?.nodes.length ?? "n/a"}`);
console.log(`graph edges: ${unifiedExport.graph?.edges.length ?? "n/a"}`);

console.log("\nFull unified export (JSON):");
console.log(JSON.stringify(unifiedExport, null, 2));
