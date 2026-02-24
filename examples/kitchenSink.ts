// ---------------------------------------------------------------------------
// Flowneer — Kitchen‑Sink Example: AI Research Report Generator
// ---------------------------------------------------------------------------
// Showcases every plugin and every FlowBuilder feature in one coherent flow:
//
//   topic → validate ──(→start on blank)──┐
//         → fetch sources (web-search LLM)│
//         → branch by content type        │
//         → interrupt for human approval  │
//         → parallelAtomic analysis       │
//         → loop refinement (quality < 70%)│
//         → batch-format citations        │
//         → synthesise final report       │
//         → publish via channels          │
//
// Plugins demonstrated:
//   LLM         : withTokenBudget · withCostTracker · withRateLimit
//   Resilience  : withCircuitBreaker · withTimeout · withCycles · withStepLimit
//   Persistence : withCheckpoint · withAuditLog
//   Observability: withHistory · withTiming · withInterrupts  [withVerbose off]
//   Messaging   : withChannels  (sendTo / receiveFrom)
//   Dev         : withAtomicUpdates (parallelAtomic)
//
//   withFallback + withReplay shown in commented blocks at the bottom.
//   withDryRun  + withMocks  are test-only utilities — see test/plugins.test.ts.
//
// Run with:  bun run examples/kitchenSink.ts
// Requires:  OPENAI_API_KEY environment variable
// ---------------------------------------------------------------------------

import { FlowBuilder, FlowError, InterruptError } from "../Flowneer";

// ── Plugin imports ────────────────────────────────────────────────────────────

import {
  withTiming,
  withHistory,
  withVerbose,
  withInterrupts,
} from "../plugins/observability";
import {
  withFallback,
  withCircuitBreaker,
  withTimeout,
  withCycles,
} from "../plugins/resilience";
import type { CircuitBreakerOptions } from "../plugins/resilience";
import {
  withCheckpoint,
  withAuditLog,
  withReplay,
} from "../plugins/persistence";
import type {
  CheckpointStore,
  AuditEntry,
  AuditLogStore,
} from "../plugins/persistence";
import {
  withTokenBudget,
  withCostTracker,
  withRateLimit,
} from "../plugins/llm";
import { withStepLimit, withAtomicUpdates } from "../plugins/dev";
import {
  withChannels,
  sendTo,
  receiveFrom,
} from "../plugins/messaging/withChannels";
import { withStream, emit } from "../plugins/messaging/withStream";

import { callLlm, callLlmWithUsage } from "../utils/callLlm";

// ── Register all plugins (once per process) ───────────────────────────────────

FlowBuilder.use(withTiming);
FlowBuilder.use(withHistory);
// FlowBuilder.use(withVerbose);          // uncomment to log full shared after every step
FlowBuilder.use(withInterrupts);
FlowBuilder.use(withCircuitBreaker);
FlowBuilder.use(withTimeout);
FlowBuilder.use(withCycles);
FlowBuilder.use(withStepLimit);
FlowBuilder.use(withAtomicUpdates);
FlowBuilder.use(withCheckpoint);
FlowBuilder.use(withAuditLog);
FlowBuilder.use(withTokenBudget);
FlowBuilder.use(withCostTracker);
FlowBuilder.use(withRateLimit);
FlowBuilder.use(withChannels);
FlowBuilder.use(withStream);
FlowBuilder.use(withFallback);

// ── Pricing (o4-mini, Feb 2026) ───────────────────────────────────────────────

const PRICE_IN = 1.1 / 1_000_000; // $0.0000011 per input token
const PRICE_OUT = 4.4 / 1_000_000; // $0.0000044 per output token

function calcCost(inp: number, out: number): number {
  return inp * PRICE_IN + out * PRICE_OUT;
}

// ── Shared state type ─────────────────────────────────────────────────────────

interface ReportState {
  topic: string;
  contentType?: "technical" | "code" | "general";
  sources: string[];
  analyzed: string[];
  qualityScore: number;
  refinementRound: number;
  draft?: string;
  finalReport?: string;
  citations: string[];
  // plugin conventions
  tokensUsed: number;
  __stepCost?: number;
  __cost?: number;
  __batchItem?: string;
  __history?: any[];
  __timings?: Record<number, number>;
  __channels?: Map<string, unknown[]>;
  __stream?: (chunk: unknown) => void;
  // fallback flag
  lastError?: string;
  __fallbackError?: {
    stepIndex: number;
    stepType: string;
    message: string;
    stack?: string;
  };
}

