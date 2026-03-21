// ---------------------------------------------------------------------------
// Flowneer — withManualStepping example
// ---------------------------------------------------------------------------
// Demonstrates manual step-by-step execution using the withManualStepping
// plugin. After calling flow.run(), the flow pauses before each matched step.
// Call flow.stepper.continue() to advance one step at a time.
//
// Three scenarios are shown:
//
//   1. Sequential flow  — plain .then() chain stepped manually
//   2. Graph flow       — withGraph DAG stepped per node
//   3. JsonFlowBuilder  — config-driven flow stepped manually
//
// No API key required — all steps are plain sync/async functions.
// Run with: bun run examples/plugins/manualSteppingExample.ts
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import { withManualStepping } from "../../plugins/persistence";
import { withGraph } from "../../plugins/graph";
import { JsonFlowBuilder } from "../../presets/config";
import type { StepMeta } from "../../Flowneer";

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

function separator(title: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(` ${title}`);
  console.log("─".repeat(60));
}

/** Drive every step automatically using the waitUntilPaused loop pattern. */
async function driveToCompletion<S>(
  stepper: {
    waitUntilPaused(): Promise<StepMeta | null>;
    continue(): Promise<void>;
  },
  onPause?: (meta: StepMeta) => void,
) {
  let meta: StepMeta | null;
  while ((meta = await stepper.waitUntilPaused()) !== null) {
    onPause?.(meta);
    await stepper.continue();
  }
}

// =============================================================================
// Scenario 1 — Sequential flow (.then() chain)
// =============================================================================
// The simplest usage: extend FlowBuilder with withManualStepping, call
// .withManualStepping() on the instance, then drive it step by step.
//
// Two driving styles are shown:
//
//   A — explicit continue() calls (useful when you want fine-grained control)
//   B — waitUntilPaused() loop  (cleanest for automated stepping)

separator("Scenario 1 — Sequential flow (two driving styles)");

{
  interface PipelineState {
    raw: string;
    normalized?: string;
    tokens?: string[];
    summary?: string;
  }

  const ManualFlow = FlowBuilder.extend([withManualStepping]);

  // ── Style A: explicit continue() calls ────────────────────────────────────

  console.log("\n  Style A — explicit continue() calls");

  const flowA = new ManualFlow<PipelineState>()
    .withManualStepping()
    .then(
      (s) => {
        s.normalized = s.raw.trim().toLowerCase();
        console.log(`    [normalize] "${s.normalized}"`);
      },
      { label: "normalize" },
    )
    .then(
      (s) => {
        s.tokens = s.normalized!.split(/\s+/);
        console.log(`    [tokenize]  ${s.tokens.length} tokens`);
      },
      { label: "tokenize" },
    )
    .then(
      (s) => {
        s.summary = s.tokens!.slice(0, 3).join(" ") + "…";
        console.log(`    [summarize] "${s.summary}"`);
      },
      { label: "summarize" },
    );

  const sharedA: PipelineState = { raw: "  Hello World from Flowneer  " };
  const doneA = flowA.run(sharedA);

  // Pause 1 — normalize
  await flowA.stepper.waitUntilPaused();
  console.log(
    `    → paused at: "${flowA.stepper.pausedAt?.label}" (status: ${flowA.stepper.status})`,
  );
  await flowA.stepper.continue();

  // Pause 2 — tokenize
  await flowA.stepper.waitUntilPaused();
  console.log(`    → paused at: "${flowA.stepper.pausedAt?.label}"`);
  await flowA.stepper.continue();

  // Pause 3 — summarize
  await flowA.stepper.waitUntilPaused();
  console.log(`    → paused at: "${flowA.stepper.pausedAt?.label}"`);
  await flowA.stepper.continue();

  await doneA;
  console.log(`    flow status: ${flowA.stepper.status}`);

  // ── Style B: waitUntilPaused() loop ───────────────────────────────────────

  console.log("\n  Style B — waitUntilPaused() loop");

  const flowB = new ManualFlow<PipelineState>()
    .withManualStepping({
      // onPause fires before the gate blocks — useful for UI/logging
      onPause: (meta, shared) => {
        console.log(
          `    → paused at: "${meta.label}" | shared keys: ${Object.keys(shared).join(", ")}`,
        );
      },
    })
    .then(
      (s) => {
        s.normalized = s.raw.trim().toLowerCase();
      },
      { label: "normalize" },
    )
    .then(
      (s) => {
        s.tokens = s.normalized!.split(/\s+/);
      },
      { label: "tokenize" },
    )
    .then(
      (s) => {
        s.summary = s.tokens!.slice(0, 3).join(" ") + "…";
      },
      { label: "summarize" },
    );

  const sharedB: PipelineState = { raw: "  Flowneer manual stepping demo  " };
  const doneB = flowB.run(sharedB);

  await driveToCompletion(flowB.stepper);

  await doneB;
  console.log(`    summary: "${sharedB.summary}"`);
  console.log(`    flow status: ${flowB.stepper.status}`);

  // ── Style C: filter — only pause on specific steps ────────────────────────

  console.log("\n  Style C — filter (only pause on 'llm:*' steps)");

  const flowC = new ManualFlow<PipelineState>()
    .withManualStepping({ filter: ["llm:*"] })
    .then(
      (s) => {
        s.normalized = s.raw.trim().toLowerCase();
      },
      { label: "normalize" },
    ) // runs freely
    .then(
      (s) => {
        s.tokens = s.normalized!.split(/\s+/);
      },
      { label: "llm:tokenize" },
    ) // pauses
    .then(
      (s) => {
        s.summary = s.tokens!.slice(0, 3).join(" ") + "…";
      },
      { label: "llm:summarize" },
    ) // pauses
    .then(
      (s) => {
        console.log(`    [persist] saving summary`);
      },
      { label: "persist" },
    ); // runs freely

  const sharedC: PipelineState = {
    raw: "  Filter demo — only llm steps pause  ",
  };
  const doneC = flowC.run(sharedC);

  await driveToCompletion(flowC.stepper, (meta) => {
    console.log(
      `    → paused at: "${meta.label}" — normalize already ran freely`,
    );
  });

  await doneC;
}

