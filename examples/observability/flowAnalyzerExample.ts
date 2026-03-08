// ---------------------------------------------------------------------------
// Flowneer — Flow Analyzer example
// ---------------------------------------------------------------------------
// Demonstrates both tools provided by withFlowAnalyzer:
//
//   analyzeFlow()  — static path map: walk the step array without running
//                    anything; returns nodes, anchor names, dynamic-goto flag
//
//   withTrace()    — runtime execution trace: install beforeStep/afterStep
//                    hooks and collect per-step timing + path summary
//
// Four flows are examined:
//
//   1. Linear flow        — simple fn chain
//   2. Branching flow     — branch step with multiple arms
//   3. Loop + anchor flow — loop body and anchor name resolution
//   4. Dry-run + trace    — compose withDryRun and withTrace to map paths
//                           without executing any side effects
//
// No API key required — no LLM calls are made.
// Run with: bun run examples/flowAnalyzerExample.ts
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import { withFlowAnalyzer } from "../../plugins/dev/withFlowAnalyzer";
import { withDryRun } from "../../plugins/dev/withDryRun";
import type { PathMap, TraceReport } from "../../plugins/dev/withFlowAnalyzer";

const AnalyzerFlow = FlowBuilder.extend([withFlowAnalyzer, withDryRun]);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function separator(title: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(` ${title}`);
  console.log("─".repeat(60));
}

function printPathMap(map: PathMap, indent = "  ") {
  console.log(
    `${indent}anchors          : [${map.anchors.join(", ") || "none"}]`,
  );
  console.log(`${indent}hasDynamicGotos  : ${map.hasDynamicGotos}`);
  console.log(`${indent}nodes (${map.nodes.length}):`);
  for (const node of map.nodes) {
    const extra =
      node.type === "branch"
        ? ` { arms: [${Object.keys((node as any).branches ?? {}).join(", ")}] }`
        : node.type === "loop" || node.type === "batch"
          ? ` { bodySteps: ${(node as any).body?.length ?? 0} }`
          : node.type === "parallel"
            ? ` { lanes: ${(node as any).parallel?.length ?? 0} }`
            : "";
    console.log(
      `${indent}  [${node.type.padEnd(8)}] ${node.label ?? "(unlabelled)"}${extra}`,
    );
  }
}