// ── In-memory stores (replace with Redis / DB in production) ─────────────────

const savedCheckpoints: { stepIndex: number; snap: string }[] = [];
const checkpointStore: CheckpointStore<ReportState> = {
  save(stepIndex, shared) {
    savedCheckpoints.push({ stepIndex, snap: JSON.stringify(shared) });
  },
};

const auditLog: AuditEntry<ReportState>[] = [];
const auditStore: AuditLogStore<ReportState> = {
  append(entry) {
    auditLog.push(entry);
  },
};

// ── Step functions ────────────────────────────────────────────────────────────

// Step 0 — validate topic; goto "start" label if blank
function validateTopic(s: ReportState): string | void {
  const trimmed = s.topic.trim();
  if (!trimmed) {
    console.log("  ⚠  Topic is blank — jumping back to start label demo");
    // In a real REPL you'd re-prompt; here we just fix it and stop the loop.
    s.topic = "quantum computing breakthroughs 2025";
    return "→start"; // goto label — will run validateTopic again with a real topic
  }
  console.log(`  ✔  Topic: "${trimmed}"`);
}

// Step 1 — fetch sources via web-search LLM
async function fetchSources(s: ReportState): Promise<void> {
  console.log("  🌐  Fetching sources …");
  const { text, usage } = await callLlmWithUsage(
    `List 5 recent, diverse sources (title + one-sentence summary) on the topic: "${s.topic}".
     Format: numbered list, one source per line.`,
  );
  s.sources = text
    .split(/\n+/)
    .map((l) => l.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 5);
  s.tokensUsed += usage.totalTokens;
  s.__stepCost = calcCost(usage.inputTokens, usage.outputTokens);
  console.log(
    `  📚  ${s.sources.length} sources retrieved  (${usage.totalTokens} tokens)`,
  );
}

// Branch router — classify the topic into a content type
async function routeContentType(s: ReportState): Promise<string> {
  console.log("  🔀  Classifying content type …");
  const label = await callLlm(
    `Classify this topic into exactly one of: "technical", "code", "general".
     Reply with only that word. Topic: "${s.topic}"`,
  );
  s.contentType =
    (label.trim().toLowerCase() as ReportState["contentType"]) ?? "general";
  console.log(`  🏷  Content type: ${s.contentType}`);
  return s.contentType;
}

// Branch handlers — enrich sources list depending on content type
async function handleTechnical(s: ReportState): Promise<void> {
  console.log("  🔬  Technical branch: prepending arxiv note");
  s.sources.unshift(`[arXiv search for "${s.topic}" recommended]`);
}
async function handleCode(s: ReportState): Promise<void> {
  console.log("  💻  Code branch: prepending GitHub search note");
  s.sources.unshift(`[GitHub search for "${s.topic}" recommended]`);
}
async function handleGeneral(s: ReportState): Promise<void> {
  console.log("  📰  General branch: no extra enrichment");
}

// parallelAtomic fns — each runs on a draft copy of shared
async function summarizeSources(s: ReportState): Promise<void> {
  console.log("    ⬡  [parallel] summarise sources");
  const { text, usage } = await callLlmWithUsage(
    `Summarise these sources into two sentences:\n${s.sources.join("\n")}`,
  );
  s.analyzed.push(`SUMMARY: ${text.trim()}`);
  s.tokensUsed += usage.totalTokens;
  s.__stepCost = calcCost(usage.inputTokens, usage.outputTokens);
}
async function extractEntities(s: ReportState): Promise<void> {
  console.log("    ⬡  [parallel] extract key entities");
  const { text, usage } = await callLlmWithUsage(
    `Extract up to 5 key concepts or entities from: "${s.topic}". Comma-separated, no intro.`,
  );
  s.analyzed.push(`ENTITIES: ${text.trim()}`);
  s.tokensUsed += usage.totalTokens;
  s.__stepCost = calcCost(usage.inputTokens, usage.outputTokens);
}
async function scoreQuality(s: ReportState): Promise<void> {
  console.log("    ⬡  [parallel] quality-score source list");
  const { text, usage } = await callLlmWithUsage(
    `Rate the diversity and relevance of these sources from 0.0 to 1.0 (reply with a number only):\n${s.sources.join("\n")}`,
  );
  const score = parseFloat(text.trim());
  s.qualityScore = isNaN(score) ? 0.5 : Math.min(1, Math.max(0, score));
  s.tokensUsed += usage.totalTokens;
  s.__stepCost = calcCost(usage.inputTokens, usage.outputTokens);
}