// =============================================================================
// Scenario 2 — Graph flow (withGraph DAG)
// =============================================================================
// withManualStepping composes naturally with withGraph. The dag handler fires
// hooks.wrapStep per node, so the pause gate triggers once per DAG node.

separator("Scenario 2 — Graph flow (withGraph DAG)");

{
  interface DocumentState {
    raw: string;
    chunks?: string[];
    embeddings?: number[][];
    indexed?: boolean;
    retries: number;
  }

  const GraphManualFlow = FlowBuilder.extend([withGraph, withManualStepping]);

  const flow = new GraphManualFlow<DocumentState>()
    .withManualStepping({
      onPause: (meta, shared) =>
        console.log(
          `  → paused at node: "${meta.label}" | retries so far: ${shared.retries}`,
        ),
    })
    // Nodes — execution order determined by edges
    .addNode("chunk", (s) => {
      s.chunks = s.raw.split(". ").filter(Boolean);
      console.log(`    [chunk]  ${s.chunks.length} chunks`);
    })
    .addNode("embed", (s) => {
      // Simulate occasional failure, retry via back-edge
      s.embeddings = s.chunks!.map((_, i) => [i * 0.1]);
      console.log(
        `    [embed]  ${s.embeddings.length} embeddings (attempt ${s.retries + 1})`,
      );
    })
    .addNode("index", (s) => {
      s.indexed = true;
      console.log(`    [index]  indexed = ${s.indexed}`);
    })
    // Edges — unconditional forward edges define topological order
    .addEdge("chunk", "embed")
    .addEdge("embed", "index")
    // Conditional back-edge — retry embed up to 2 times
    .addEdge("embed", "embed", (s) => {
      if (s.retries < 2 && s.embeddings!.length === 0) {
        s.retries++;
        return true;
      }
      return false;
    })
    .compile();

  const shared: DocumentState = {
    raw: "Flowneer is a flow engine. It supports plugins. Graphs work too.",
    retries: 0,
  };

  const done = flow.run(shared);
  await driveToCompletion(flow.stepper);
  await done;

  console.log(
    `\n  result: indexed=${shared.indexed}, embeddings=${shared.embeddings?.length}`,
  );
  console.log(`  flow status: ${flow.stepper.status}`);
}

// =============================================================================
// Scenario 3 — JsonFlowBuilder (config-driven flow)
// =============================================================================
// Pass your extended FlowClass as the third argument to JsonFlowBuilder.build(),
// then call .withManualStepping() on the returned instance.

separator("Scenario 3 — JsonFlowBuilder (config-driven)");

{
  interface ReportState {
    userId: string;
    user?: { name: string; tier: string };
    report?: string;
    saved?: boolean;
  }

  // Step implementations (would typically live in a shared registry module)
  const registry = {
    fetchUser: async (s: ReportState) => {
      // Simulate DB lookup
      s.user = { name: "Ada Lovelace", tier: "pro" };
      console.log(
        `    [fetchUser]  name="${s.user.name}", tier="${s.user.tier}"`,
      );
    },
    generateReport: async (s: ReportState) => {
      s.report = `Report for ${s.user!.name} (${s.user!.tier}) — generated at ${new Date().toISOString()}`;
      console.log(`    [generateReport]  ${s.report.slice(0, 50)}…`);
    },
    persistReport: async (s: ReportState) => {
      s.saved = true;
      console.log(`    [persistReport]  saved=${s.saved}`);
    },
  };

  // Flow topology stored as plain data (could come from a database or API)
  const config = {
    steps: [
      { type: "fn", fn: "fetchUser", label: "db:fetchUser" },
      { type: "fn", fn: "generateReport", label: "llm:generateReport" },
      { type: "fn", fn: "persistReport", label: "db:persistReport" },
    ],
  };

  // 1. Build using the extended FlowClass so withManualStepping is available
  const ManualJsonFlow = FlowBuilder.extend([withManualStepping]);

  const flow = JsonFlowBuilder.build<ReportState>(
    config,
    registry,
    ManualJsonFlow as any,
  ) as InstanceType<typeof ManualJsonFlow>;

  // 2. Wire up manual stepping — pause only on "llm:*" steps, run db steps freely
  flow.withManualStepping({
    filter: ["llm:*"],
    onPause: (meta) =>
      console.log(
        `  → paused at: "${meta.label}" — inspect/approve before continuing`,
      ),
  });

  const shared: ReportState = { userId: "user-42" };
  const done = flow.run(shared);

  // db:fetchUser runs freely, then we pause at llm:generateReport
  const meta = await flow.stepper.waitUntilPaused();
  console.log(`  user loaded: ${shared.user?.name}`);
  console.log(`  approving step "${meta?.label}"…`);
  await flow.stepper.continue();

  // db:persistReport runs freely — no more pauses
  await done;
  console.log(`\n  report saved: ${shared.saved}`);
  console.log(`  flow status: ${flow.stepper.status}`);
}