function printTrace(report: TraceReport, indent = "  ") {
  console.log(`${indent}steps visited    : ${report.events.length}`);
  console.log(
    `${indent}path summary     : [${report.pathSummary.join(" → ")}]`,
  );
  console.log(
    `${indent}total duration   : ${report.totalDurationMs.toFixed(2)} ms`,
  );
  for (const event of report.events) {
    const lbl = event.label ? `"${event.label}"` : `(step ${event.index})`;
    console.log(
      `${indent}  ${lbl.padEnd(22)} ${event.durationMs.toFixed(2)} ms`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow 1: Linear chain
// ─────────────────────────────────────────────────────────────────────────────

separator("Flow 1 — linear chain (static analysis)");

const linearFlow = new AnalyzerFlow<{ count: number }>()
  .then(
    async (s) => {
      s.count = 0;
    },
    { label: "init" },
  )
  .then(
    async (s) => {
      s.count += 10;
    },
    { label: "compute" },
  )
  .then(
    async (s) => {
      s.count *= 2;
    },
    { label: "transform" },
  )
  .then(
    async (s) => {
      console.log(`  result = ${s.count}`);
    },
    { label: "output" },
  );

const map1: PathMap = (linearFlow as any).analyzeFlow();
printPathMap(map1);

separator("Flow 1 — runtime trace");

const trace1 = (linearFlow as any).withTrace();
await (linearFlow as any).run({ count: 0 });
printTrace(trace1.getTrace());
trace1.dispose();

// ─────────────────────────────────────────────────────────────────────────────
// Flow 2: Branch
// ─────────────────────────────────────────────────────────────────────────────

separator("Flow 2 — branching flow (static analysis)");

interface ClassifyState {
  input: string;
  category?: string;
  result?: string;
}

const branchFlow = new AnalyzerFlow<ClassifyState>()
  .then(
    async (s) => {
      s.input = "error: disk full";
    },
    { label: "ingest" },
  )
  .branch(
    async (s) => (s.input.startsWith("error") ? "critical" : "normal"),
    {
      critical: async function handleCritical(s) {
        s.category = "critical";
        s.result = "paged on-call";
      },
      normal: async function handleNormal(s) {
        s.category = "normal";
        s.result = "logged";
      },
    },
    { label: "classify" },
  )
  .then(
    async (s) => {
      console.log(`  → ${s.category}: ${s.result}`);
    },
    { label: "report" },
  );

const map2: PathMap = (branchFlow as any).analyzeFlow();
printPathMap(map2);

separator("Flow 2 — runtime trace");

const trace2 = (branchFlow as any).withTrace();
await (branchFlow as any).run({ input: "", count: 0 } as any);
printTrace(trace2.getTrace());
trace2.dispose();

// ─────────────────────────────────────────────────────────────────────────────
// Flow 3: Loop + anchor
// ─────────────────────────────────────────────────────────────────────────────

separator("Flow 3 — loop + anchor (static analysis)");

interface RetryState {
  attempts: number;
  done: boolean;
}

const loopFlow = new AnalyzerFlow<RetryState>()
  .then(
    async (s) => {
      s.attempts = 0;
      s.done = false;
    },
    { label: "init" },
  )
  .anchor("retry-point")
  .loop(
    async (s) => !s.done,
    (b) =>
      b.then(
        async (s) => {
          s.attempts++;
          if (s.attempts >= 3) s.done = true;
        },
        { label: "work:attempt" },
      ),
  )
  .then(
    async (s) => {
      console.log(`  done after ${s.attempts} attempts`);
    },
    {
      label: "output",
    },
  );

const map3: PathMap = (loopFlow as any).analyzeFlow();
printPathMap(map3);

separator("Flow 3 — runtime trace");

const trace3 = (loopFlow as any).withTrace();
await (loopFlow as any).run({ attempts: 0, done: false });
printTrace(trace3.getTrace());
trace3.dispose();

// ─────────────────────────────────────────────────────────────────────────────
// Flow 4: Dry-run + trace  — map execution paths without side effects
// ─────────────────────────────────────────────────────────────────────────────

separator("Flow 4 — dry-run + trace (no side effects)");

let sideEffectFired = false;

const riskyFlow = new AnalyzerFlow<any>()
  .then(
    async (s) => {
      s.prepared = true;
    },
    { label: "prepare" },
  )
  .then(
    async () => {
      sideEffectFired = true; // would send email, charge card, etc.
      console.log("  [risky] THIS SHOULD NOT PRINT with dry-run");
    },
    { label: "external:send" },
  )
  .then(async () => {}, { label: "cleanup" });

(riskyFlow as any).withDryRun();
const trace4 = (riskyFlow as any).withTrace();

await (riskyFlow as any).run({});

console.log(`  sideEffectFired = ${sideEffectFired}  (should be false)`);
printTrace(trace4.getTrace());
trace4.dispose();

// ─────────────────────────────────────────────────────────────────────────────
// Parallel flow — analyzeFlow represents each lane
// ─────────────────────────────────────────────────────────────────────────────

separator("Flow 5 — parallel lanes (static analysis)");

const parallelFlow = new AnalyzerFlow<{ a?: number; b?: number; c?: number }>()
  .then(async () => {}, { label: "start" })
  .parallel([
    async function fetchA(s) {
      s.a = 1;
    },
    async function fetchB(s) {
      s.b = 2;
    },
    async function fetchC(s) {
      s.c = 3;
    },
  ])
  .then(
    async (s) => {
      console.log(`  a=${s.a} b=${s.b} c=${s.c}`);
    },
    {
      label: "merge",
    },
  );

const map5: PathMap = (parallelFlow as any).analyzeFlow();
printPathMap(map5);

separator("Flow 5 — runtime trace");

const trace5 = (parallelFlow as any).withTrace();
await (parallelFlow as any).run({});
printTrace(trace5.getTrace());
trace5.dispose();

console.log();
