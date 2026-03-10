// ---------------------------------------------------------------------------
// Flowneer — withRuntimeCompliance example
// ---------------------------------------------------------------------------
// Demonstrates runtime compliance hooks that inspect shared state immediately
// before each matching step and take action when a violation is detected.
//
// Three violation strategies are shown:
//
//   "throw"  — aborts the flow immediately with a ComplianceError
//   "warn"   — emits a warning to stderr but lets the flow continue
//   "record" — collects all violations into shared.__complianceViolations
//
// No API key required — no LLM calls are made.
// Run with: bun run examples/runtimeComplianceExample.ts
// ---------------------------------------------------------------------------

import { FlowBuilder, FlowError } from "../../Flowneer";
import {
  withRuntimeCompliance,
  ComplianceError,
  scanShared,
} from "../../plugins/compliance";
import type { RuntimeInspector } from "../../plugins/compliance";

const ComplianceFlow = FlowBuilder.extend([withRuntimeCompliance]);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function separator(title: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(` ${title}`);
  console.log("─".repeat(60));
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared inspector: detect PII before any external outbound step
// ─────────────────────────────────────────────────────────────────────────────

function makePiiInspector(
  onViolation: RuntimeInspector<any>["onViolation"],
): RuntimeInspector<any> {
  return {
    filter: ["external:*"],
    check: (shared) => {
      const hits = scanShared(shared, ["user.email", "user.phone", "user.ssn"]);
      if (hits.length === 0) return null;
      return `PII detected before external call: ${hits.map((h) => h.path).join(", ")}`;
    },
    onViolation,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: "throw" — violation aborts the flow
// ─────────────────────────────────────────────────────────────────────────────

separator('Scenario 1 — onViolation: "throw"');

{
  interface State {
    user?: { email?: string };
    sent?: boolean;
  }

  const flow = new ComplianceFlow<State>()
    .then(
      async (s) => {
        // Step that loads PII into shared state
        s.user = { email: "alice@example.com" };
      },
      { label: "db:fetchUser" },
    )
    .then(
      async (s) => {
        // This must never run when PII is present
        s.sent = true;
        console.log("  [external:send] This should NOT print.");
      },
      { label: "external:send" },
    );

  (flow as any).withRuntimeCompliance([makePiiInspector("throw")]);

  try {
    await (flow as any).run({});
  } catch (err) {
    if (err instanceof ComplianceError) {
      console.log(`  Caught ComplianceError: ${err.cause?.message}`);
      console.log("  Flow was correctly aborted before external:send.");
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: "warn" — violation is logged, flow continues
// ─────────────────────────────────────────────────────────────────────────────

separator('Scenario 2 — onViolation: "warn"');

{
  interface State {
    user?: { phone?: string };
    sent?: boolean;
  }

  const flow = new ComplianceFlow<State>()
    .then(
      async (s) => {
        s.user = { phone: "555-867-5309" };
      },
      { label: "db:fetchUser" },
    )
    .then(
      async (s) => {
        s.sent = true;
        console.log("  [external:notify] Flow continued despite PII warning.");
      },
      { label: "external:notify" },
    );

  (flow as any).withRuntimeCompliance([makePiiInspector("warn")]);

  const shared: State = {};
  await (flow as any).run(shared);
  console.log(`  sent = ${shared.sent} (flow completed after warning)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: "record" — all violations collected, flow completes
// ─────────────────────────────────────────────────────────────────────────────

separator('Scenario 3 — onViolation: "record"');

{
  interface State {
    user?: { email?: string; ssn?: string };
    items?: string[];
    processed?: boolean;
    __complianceViolations?: Array<{ message: string; meta: any }>;
  }

  // Two external steps, both flagged
  const flow = new ComplianceFlow<State>()
    .then(
      async (s) => {
        s.user = { email: "bob@corp.com", ssn: "987-65-4321" };
        s.items = ["item-a", "item-b"];
      },
      { label: "db:fetchAll" },
    )
    .then(
      async () => {
        console.log("  [external:analytics] recording violation ...");
      },
      { label: "external:analytics" },
    )
    .then(
      async (s) => {
        s.processed = true;
        console.log("  [external:audit] recording violation ...");
      },
      { label: "external:audit" },
    );

  (flow as any).withRuntimeCompliance([makePiiInspector("record")]);

  const shared: State = {};
  await (flow as any).run(shared);

  console.log(
    `\n  Violations recorded: ${shared.__complianceViolations?.length ?? 0}`,
  );
  for (const v of shared.__complianceViolations ?? []) {
    console.log(`    ✗ [step ${v.meta.index} "${v.meta.label}"] ${v.message}`);
  }
  console.log(`  Flow finished, processed = ${shared.processed}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4: no PII present — inspector passes silently
// ─────────────────────────────────────────────────────────────────────────────

separator("Scenario 4 — no PII, all steps pass cleanly");

{
  interface State {
    userId?: string; // just an opaque ID, not PII
    result?: string;
  }

  const flow = new ComplianceFlow<State>()
    .then(
      async (s) => {
        s.userId = "usr_abc123"; // no PII
      },
      { label: "db:fetchRef" },
    )
    .then(
      async (s) => {
        s.result = `processed ${s.userId}`;
      },
      { label: "external:report" },
    );

  (flow as any).withRuntimeCompliance([makePiiInspector("throw")]);

  const shared: State = {};
  await (flow as any).run(shared);
  console.log(`  result = "${shared.result}"`);
  console.log("  ✓ No compliance violations.");
}

console.log();