// parallelAtomic reducer — merges drafts back into the canonical shared object
function mergeAnalysis(shared: ReportState, drafts: ReportState[]): void {
  // Collect analyzed items written in each draft
  for (const d of drafts) {
    for (const item of d.analyzed) {
      if (!shared.analyzed.includes(item)) shared.analyzed.push(item);
    }
  }
  // Take the highest quality score seen across drafts
  shared.qualityScore = Math.max(
    shared.qualityScore,
    ...drafts.map((d) => d.qualityScore),
  );
  // Accumulate token usage from all drafts
  shared.tokensUsed += drafts.reduce(
    (sum, d) => sum + (d.tokensUsed - shared.tokensUsed),
    0,
  );
}

// Loop body — step 1: refine the draft
async function refineDraft(s: ReportState): Promise<void> {
  s.refinementRound++;
  console.log(
    `  🔄  Refinement round ${s.refinementRound} (quality=${s.qualityScore.toFixed(2)})`,
  );
  const { text, usage } = await callLlmWithUsage(
    `You are an editor. Improve this research brief to be more precise and insightful:

${s.draft ?? s.analyzed.join("\n")}

Provide only the improved text.`,
  );
  s.draft = text.trim();
  s.tokensUsed += usage.totalTokens;
  s.__stepCost = calcCost(usage.inputTokens, usage.outputTokens);
  emit(s, { type: "draft", round: s.refinementRound, content: s.draft });
}

// Loop body — step 2: re-score quality after refinement
async function reScore(s: ReportState): Promise<void> {
  const { text, usage } = await callLlmWithUsage(
    `Rate this research brief from 0.0 to 1.0 on depth and accuracy (number only):\n\n${s.draft}`,
  );
  const score = parseFloat(text.trim());
  s.qualityScore = isNaN(score)
    ? s.qualityScore
    : Math.min(1, Math.max(0, score));
  s.tokensUsed += usage.totalTokens;
  s.__stepCost = calcCost(usage.inputTokens, usage.outputTokens);
  console.log(`  📊  New quality score: ${s.qualityScore.toFixed(2)}`);
}

// Batch processor — format a single citation entry
async function formatCitation(s: ReportState): Promise<void> {
  const raw = s.__batchItem!;
  const citation = `[${s.citations.length + 1}] ${raw}`;
  s.citations.push(citation);
}

// Final synthesis
async function synthesizeReport(s: ReportState): Promise<void> {
  console.log("  ✍️  Synthesising final report …");
  const { text, usage } = await callLlmWithUsage(
    `Write a concise research report (3-5 paragraphs) on "${s.topic}".

Analysis notes:
${s.analyzed.join("\n")}

Draft:
${s.draft ?? "(none)"}

Citations:
${s.citations.join("\n")}`,
  );
  s.finalReport = text.trim();
  s.tokensUsed += usage.totalTokens;
  s.__stepCost = calcCost(usage.inputTokens, usage.outputTokens);
  emit(s, { type: "report", content: s.finalReport });
}

// Publish — send to a channel and print summary
function publishReport(s: ReportState): void {
  sendTo(s, "reports", { topic: s.topic, report: s.finalReport });
  const published = receiveFrom<{ topic: string; report: string }>(
    s,
    "reports",
  );
  const report = published[0];
  console.log("\n" + "═".repeat(70));
  console.log(`📄  FINAL REPORT — "${report?.topic}"`);
  console.log("═".repeat(70));
  console.log(report?.report);
  console.log("═".repeat(70) + "\n");
}

