// ---------------------------------------------------------------------------
// Persistence plugins — withCheckpoint · resumeFrom · withAuditLog · withReplay
// ---------------------------------------------------------------------------
//
// Demonstrates all four persistence plugins using a document-processing pipeline:
//
//   withCheckpoint  — save snapshots on configurable triggers (step, error,
//                     flow:start/end, loop:iteration, anchor:hit).
//                     Supports full or diff-based versioned history.
//
//   resumeFrom      — skip already-completed steps and restore shared state
//                     from a previously saved checkpoint version.
//
//   withAuditLog    — append an immutable audit entry (including a state
//                     snapshot) for every step execution.
//
//   withReplay      — skip all steps before a given index without needing a
//                     checkpoint store; useful for dev-time fast-forwarding.
//
// Run with: bun run examples/plugins/persistenceExample.ts
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import {
  withCheckpoint,
  resumeFrom,
  withAuditLog,
  withReplay,
} from "../../plugins/persistence";
import type {
  CheckpointMeta,
  AuditEntry,
  AuditLogStore,
} from "../../plugins/persistence";

// ─────────────────────────────────────────────────────────────────────────────
// Shared state type
// ─────────────────────────────────────────────────────────────────────────────

interface DocState {
  docId: string;
  raw?: string;
  extracted?: Record<string, string>;
  valid?: boolean;
  summary?: string;
  failStep?: string; // set to a step label to simulate an error there
}

// ─────────────────────────────────────────────────────────────────────────────
// Step functions
// ─────────────────────────────────────────────────────────────────────────────

async function fetchDoc(s: DocState) {
  console.log(`  [fetch]    loading doc "${s.docId}"`);
  s.raw = `<doc id="${s.docId}">Title: Quarterly Report\nBody: Revenue up 12%.</doc>`;
}

async function extractFields(s: DocState) {
  if (s.failStep === "extract")
    throw new Error("extraction service unavailable");
  console.log("  [extract]  parsing key–value pairs");
  s.extracted = { title: "Quarterly Report", metric: "Revenue up 12%" };
}

async function validateDoc(s: DocState) {
  console.log("  [validate] checking required fields");
  s.valid = Boolean(s.extracted?.title && s.extracted?.metric);
}

