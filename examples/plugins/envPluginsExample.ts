// ---------------------------------------------------------------------------
// Environment-aware plugin composition — dev vs. production
// ---------------------------------------------------------------------------
//
// Shows how to assemble a different plugin set depending on NODE_ENV.
// Three environments are demonstrated in a single file by overriding
// process.env.NODE_ENV before each run:
//
//   development — withTiming + withVerbose + withCircuitBreaker + withRateLimit
//   production  — withAuditLog + withCircuitBreaker + withRateLimit
//   dry-run     — withDryRun + withTiming (step bodies skipped; hooks fire)
//
// All LLM / DB calls are mocked — no credentials required.
// Run with: bun run examples/plugins/envPluginsExample.ts
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import { withTiming } from "../../plugins/observability";
import { withVerbose } from "../../plugins/observability";
import { withDryRun } from "../../plugins/dev";
import { withAuditLog } from "../../plugins/persistence";
import { withCircuitBreaker } from "../../plugins/resilience";
import { withRateLimit } from "../../plugins/llm";
import type { FlowneerPlugin } from "../../Flowneer";
import type { AuditEntry, AuditLogStore } from "../../plugins/persistence";

// ─────────────────────────────────────────────────────────────────────────────
// Shared state
// ─────────────────────────────────────────────────────────────────────────────

interface PipelineState {
  userId: string;
  profile?: Record<string, string>;
  prompt?: string;
  response?: string;
  saved?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step functions (all mocked)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchUser(s: PipelineState) {
  console.log(`  [fetch]     loading profile for "${s.userId}"`);
  s.profile = { name: "Alice", tier: "pro" };
}

async function buildPrompt(s: PipelineState) {
  console.log("  [prompt]    assembling prompt");
  s.prompt = `Summarise account activity for ${s.profile?.name} (${s.profile?.tier}).`;
}

async function callModel(s: PipelineState) {
  console.log("  [llm]       calling model (mocked)");
  s.response = `Activity summary for ${s.profile?.name}: all metrics nominal.`;
}

async function saveResult(s: PipelineState) {
  console.log("  [save]      persisting response to DB (mocked)");
  s.saved = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory audit store (used in prod example)
// ─────────────────────────────────────────────────────────────────────────────

class MemoryAuditStore implements AuditLogStore<PipelineState> {
  readonly entries: AuditEntry<PipelineState>[] = [];
  append(entry: AuditEntry<PipelineState>) {
    this.entries.push(entry);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper — build an AppFlow class and a configured instance for a given env
// ─────────────────────────────────────────────────────────────────────────────

// Plugin sets per environment — extend this map to add new environments
const ENV_PLUGINS: Record<
  "development" | "production" | "dry-run",
  FlowneerPlugin[]
> = {
  development: [
    withRateLimit,
    withCircuitBreaker,
    withTiming, // record per-step ms in shared.__timings
    withVerbose, // dump shared state after every step
  ],
  production: [
    withRateLimit,
    withCircuitBreaker,
    withAuditLog, // immutable audit trail after each step
  ],
  "dry-run": [
    withRateLimit,
    withCircuitBreaker,
    withTiming,
    withDryRun, // must come last — wrapStep skips the body completely
  ],
};

function buildFlow(
  env: "development" | "production" | "dry-run",
  auditStore?: MemoryAuditStore,
) {
  const AppFlow = FlowBuilder.extend(ENV_PLUGINS[env]);

  // Configure middleware — options vary per environment
  const flow = new AppFlow<PipelineState>()
    .withRateLimit({ intervalMs: 50 }, ["llm:*"])
    .withCircuitBreaker({ maxFailures: 3 });

  if (env === "development") {
    flow.withTiming().withVerbose(["llm:*"]); // only log shared state after LLM steps
  }

  if (env === "production" && auditStore) {
    flow.withAuditLog(auditStore);
  }

  if (env === "dry-run") {
    flow.withTiming().withDryRun();
  }

  // Steps are identical across all environments
  flow
    .then(fetchUser, { label: "db:fetch" })
    .then(buildPrompt)
    .then(callModel, { label: "llm:call" })
    .then(saveResult, { label: "db:save" });

  return flow;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function separator(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(` ${title}`);
  console.log("=".repeat(60));
}

// ─────────────────────────────────────────────────────────────────────────────
// Run 1 — development
// ─────────────────────────────────────────────────────────────────────────────

separator("ENV: development");
console.log(
  "Plugins active: withRateLimit, withCircuitBreaker, withTiming, withVerbose\n",
);

{
  const flow = buildFlow("development");
  const shared: PipelineState = { userId: "u_001" };
  await flow.run(shared);

  const timings = (shared as any).__timings as
    | Record<number, number>
    | undefined;
  if (timings) {
    console.log("\n  Per-step timings (ms):", timings);
  }
  console.log("\n  Final state:", JSON.stringify(shared, null, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
// Run 2 — production
// ─────────────────────────────────────────────────────────────────────────────

separator("ENV: production");
console.log(
  "Plugins active: withRateLimit, withCircuitBreaker, withAuditLog\n",
);

{
  const auditStore = new MemoryAuditStore();
  const flow = buildFlow("production", auditStore);
  const shared: PipelineState = { userId: "u_002" };
  await flow.run(shared);

  console.log(`\n  Audit log — ${auditStore.entries.length} entries:`);
  for (const entry of auditStore.entries) {
    console.log(
      `    step ${entry.stepIndex} (${entry.type}) @ ${new Date(entry.timestamp).toISOString()}` +
        (entry.error ? `  ERROR: ${entry.error}` : "  OK"),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Run 3 — dry-run (CI / integration test mode)
// Step bodies are skipped entirely; withTiming hooks still fire, proving
// the observability wiring is correct without executing real logic.
// ─────────────────────────────────────────────────────────────────────────────

separator("ENV: dry-run (CI)");
console.log(
  "Plugins active: withRateLimit, withCircuitBreaker, withTiming, withDryRun\n",
);
console.log("  ↳ step bodies will be SKIPPED — only hooks fire\n");

{
  const flow = buildFlow("dry-run");
  const shared: PipelineState = { userId: "u_003" };
  await flow.run(shared);

  const timings = (shared as any).__timings as
    | Record<number, number>
    | undefined;
  console.log("\n  Timings (all near 0 ms — no real work done):", timings);
  console.log("  profile:", shared.profile ?? "(not set — body was skipped)");
  console.log("  response:", shared.response ?? "(not set — body was skipped)");
}