// Fallback — called by withFallback when any step throws (except InterruptError;
// see note below).  Stores the error message so the run() caller can inspect it.
//
// NOTE: withFallback's wrapStep catches ALL thrown errors, including
// InterruptError.  If you need interruptIf() to propagate, either:
//   (a) register withFallback BEFORE withInterrupts so its wrapStep runs
//       outermost and can be skipped by a smarter fallback, or
//   (b) remove withFallback from flows that use interruptIf().
//   This example registers withFallback last (innermost wrapStep) so that
//   InterruptError bypasses it if the outer try/catch in run() catches first.
function gracefulFallback(s: ReportState): void {
  const fe = s.__fallbackError;
  s.lastError = fe
    ? `Step ${fe.stepIndex} (${fe.stepType}) failed: ${fe.message}`
    : `A step encountered an unrecoverable error — flow degraded gracefully.`;
  console.error("  ⚠  Fallback triggered:", s.lastError);
  if (fe?.stack) console.error(fe.stack);
}

// ── Flow definition ───────────────────────────────────────────────────────────

const TOKEN_BUDGET = 40_000; // abort if cumulative tokens would exceed this

const flow = new FlowBuilder<ReportState>()

  // ── Resilience ──────────────────────────────────────────────────────────
  .withCircuitBreaker({
    maxFailures: 3,
    resetMs: 15_000,
  } satisfies CircuitBreakerOptions)
  .withTimeout(60_000) // global 60 s wall-clock cap per step
  .withCycles(30) // max 30 label-jumps before throwing
  .withStepLimit(200) // max 200 step executions total

  // ── Persistence ─────────────────────────────────────────────────────────
  .withCheckpoint(checkpointStore) // saves state after every step
  .withAuditLog(auditStore) // appends an entry (success + error)

  // ── LLM budget / throttle ───────────────────────────────────────────────
  .withTokenBudget(TOKEN_BUDGET) // throw before step if tokensUsed >= limit
  .withCostTracker() // accumulate __stepCost → __cost each step
  .withRateLimit({ intervalMs: 300 }) // ≥300 ms between consecutive steps

  // ── Observability ───────────────────────────────────────────────────────
  .withHistory() // snapshot shared into __history after each step
  .withTiming() // record elapsed ms in __timings[stepIndex]
  // .withVerbose()                    // uncomment for full shared JSON after every step

  // ── Channels ────────────────────────────────────────────────────────────
  .withChannels() // initialise shared.__channels Map

  // ── Streaming ───────────────────────────────────────────────────────────
  .withStream((chunk) => {
    const c = chunk as { type: string; round?: number; content?: string };
    if (c.type === "draft")
      console.log(
        `  📡  [stream] draft (round ${c.round}): ${String(c.content).slice(0, 80)}…`,
      );
    else if (c.type === "report")
      console.log(
        `  📡  [stream] final report: ${String(c.content).slice(0, 80)}…`,
      );
  })

  // ── Error recovery ──────────────────────────────────────────────────────
  // withFallback is registered last so its wrapStep is innermost.
  // It catches non-interrupt errors and lets the flow finish gracefully.
  .withFallback(gracefulFallback)

  // ──────────────────────────────────────────────────────────────────────
  // Steps
  // ──────────────────────────────────────────────────────────────────────

  // Label — jump target: "→start" returned from validateTopic loops here
  .label("start")

  // Step 0 — validate; may goto "→start"
  .startWith(validateTopic)

  // Step 1 — fetch sources with retries + per-step timeout
  .then(fetchSources, { retries: 3, delaySec: 1, timeoutMs: 30_000 })

  // Step 2 — classify content type; pick a branch
  .branch(routeContentType, {
    technical: handleTechnical,
    code: handleCode,
    default: handleGeneral, // catches "general" and any unrecognised keys
  })

  // Step 3 — human-in-the-loop gate: pause if no sources found
  .interruptIf((s) => s.sources.length === 0)

  // Step 4 — concurrent analysis; each fn works on a draft to avoid races
  .parallelAtomic(
    [summarizeSources, extractEntities, scoreQuality],
    mergeAnalysis,
  )

  // Step 5 — iterative refinement loop (max 3 rounds)
  .loop(
    (s) => s.qualityScore < 0.7 && s.refinementRound < 3,
    (b) => b.then(refineDraft).then(reScore),
  )

  // Step 6 — batch: format each source into a numbered citation
  .batch(
    (s) => s.sources,
    (b) => b.then(formatCitation),
  )

  // Step 7 — synthesise the final report (retries for flaky API)
  .then(synthesizeReport, { retries: 2, delaySec: 2 })

  // Step 8 — publish through channels
  .then(publishReport);

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const shared: ReportState = {
    topic: "quantum computing breakthroughs 2025",
    sources: [],
    analyzed: [],
    qualityScore: 0,
    refinementRound: 0,
    citations: [],
    tokensUsed: 0,
  };

  // AbortController — cancel after 5 minutes in production
  const ac = new AbortController();
  const abortTimer = setTimeout(() => ac.abort(), 5 * 60 * 1_000);

  console.log(
    "┌─────────────────────────────────────────────────────────────┐",
  );
  console.log(
    "│  Flowneer — Kitchen-Sink: AI Research Report Generator      │",
  );
  console.log(
    "└─────────────────────────────────────────────────────────────┘\n",
  );

  try {
    await flow.run(shared, {}, { signal: ac.signal });
  } catch (e) {
    if (e instanceof InterruptError) {
      // ── Human-in-the-loop: flow paused ────────────────────────────────
      // `e.savedShared` is a deep clone of state at the point of interruption.
      // In a real system: persist savedShared, notify a human, then resume by
      // restoring it and calling flow.withReplay(savedStepIndex).run(restored).
      console.warn(
        "\n⏸  Flow paused — no sources found. Manual review required.",
      );
      console.log("   Saved state available in e.savedShared");
      return;
    } else if (e instanceof FlowError) {
      console.error(`\n✖  FlowError at step "${e.step}":`, e.cause);
    } else {
      throw e;
    }
  } finally {
    clearTimeout(abortTimer);
  }

  // ── Post-run diagnostics ──────────────────────────────────────────────────

  console.log(
    "─── Run diagnostics ───────────────────────────────────────────",
  );
  console.log(
    `  Tokens used  : ${shared.tokensUsed.toLocaleString()} / ${TOKEN_BUDGET.toLocaleString()}`,
  );
  console.log(`  Total cost   : $${(shared.__cost ?? 0).toFixed(6)}`);
  console.log(`  Quality score: ${shared.qualityScore.toFixed(2)}`);
  console.log(`  Refinements  : ${shared.refinementRound}`);
  console.log(`  Citations    : ${shared.citations.length}`);
  console.log(`  Checkpoints  : ${savedCheckpoints.length} saved`);
  console.log(`  Audit entries: ${auditLog.length}`);

  if (shared.__timings) {
    const entries = Object.entries(shared.__timings)
      .map(([i, ms]) => `step ${i}: ${ms}ms`)
      .join(" · ");
    console.log(`  Timings      : ${entries}`);
    const totalTime = Object.values(shared.__timings).reduce(
      (sum, ms) => sum + ms,
      0,
    );
    console.log(`  Total time   : ${totalTime}ms`);
  }

  if (shared.__history) {
    console.log(`  History snapshots: ${shared.__history.length}`);
  }

  if (shared.lastError) {
    console.warn(`  ⚠  Degraded run — fallback fired: ${shared.lastError}`);
    if (shared.__fallbackError?.stack) {
      console.warn(shared.__fallbackError.stack);
    }
  }
}

main().catch(console.error);

// ─────────────────────────────────────────────────────────────────────────────
// APPENDIX: Resuming after a crash with withReplay
// ─────────────────────────────────────────────────────────────────────────────
// If the process crashes mid-run, restore from the last checkpoint and skip
// completed steps using withReplay:
//
//   const { stepIndex, snap } = savedCheckpoints.at(-1)!;
//   const restored: ReportState = JSON.parse(snap);
//
//   await new FlowBuilder<ReportState>()
//     .withReplay(stepIndex + 1)  // skip steps 0 … stepIndex
//     // … re-attach all the same plugins …
//     .withTokenBudget(TOKEN_BUDGET)
//     .withCostTracker()
//     // … re-declare the same steps …
//     .startWith(validateTopic)
//     .then(fetchSources, { retries: 3, delaySec: 1, timeoutMs: 30_000 })
//     // …
//     .run(restored);
//
// For diff-based versioned checkpoints (git-like branching), swap
// withCheckpoint + withReplay for withVersionedCheckpoint + resumeFrom.