async function summarizeDoc(s: DocState) {
  console.log("  [summarize] generating summary");
  s.summary = `${s.extracted?.title}: ${s.extracted?.metric}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Example 1 — withCheckpoint: basic step-by-step snapshots
// ─────────────────────────────────────────────────────────────────────────────

console.log("=".repeat(60));
console.log("Example 1 — withCheckpoint (step:after snapshots)");
console.log("=".repeat(60));

{
  const CheckpointFlow = FlowBuilder.extend([withCheckpoint]);

  const snapshots: Array<{ trigger: string; stepIndex?: number }> = [];

  await new CheckpointFlow<DocState>()
    .withCheckpoint({
      save(snapshot, meta) {
        snapshots.push({
          trigger: meta.trigger,
          stepIndex: meta.stepMeta?.index,
        });
        console.log(
          `  💾  checkpoint [${meta.trigger}] step=${meta.stepMeta?.index ?? "–"} ` +
            `summary="${(snapshot as DocState).summary ?? "(none)"}"`,
        );
      },
      on: ["flow:start", "step:after", "flow:end"],
    })
    .startWith(fetchDoc)
    .then(extractFields)
    .then(validateDoc)
    .then(summarizeDoc)
    .run({ docId: "doc-001", failStep: undefined });

  console.log(`\n  captured ${snapshots.length} checkpoints\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Example 2 — withCheckpoint: error trigger
// Checkpoint fires both after successful steps AND when a step throws.
// ─────────────────────────────────────────────────────────────────────────────

console.log("=".repeat(60));
console.log("Example 2 — withCheckpoint (error trigger)");
console.log("=".repeat(60));

{
  const CheckpointFlow = FlowBuilder.extend([withCheckpoint]);

  const log: string[] = [];

  try {
    await new CheckpointFlow<DocState>()
      .withCheckpoint({
        save(_snapshot, meta: CheckpointMeta<DocState>) {
          const label =
            meta.trigger === "error"
              ? `ERROR at step ${meta.stepMeta?.index}: ${(meta.error as Error).message}`
              : `step ${meta.stepMeta?.index} ok`;
          log.push(label);
          console.log(`  💾  ${label}`);
        },
        on: ["step:after", "error"],
      })
      .startWith(fetchDoc)
      .then(extractFields) // <-- will throw
      .then(validateDoc)
      .then(summarizeDoc)
      .run({ docId: "doc-002", failStep: "extract" });
  } catch {
    // expected — error propagates after checkpoint fires
  }

  console.log(`\n  log: ${log.join(" → ")}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Example 3 — withCheckpoint: versioned history with diff strategy
// Each checkpoint receives a version id and parent pointer.
// The 'diff' strategy stores only changed keys instead of full snapshots.
// ─────────────────────────────────────────────────────────────────────────────

console.log("=".repeat(60));
console.log("Example 3 — withCheckpoint (versioned history, diff strategy)");
console.log("=".repeat(60));

{
  const CheckpointFlow = FlowBuilder.extend([withCheckpoint]);

  interface VersionedEntry {
    version: string;
    parent: string | null | undefined;
    changedKeys: string[];
  }
  const versions: VersionedEntry[] = [];

  await new CheckpointFlow<DocState>()
    .withCheckpoint({
      save(snapshot, meta: CheckpointMeta<DocState>) {
        const changedKeys = Object.keys(snapshot as object);
        versions.push({
          version: meta.version!,
          parent: meta.parentVersion,
          changedKeys,
        });
        console.log(
          `  💾  ${meta.version} (parent: ${meta.parentVersion ?? "∅"}) ` +
            `changed: [${changedKeys.join(", ")}]`,
        );
      },
      on: ["step:after"],
      history: { strategy: "diff", maxVersions: 10 },
    })
    .startWith(fetchDoc)
    .then(extractFields)
    .then(validateDoc)
    .then(summarizeDoc)
    .run({ docId: "doc-003" });

  console.log(
    `\n  version chain: ${versions.map((v) => v.version).join(" → ")}\n`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Example 4 — withAuditLog
// Appends an immutable entry (including a full state snapshot) after every
// step execution, both successes and errors.
// ─────────────────────────────────────────────────────────────────────────────

console.log("=".repeat(60));
console.log("Example 4 — withAuditLog");
console.log("=".repeat(60));

{
  const AuditFlow = FlowBuilder.extend([withAuditLog]);

  const auditLog: AuditEntry<DocState>[] = [];
  const auditStore: AuditLogStore<DocState> = {
    append(entry) {
      auditLog.push(entry);
    },
  };

  await new AuditFlow<DocState>()
    .withAuditLog(auditStore)
    .startWith(fetchDoc)
    .then(extractFields)
    .then(validateDoc)
    .then(summarizeDoc)
    .run({ docId: "doc-004" });

  console.log("\n  Audit trail:");
  for (const entry of auditLog) {
    console.log(
      `    step ${entry.stepIndex} [${entry.type}]` +
        (entry.error ? `  ⚠  error: ${entry.error}` : "  ✓") +
        `  summary="${entry.shared.summary ?? "(none)"}"`,
    );
  }
  console.log();
}

// ─────────────────────────────────────────────────────────────────────────────
// Example 5 — resumeFrom
// Simulate saving a checkpoint at step 1, then resuming from it so that
// only steps 2+ re-execute and shared state is pre-populated.
// ─────────────────────────────────────────────────────────────────────────────

console.log("=".repeat(60));
console.log("Example 5 — resumeFrom (skip already-completed steps)");
console.log("=".repeat(60));

{
  const ResumeFlow = FlowBuilder.extend([withCheckpoint, resumeFrom]);

  // Simulate a store that holds a single saved checkpoint.
  // In production this would be a database or file system.
  const checkpointStore = {
    saved: null as null | { stepIndex: number; snapshot: DocState },
    save(snapshot: DocState, meta: CheckpointMeta<DocState>) {
      checkpointStore.saved = {
        stepIndex: meta.stepMeta?.index ?? 0,
        snapshot,
      };
    },
    resolve(_version: string) {
      if (!checkpointStore.saved) throw new Error("no checkpoint saved");
      return checkpointStore.saved;
    },
  };

  // ── Pass 1: run normally, checkpoint only after step 1 (extractFields) ──
  console.log("  Pass 1: full run — checkpoint saved after step 1 (extract)");
  await new ResumeFlow<DocState>()
    .withCheckpoint({
      save(snapshot, meta) {
        // Only persist the step-1 checkpoint so Pass 2 resumes from there.
        if (meta.stepMeta?.index === 1) {
          checkpointStore.saved = {
            stepIndex: 1,
            snapshot: snapshot as DocState,
          };
          console.log(`  💾  checkpoint saved at step 1`);
        }
      },
      on: ["step:after"],
    })
    .startWith(fetchDoc)
    .then(extractFields)
    .then(validateDoc)
    .then(summarizeDoc)
    .run({ docId: "doc-005" });

  console.log(
    `\n  saved checkpoint: stepIndex=${checkpointStore.saved?.stepIndex}`,
  );
  console.log(
    `  saved extracted: ${JSON.stringify(checkpointStore.saved?.snapshot.extracted)}\n`,
  );

  // ── Pass 2: resume from the step-1 checkpoint ─────────────────────────
  // Steps 0 (fetch) and 1 (extract) are skipped; shared state is restored.
  console.log("  Pass 2: resume from step 1 (fetch + extract are skipped)");
  await new ResumeFlow<DocState>()
    .withCheckpoint({
      save: checkpointStore.save.bind(checkpointStore),
      on: ["step:after"],
    })
    .resumeFrom("last", {
      resolve: checkpointStore.resolve.bind(checkpointStore),
    })
    .startWith(fetchDoc) // skipped (index ≤ saved stepIndex)
    .then(extractFields) // skipped
    .then(validateDoc) // re-runs from here
    .then(summarizeDoc)
    .run({ docId: "doc-005-resume" });

  console.log();
}

// ─────────────────────────────────────────────────────────────────────────────
// Example 6 — withReplay
// Skip all steps before a given index without a checkpoint store.
// Useful when you already have the restored state and just need to fast-forward.
// ─────────────────────────────────────────────────────────────────────────────

console.log("=".repeat(60));
console.log("Example 6 — withReplay (fast-forward from step index)");
console.log("=".repeat(60));

{
  const ReplayFlow = FlowBuilder.extend([withReplay]);

  // Pretend we restored state from an external store and want to re-run
  // only from step 2 (validateDoc) onward.
  const restoredState: DocState = {
    docId: "doc-006",
    raw: "<doc>…</doc>",
    extracted: { title: "Annual Report", metric: "Costs down 5%" },
  };

  console.log(
    "  Skipping steps 0 (fetch) and 1 (extract), replaying from step 2",
  );

  await new ReplayFlow<DocState>()
    .withReplay(2) // skip steps 0 and 1
    .startWith(fetchDoc) // index 0 — skipped
    .then(extractFields) // index 1 — skipped
    .then(validateDoc) // index 2 — runs
    .then(summarizeDoc) // index 3 — runs
    .run(restoredState);

  console.log(`\n  final summary: "${restoredState.summary}"\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Example 7 — two independent flows: IngestionFlow checkpoints, ReportFlow resumes
//
// Flow A (IngestionFlow) fetches and enriches a document, saving a checkpoint
// after each step.  It simulates an interruption mid-way (throws after step 1).
//
// Flow B (ReportFlow) is a completely separate flow definition.  It uses
// resumeFrom to load the last good checkpoint written by Flow A and picks up
// exactly where it left off — no duplicate work, state fully restored.
// ─────────────────────────────────────────────────────────────────────────────

console.log("=".repeat(60));
console.log("Example 7 — IngestionFlow (checkpoint) → ReportFlow (resumeFrom)");
console.log("=".repeat(60));

{
  // ── Shared checkpoint store (would be Redis / DB in production) ─────────
  interface CheckpointEntry {
    stepIndex: number;
    snapshot: DocState;
    version: string;
  }
  const store: CheckpointEntry[] = [];

  const persistenceStore = {
    save(snapshot: DocState, meta: CheckpointMeta<DocState>) {
      const entry: CheckpointEntry = {
        stepIndex: meta.stepMeta!.index,
        snapshot: structuredClone(snapshot),
        version: meta.version ?? `s${meta.stepMeta!.index}`,
      };
      store.push(entry);
      console.log(
        `  💾  [IngestionFlow] saved checkpoint ${entry.version}` +
          ` at step ${entry.stepIndex}`,
      );
    },
    resolveLatest() {
      if (store.length === 0) throw new Error("no checkpoints in store");
      return store[store.length - 1]!;
    },
  };

  // ── Flow A: IngestionFlow ────────────────────────────────────────────────
  // Runs steps 0 and 1, checkpoints both, then throws mid-run at step 2.
  // A closure flag simulates the crash so it does not pollute the saved state.
  const IngestionFlow = FlowBuilder.extend([withCheckpoint]);

  let enrichShouldFail = true; // first invocation fails; subsequent ones succeed

  async function enrichDoc(s: DocState) {
    if (enrichShouldFail) {
      enrichShouldFail = false;
      throw new Error("enrichment API timed out");
    }
    console.log("  [enrich]   adding metadata");
    s.extracted = { ...s.extracted, enriched: "true", source: "news-api" };
  }

  async function publishDoc(s: DocState) {
    console.log("  [publish]  writing to output store");
    s.summary = `[published] ${s.extracted?.title}: ${s.extracted?.metric}.`;
  }

  console.log("\n  ── Flow A: IngestionFlow (crashes at enrich) ──");
  try {
    await new IngestionFlow<DocState>()
      .withCheckpoint({
        save: persistenceStore.save.bind(persistenceStore),
        on: ["step:after"],
        history: { strategy: "full" },
      })
      .startWith(fetchDoc) // step 0 — runs, checkpointed
      .then(extractFields) // step 1 — runs, checkpointed
      .then(enrichDoc) // step 2 — throws, NOT checkpointed
      .then(publishDoc) // step 3 — never reached
      .run({ docId: "doc-007" });
  } catch (err) {
    console.log(`  ✗  IngestionFlow failed: ${(err as Error).message}`);
  }

  const latest = persistenceStore.resolveLatest();
  console.log(
    `\n  last good checkpoint: version=${latest.version}` +
      ` stepIndex=${latest.stepIndex}` +
      ` extracted=${JSON.stringify(latest.snapshot.extracted)}\n`,
  );

  console.log(latest, " latestsnapshot \n");

  // ── Flow B: ReportFlow ───────────────────────────────────────────────────
  // Completely separate flow — only needs resumeFrom.
  // No withCheckpoint here: this flow just consumes the data written by Flow A
  // and picks up exactly where it left off.
  const ReportFlow = FlowBuilder.extend([resumeFrom]);

  console.log("  ── Flow B: ReportFlow (resumes from last checkpoint) ──");
  const reportState: DocState = { docId: "doc-007" }; // snapshot applied automatically

  await new ReportFlow<DocState>()
    .resumeFrom(latest.version, {
      resolve: (_v) => persistenceStore.resolveLatest(),
    })
    .startWith(fetchDoc) // skipped — index 0 ≤ saved stepIndex 1
    .then(extractFields) // skipped — index 1 ≤ saved stepIndex 1
    .then(enrichDoc) // runs    — index 2 > saved stepIndex 1
    .then(publishDoc) // runs    — index 3 > saved stepIndex 1
    .run(reportState);

  console.log(`\n  final summary: "${reportState.summary}"\n`);
}

console.log("=".repeat(60));
console.log("All persistence examples completed.");
console.log("=".repeat(60));
