// ---------------------------------------------------------------------------
// Support Ticket Triage — real-world customer support automation
// ---------------------------------------------------------------------------
// Classifies an incoming support ticket, drafts a specialist reply, then
// self-reviews it. If the review flags issues the draft is regenerated
// (up to 3 attempts via anchor).
//
// Pipeline:
//   1. classify  — label the ticket: billing | technical | general
//   2. branch    — enrich shared state with department context
//   3. anchor    — retry point for low-quality drafts
//   4. draft     — generate a reply using the department context
//   5. review    — LLM self-review; jumps back to anchor if quality is poor
//   6. output    — print the final reply
//
// Run with: bun run examples/supportTicketTriage.ts
// Requires: OPENAI_API_KEY environment variable
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../Flowneer";
import { callLlm } from "../utils/callLlm";

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

interface TicketState {
  ticket: string; // raw text submitted by the customer
  category?: "billing" | "technical" | "general";
  context?: string; // department-specific guidelines
  draft?: string; // current reply draft
  reviewNotes?: string; // feedback from the reviewer
  attempts: number; // draft attempts so far
}

// ─────────────────────────────────────────────────────────────────────────────
// Policies (normally loaded from a CMS / database)
// ─────────────────────────────────────────────────────────────────────────────

const POLICIES = {
  billing: `
- Policy B-1: Duplicate charges are refunded within 3-5 business days upon verification.
- Policy B-2: Customers may request a full refund within 30 days of purchase.
- Policy B-3: Disputed charges must be raised within 60 days of the billing date.`.trim(),

  technical: `
- Policy T-1: P1 (service down) issues are escalated to on-call engineering within 15 minutes.
- Policy T-2: Known bugs with a scheduled fix are communicated via status.example.com.
- Policy T-3: Data loss incidents are handled under the SLA with a 4-hour response SLA.`.trim(),

  general: `
- Policy G-1: Standard response time is 1 business day.
- Policy G-2: Customers can access self-service resources at help.example.com.`.trim(),
};

// ─────────────────────────────────────────────────────────────────────────────
// Flow
// ─────────────────────────────────────────────────────────────────────────────

const flow = new FlowBuilder<TicketState>()

  // 1. Classify
  .startWith(async (s) => {
    const raw = await callLlm(
      `Classify this customer support ticket into exactly one category: billing, technical, or general.
Reply with ONLY the category word, lowercase.

Ticket: "${s.ticket}"`,
    );
    s.category = raw.trim().toLowerCase() as TicketState["category"];
    console.log(`[classify] → ${s.category}`);
  })

  // 2. Route to the right department
  .branch((s) => s.category, {
    billing: (s) => {
      s.context = `You are a billing specialist. Be empathetic and cite the relevant policy where applicable.\n\nPolicies:\n${POLICIES.billing}`;
    },
    technical: (s) => {
      s.context = `You are a senior support engineer. Provide clear, step-by-step troubleshooting instructions and reference the relevant policy where applicable.\n\nPolicies:\n${POLICIES.technical}`;
    },
    default: (s) => {
      s.context = `You are a friendly support agent. Answer helpfully and briefly, referencing the relevant policy where applicable.\n\nPolicies:\n${POLICIES.general}`;
    },
  })

  // 3. Anchor — jump here to retry a draft (max 3 attempts)
  .anchor("redraft", 3)

  // 4. Draft a reply
  .then(async (s) => {
    s.attempts += 1;
    console.log(`[draft] attempt ${s.attempts}`);
    const hint = s.reviewNotes
      ? `\n\nPrevious draft was rejected with this feedback:\n${s.reviewNotes}\nPlease address all points.`
      : "";

    s.draft = await callLlm(
      `${s.context}${hint}

Write a professional, empathetic reply to the following customer ticket.
Keep it concise (3-5 sentences). Do NOT start with "Dear Customer".

Ticket: "${s.ticket}"`,
    );
  })

  // 5. Self-review — return "#redraft" if the draft needs improvement
  .then(async (s) => {
    const verdict = await callLlm(
      `You are a quality-assurance reviewer for a customer support team.
Evaluate the reply below for tone, accuracy, and actionability.
Reply with a JSON object: { "pass": true } or { "pass": false, "notes": "<brief feedback>" }

Ticket   : "${s.ticket}"
Draft    : "${s.draft}"`,
    );

    let result: { pass: boolean; notes?: string };
    try {
      result = JSON.parse(verdict.trim());
    } catch {
      result = { pass: true }; // treat parse errors as passing
    }

    if (!result.pass) {
      s.reviewNotes = result.notes;
      console.log(`[review] ✗ rejected — ${result.notes}`);
      return "#redraft";
    }

    s.reviewNotes = undefined;
    console.log(`[review] ✓ approved`);
  })

  // 6. Print results
  .then((s) => {
    console.log("\n══════════════════════════════════════════");
    console.log(`Category : ${s.category}`);
    console.log(`Attempts : ${s.attempts}`);
    console.log("── Reply ──────────────────────────────────");
    console.log(s.draft);
    console.log("══════════════════════════════════════════\n");
  });

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────

await flow.run({
  ticket:
    "Hi, I was charged twice for my subscription this month. " +
    "The duplicate charge appeared on the 3rd. Please help!",
  attempts: 0,
});
