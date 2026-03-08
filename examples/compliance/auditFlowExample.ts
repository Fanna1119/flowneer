// ---------------------------------------------------------------------------
// Flowneer — withAuditFlow example
// ---------------------------------------------------------------------------
// Demonstrates static taint analysis: prove before a flow ever runs that no
// PII-bearing step can feed a step that sends data to an external endpoint.
//
// Three scenarios are shown:
//
//   1. PASS  — sink appears before the source (no taint path exists)
//   2. FAIL  — source appears before sink (violation detected)
//   3. PASS  — predicate-based rule, flow never touches the matched steps
//
// No API key required — no LLM calls are made.
// Run with: bun run examples/auditFlowExample.ts
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import { withAuditFlow } from "../../plugins/compliance";
import type { TaintRule } from "../../plugins/compliance";

FlowBuilder.use(withAuditFlow);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function separator(title: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(` ${title}`);
  console.log("─".repeat(60));
}

function printReport(report: ReturnType<any>, label: string) {
  console.log(`\n[${label}] passed: ${report.passed}`);
  if (report.violations.length > 0) {
    for (const v of report.violations) {
      console.log(`  ✗ VIOLATION: ${v.rule.message ?? "taint rule"}`);
      console.log(`    source → step ${v.source.index} (${v.source.label})`);
      console.log(`    sink   → step ${v.sink.index}   (${v.sink.label})`);
    }
  } else {
    console.log("  ✓ No violations.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared rule: PII sources must never precede external sinks
// ─────────────────────────────────────────────────────────────────────────────

const PII_RULE: TaintRule = {
  source: ["pii:*"],
  sink: ["external:*"],
  message: "PII data must not reach external endpoints",
};

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1: PASS — sink comes before source (no data flow from PII to external)
// ─────────────────────────────────────────────────────────────────────────────

separator("Scenario 1 — PASS: external step precedes PII fetch");

const safeFlow = new FlowBuilder<any>()
  .then(async () => {}, { label: "external:log-request" }) // sink first
  .then(
    async (s) => {
      s.email = "alice@example.com";
    },
    { label: "pii:fetchUser" },
  )
  .then(async () => {}, { label: "transform:anonymize" });

const report1 = (safeFlow as any).auditFlow([PII_RULE]);
printReport(report1, "safeFlow");

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2: FAIL — PII fetch precedes external send
// ─────────────────────────────────────────────────────────────────────────────

separator("Scenario 2 — FAIL: PII data flows to external endpoint");

const leakyFlow = new FlowBuilder<any>()
  .then(
    async (s) => {
      s.user = { email: "bob@example.com", ssn: "123-45-6789" };
    },
    {
      label: "pii:fetchUser",
    },
  )
  .then(async (s) => {
    s.enriched = true;
  }) // unlabelled step
  .then(
    async () => {
      /* calls /api/third-party */
    },
    {
      label: "external:sendToAnalytics",
    },
  );

const report2 = (leakyFlow as any).auditFlow([PII_RULE]);
printReport(report2, "leakyFlow");

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3: predicate-based rule — only trigger for billing-related steps
// ─────────────────────────────────────────────────────────────────────────────

separator("Scenario 3 — predicate rule: billing PII must not reach audit logs");

const BILLING_RULE: TaintRule = {
  source: (meta) => meta.label?.startsWith("billing:pii:") ?? false,
  sink: (meta) => meta.label?.startsWith("audit:external:") ?? false,
  message: "Billing PII must not appear in external audit logs",
};

const billingFlow = new FlowBuilder<any>()
  .then(
    async (s) => {
      s.card = "4111-1111-1111-1111";
    },
    {
      label: "billing:pii:fetchCard",
    },
  )
  .then(async () => {}, { label: "billing:charge" })
  .then(async () => {}, { label: "audit:external:sendLog" });

const report3 = (billingFlow as any).auditFlow([BILLING_RULE]);
printReport(report3, "billingFlow");

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

separator("Summary");
console.log(`  safeFlow    : ${report1.passed ? "PASS ✓" : "FAIL ✗"}`);
console.log(
  `  leakyFlow   : ${report2.passed ? "PASS ✓" : "FAIL ✗"} (expected FAIL)`,
);
console.log(`  billingFlow : ${report3.passed ? "PASS ✓" : "FAIL ✗"}`);
console.log();
