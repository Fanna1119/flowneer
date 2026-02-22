// ---------------------------------------------------------------------------
// Token budget flow — withTokenBudget + withCostTracker demo
// ---------------------------------------------------------------------------
// Runs a three-step document-analysis pipeline and enforces a hard token
// ceiling.  After each LLM call the step writes:
//   shared.tokensUsed   — cumulative total tokens so far
//   shared.__stepCost   — cost of this step (USD); withCostTracker folds it
//                         into shared.__cost and clears the field
//
// Run with: bun run examples/tokenBudgetFlow.ts
//
// Pricing used (o4-mini, as of Feb 2026):
//   Input  — $1.10 / 1M tokens  ($0.0000011 / token)
//   Output — $4.40 / 1M tokens  ($0.0000044 / token)

import { FlowBuilder } from "../Flowneer";
import { llmPlugin } from "../plugins/llm";
import { callLlmWithUsage } from "../utils/callLlm";

FlowBuilder.use(llmPlugin);

// ── Pricing constants ────────────────────────────────────────────────────────

const PRICE_INPUT_PER_TOKEN = 1.1 / 1_000_000; // $0.0000011
const PRICE_OUTPUT_PER_TOKEN = 4.4 / 1_000_000; // $0.0000044

function stepCost(usage: {
  inputTokens: number;
  outputTokens: number;
}): number {
  return (
    usage.inputTokens * PRICE_INPUT_PER_TOKEN +
    usage.outputTokens * PRICE_OUTPUT_PER_TOKEN
  );
}

// ── Shared state ─────────────────────────────────────────────────────────────

interface DocState {
  document: string;
  summary?: string;
  keyPoints?: string[];
  title?: string;
  // Managed by plugins
  tokensUsed: number;
  __stepCost?: number;
  __cost?: number;
}

// ── Flow ─────────────────────────────────────────────────────────────────────

const TOKEN_BUDGET = 5_000; // abort if we hit this before a step

const flow = new FlowBuilder<DocState>()
  .withTokenBudget(TOKEN_BUDGET)
  .withCostTracker()

  // ── Step 0: summarise ────────────────────────────────────────────────────
  .startWith(async (s) => {
    console.log("▶  Step 0 — summarise");
    const { text, usage } = await callLlmWithUsage(
      `Summarise the following document in two or three sentences.\n\n${s.document}`,
    );
    s.summary = text;
    s.tokensUsed += usage.totalTokens;
    s.__stepCost = stepCost(usage);
    console.log(
      `   tokens this step: ${usage.totalTokens}  (in: ${usage.inputTokens}, out: ${usage.outputTokens})`,
    );
  })

  // ── Step 1: extract key points ───────────────────────────────────────────
  .then(async (s) => {
    console.log("▶  Step 1 — extract key points");
    const { text, usage } = await callLlmWithUsage(
      `Extract up to five bullet-point key takeaways from this summary:\n\n${s.summary}`,
    );
    s.keyPoints = text
      .split(/\n+/)
      .map((l) => l.replace(/^[-•*]\s*/, "").trim())
      .filter(Boolean);
    s.tokensUsed += usage.totalTokens;
    s.__stepCost = stepCost(usage);
    console.log(
      `   tokens this step: ${usage.totalTokens}  (in: ${usage.inputTokens}, out: ${usage.outputTokens})`,
    );
  })

  // ── Step 2: generate a title ─────────────────────────────────────────────
  .then(async (s) => {
    console.log("▶  Step 2 — generate title");
    const { text, usage } = await callLlmWithUsage(
      `Write a concise, engaging title (max 10 words) for a document with these key points:\n${s.keyPoints?.map((p) => `- ${p}`).join("\n")}`,
    );
    s.title = text.trim().replace(/^["']|["']$/g, "");
    s.tokensUsed += usage.totalTokens;
    s.__stepCost = stepCost(usage);
    console.log(
      `   tokens this step: ${usage.totalTokens}  (in: ${usage.inputTokens}, out: ${usage.outputTokens})`,
    );
  })

  // ── Step 3: print results ────────────────────────────────────────────────
  .then(async (s) => {
    console.log("\n════════════════════════════════════════");
    console.log("Title      :", s.title);
    console.log("Summary    :", s.summary);
    console.log("Key points :");
    s.keyPoints?.forEach((p) => console.log("  •", p));
    console.log("────────────────────────────────────────");
    console.log(`Tokens used: ${s.tokensUsed} / budget ${TOKEN_BUDGET}`);
    console.log(`Total cost : $${s.__cost?.toFixed(6)} USD`);
    console.log("════════════════════════════════════════\n");
  });

// ── Sample document ───────────────────────────────────────────────────────────

const document = `
TypeScript 5.5 introduced several significant improvements. The new
"isolated declarations" feature lets you emit type declarations without
needing to run the full type checker, dramatically speeding up parallel
build pipelines. Regular expression syntax checking was added so the
compiler can catch common regex mistakes at compile time. The type
inference engine was improved to handle complex conditional types more
reliably, reducing spurious errors in library code. Source maps for
declaration files are now emitted by default, making debugging
third-party library types much easier. Finally, the Set methods proposal
(union, intersection, difference) was added to the built-in lib types.
`.trim();

// ── Run ───────────────────────────────────────────────────────────────────────

const initialState: DocState = { document, tokensUsed: 0 };

flow.run(initialState).catch((err) => {
  console.error("\n✗ Flow aborted:", err.message);
  console.log(
    `  Tokens used before abort: ${initialState.tokensUsed} / ${TOKEN_BUDGET}`,
  );
  console.log(`  Cost so far: $${(initialState.__cost ?? 0).toFixed(6)} USD`);
  process.exit(1);
});
