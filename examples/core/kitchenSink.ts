// ---------------------------------------------------------------------------
// Flowneer — Kitchen Sink: AI News Desk Multi-Agent Briefing System
// ---------------------------------------------------------------------------
// Canonical end-to-end example showcasing the broader Flowneer surface:
//
//   memory     → BufferWindowMemory tracks conversation context
//   tools      → ToolRegistry with search / calculate / wiki tools
//   ReAct      → withReActLoop (think → tool-call → observation → repeat)
//   humanNode  → ergonomic human-in-the-loop gate via .humanNode()
//   supervisor → supervisorCrew runs intro/body/conclusion drafters in parallel
//   structured → withStructuredOutput validates final synthesis via Zod-like schema
//   callbacks  → withCallbacks fires LangChain-style lifecycle hooks
//   telemetry  → withTelemetry emits OTEL-style spans via consoleExporter
//   versioned  → withVersionedCheckpoint keeps git-like diff snapshots
//   parsers    → parseJsonOutput · parseListOutput · parseRegexOutput on sections
//   eval       → runEvalSuite scores final report quality
//   graph      → withGraph declares inner DAG then .compile()s it
//
// Foundational flow features retained in the example:
//   withTiming · withHistory · withInterrupts · withCircuitBreaker · withTimeout
//   withCycles · withStepLimit · withAtomicUpdates · withAuditLog
//   withTokenBudget · withCostTracker · withRateLimit
//   withChannels · withStream · withFallback
//
// Run with: bun run examples/kitchenSink.ts
// Requires: OPENAI_API_KEY environment variable
// ---------------------------------------------------------------------------

import { FlowBuilder, FlowError, InterruptError } from "../../Flowneer";

// ── Plugin imports ────────────────────────────────────────────────────────────

// Observability (v1 + new withCallbacks)
import {
  withTiming,
  withHistory,
  withInterrupts,
  withCallbacks,
} from "../../plugins/observability";
import type { CallbackHandlers } from "../../plugins/observability/withCallbacks";

// Resilience (same as v1)
import {
  withFallback,
  withCircuitBreaker,
  withTimeout,
  withCycles,
} from "../../plugins/resilience";
import type { CircuitBreakerOptions } from "../../plugins/resilience";

// Persistence (NEW: withVersionedCheckpoint replaces flat withCheckpoint)
import { withAuditLog, withVersionedCheckpoint } from "../../plugins/persistence";
import type {
  AuditEntry,
  AuditLogStore,
  VersionedCheckpointEntry,
  VersionedCheckpointStore,
} from "../../plugins/persistence";

// LLM (NEW: withStructuredOutput)
import {
  withTokenBudget,
  withCostTracker,
  withRateLimit,
  withStructuredOutput,
} from "../../plugins/llm";

// Dev
import { withStepLimit, withAtomicUpdates } from "../../plugins/dev";

// Messaging (same as v1)
import {
  withChannels,
  sendTo,
  receiveFrom,
} from "../../plugins/messaging/withChannels";
import { withStream, emit } from "../../plugins/messaging/withStream";

// NEW: Tools
import { withTools } from "../../plugins/tools";
import type { Tool, ToolCall, ToolResult } from "../../plugins/tools";

// NEW: Agent
import { withReActLoop } from "../../presets/agent";
import { withHumanNode, resumeFlow } from "../../plugins/agent";
import type { ThinkResult } from "../../presets/agent";

// NEW: Memory
import { withMemory, BufferWindowMemory, KVMemory } from "../../plugins/memory";
import type { Memory } from "../../plugins/memory";

// NEW: Output parsers
import {
  parseJsonOutput,
  parseListOutput,
  parseRegexOutput,
} from "../../plugins/output";

// NEW: Telemetry
import {
  withTelemetry,
  TelemetryDaemon,
  consoleExporter,
} from "../../plugins/telemetry";

// NEW: Graph
import { withGraph } from "../../plugins/graph";

// NEW: Eval
import {
  runEvalSuite,
  containsMatch,
  f1Score,
  answerRelevance,
} from "../../plugins/eval";
import type { EvalResult } from "../../plugins/eval";

import { callLlm, callLlmWithUsage } from "../../utils/callLlm";

// ── Register all plugins (once per process) ───────────────────────────────────

// Observability
FlowBuilder.use(withTiming);
FlowBuilder.use(withHistory);
FlowBuilder.use(withInterrupts);
FlowBuilder.use(withCallbacks); // NEW — label-aware lifecycle callbacks

// Resilience
FlowBuilder.use(withCircuitBreaker);
FlowBuilder.use(withTimeout);
FlowBuilder.use(withCycles);
FlowBuilder.use(withStepLimit);
FlowBuilder.use(withAtomicUpdates);

// Persistence
FlowBuilder.use(withVersionedCheckpoint); // NEW — diff-based versioned checkpoints
FlowBuilder.use(withAuditLog);

// LLM
FlowBuilder.use(withTokenBudget);
FlowBuilder.use(withCostTracker);
FlowBuilder.use(withRateLimit);
FlowBuilder.use(withStructuredOutput); // NEW — Zod-compatible output validator

// Messaging
FlowBuilder.use(withChannels);
FlowBuilder.use(withStream);

// Agent + Tools + Memory
FlowBuilder.use(withTools); // NEW — ToolRegistry attached to shared.__tools
FlowBuilder.use(withReActLoop); // NEW — think → tool-call → observe loop
FlowBuilder.use(withHumanNode); // NEW — ergonomic interrupt / resume
FlowBuilder.use(withMemory); // NEW — Memory attached to shared.__memory

// Telemetry
FlowBuilder.use(withTelemetry); // NEW — OTEL-style spans

// Graph
FlowBuilder.use(withGraph); // NEW — DAG composition

// Fallback (last → innermost wrapStep)
FlowBuilder.use(withFallback);

// ── Pricing ────────────────────────────────────────────────────────────────────

const PRICE_IN = 1.1 / 1_000_000;
const PRICE_OUT = 4.4 / 1_000_000;
const calcCost = (inp: number, out: number) => inp * PRICE_IN + out * PRICE_OUT;

// ── Shared state type ─────────────────────────────────────────────────────────

interface BriefingState {
  topic: string;
  // Research phase
  facts: string[];
  // Sections
  intro?: string;
  body?: string;
  conclusion?: string;
  // Structured synthesis
  briefing?: { title: string; summary: string; keyPoints: string[] };
  // Evaluation
  evalResults?: EvalResult<BriefingState>[];
  // Token tracking
  tokensUsed: number;
  // Fallback
  lastError?: string;
  // Agent internals
  __reactExhausted?: boolean;
  __toolResults?: ToolResult[];
  __humanPrompt?: string;
  __humanFeedback?: string;
  // Memory
  __memory?: Memory;
  // Structured output
  __llmOutput?: string;
  __structuredOutput?: unknown;
  __validationError?: string;
  // Plugin internals (v1 convention)
  __stepCost?: number;
  __cost?: number;
  __batchItem?: string;
  __history?: any[];
  __timings?: Record<number, number>;
  __channels?: Map<string, unknown[]>;
  __stream?: (chunk: unknown) => void;
  __fallbackError?: {
    stepIndex: number;
    stepType: string;
    message: string;
    stack?: string;
  };
}

// ── Tool definitions ─────────────────────────────────────────────────────────
// These are mock implementations — swap for real APIs in production.

const searchTool: Tool = {
  name: "search",
  description: "Search the web for recent information on a topic.",
  params: {
    query: {
      type: "string",
      description: "Search query string",
      required: true,
    },
  },
  async execute({ query }: { query: string }) {
    // Mock — real impl would call SerpAPI, Tavily, etc.
    return `[mock search results for "${query}"]: Found 3 recent articles discussing key developments.`;
  },
};

const calculatorTool: Tool = {
  name: "calculate",
  description: "Evaluate a simple mathematical expression.",
  params: {
    expression: {
      type: "string",
      description: "Math expression, e.g. '2 + 2'",
      required: true,
    },
  },
  execute({ expression }: { expression: string }) {
    try {
      // eslint-disable-next-line no-new-func
      return String(new Function(`return ${expression}`)());
    } catch {
      return "Error: could not evaluate expression";
    }
  },
};

const wikiFetchTool: Tool = {
  name: "wiki_summary",
  description: "Fetch a one-paragraph Wikipedia summary for a term.",
  params: {
    term: {
      type: "string",
      description: "Term or concept to look up",
      required: true,
    },
  },
  async execute({ term }: { term: string }) {
    return `[mock wiki summary for "${term}"]: A widely-used concept with several important dimensions.`;
  },
};

// ── Memory setup ──────────────────────────────────────────────────────────────

const conversationMemory = new BufferWindowMemory({ maxMessages: 20 });
// KVMemory for persisting named facts between steps
const kvMemory = new KVMemory();

// ── Versioned checkpoint store ────────────────────────────────────────────────
// Stores diff-based versioned checkpoints (like git commits).

const versionedStore: VersionedCheckpointStore<BriefingState> = (() => {
  const entries = new Map<string, VersionedCheckpointEntry<BriefingState>>();
  let snapshots = new Map<string, BriefingState>();
  let counter = 0;

  return {
    save(entry) {
      const id = `v${++counter}`;
      // Upgrade the entry object in place with the resolved id
      (entry as any).resolvedId = id;
      entries.set(id, entry);
      console.log(
        `  💾  [versioned checkpoint v${counter}] step ${entry.stepIndex}, diff keys: ${Object.keys(entry.diff).join(", ") || "(none)"}`,
      );
    },
    resolve(version) {
      // withVersionedCheckpoint rebuilds state from diffs internally.
      // This resolve is called by resumeFrom() — safe to throw for demo.
      throw new Error(`resolve("${version}") not implemented in mock store`);
    },
  };
})();

// ── Audit log ─────────────────────────────────────────────────────────────────

const auditLog: AuditEntry<BriefingState>[] = [];
const auditStore: AuditLogStore<BriefingState> = {
  append(entry) {
    auditLog.push(entry);
  },
};

// ── Telemetry daemon ──────────────────────────────────────────────────────────
// A single daemon is shared across the whole process. consoleExporter logs
// spans to stdout; swap for otlpExporter to push to a collector endpoint.

const telemetryDaemon = new TelemetryDaemon({
  exporter: consoleExporter,
  flushIntervalMs: 10_000, // flush every 10 s
  maxBuffer: 50,
});

// ── Callback handlers ─────────────────────────────────────────────────────────
// Label any step "llm:*", "tool:*", or "agent:*" to fire the matching handler.

const callbacks: CallbackHandlers<BriefingState> = {
  onLLMStart: (meta) =>
    console.log(`  🤖  [llm:start]  step ${meta.index} "${meta.label ?? ""}"`),
  onLLMEnd: (meta) =>
    console.log(`  🤖  [llm:end]    step ${meta.index} "${meta.label ?? ""}"`),
  onToolStart: (meta) =>
    console.log(`  🔧  [tool:start] step ${meta.index} "${meta.label ?? ""}"`),
  onToolEnd: (meta) =>
    console.log(`  🔧  [tool:end]   step ${meta.index} "${meta.label ?? ""}"`),
  onAgentAction: (meta) =>
    console.log(`  🧠  [agent:act]  step ${meta.index} "${meta.label ?? ""}"`),
  onAgentFinish: (meta) =>
    console.log(`  🧠  [agent:done] step ${meta.index} "${meta.label ?? ""}"`),
  onChainStart: (meta) => console.log(`  ⛓   [chain:start] step ${meta.index}`),
  onChainEnd: (meta) => console.log(`  ⛓   [chain:end]   step ${meta.index}`),
  onError: (meta, err) =>
    console.error(
      `  ❌  [callback:err] step ${meta.index}:`,
      (err as Error).message,
    ),
};

// ── Structured output schema ──────────────────────────────────────────────────
// A structurally Zod-compatible validator object (no Zod dependency needed).

const briefingSchema = {
  parse(value: unknown): {
    title: string;
    summary: string;
    keyPoints: string[];
  } {
    if (typeof value !== "object" || value === null)
      throw new Error("Expected an object");
    const v = value as Record<string, unknown>;
    if (typeof v.title !== "string") throw new Error("Missing title");
    if (typeof v.summary !== "string") throw new Error("Missing summary");
    if (!Array.isArray(v.keyPoints)) throw new Error("Missing keyPoints array");
    return {
      title: String(v.title),
      summary: String(v.summary),
      keyPoints: (v.keyPoints as unknown[]).map(String),
    };
  },
};

// ── Step functions ────────────────────────────────────────────────────────────

// Step 0 — initialise conversation memory and KV store
function initMemoryAndState(s: BriefingState): void {
  conversationMemory.add({
    role: "system",
    content: `You are writing a briefing on: "${s.topic}".`,
  });
  kvMemory.set("topic", s.topic);
  console.log(`  🧠  Memory initialised. Topic stored in KV: "${s.topic}"`);
}

// Step 1 — ReAct research phase
// think() is called once per iteration; it reads tool results from the
// previous round (s.__toolResults) and either fires more tool calls or
// signals FINISH.
async function researchThink(s: BriefingState): Promise<ThinkResult> {
  const priorResults = s.__toolResults ?? [];
  const context =
    priorResults.length > 0
      ? "\nPrevious tool results:\n" +
        priorResults
          .map((r) => `  [${r.name}] ${JSON.stringify(r.result)}`)
          .join("\n")
      : "";

  const memContext = conversationMemory.toContext();
  const prompt = `You are researching the topic: "${s.topic}".
${memContext}${context}

Your available tools are: search, calculate, wiki_summary.
If you have enough information to write a briefing, reply with:
  { "action": "finish" }
Otherwise reply with:
  { "action": "tool", "calls": [{ "name": "<tool>", "args": { ... } }] }

Reply with ONLY valid JSON.`;

  const raw = await callLlm(prompt);
  conversationMemory.add({ role: "assistant", content: raw });

  const parsed = parseJsonOutput<{ action: string; calls?: ToolCall[] }>(raw);

  if (parsed.action === "finish" || !parsed.calls?.length) {
    return { action: "finish" };
  }

  return { action: "tool", calls: parsed.calls };
}

// Called after each tool-execution round — append observations to memory
async function onToolObservation(
  results: ToolResult[],
  s: BriefingState,
): Promise<void> {
  for (const r of results) {
    const content = `Tool "${r.name}" returned: ${JSON.stringify(r.result ?? r.error)}`;
    conversationMemory.add({ role: "tool", content });
    s.facts.push(content);
  }
  console.log(
    `  🔍  Observation round: ${results.length} tool result(s) recorded`,
  );
}

// Step 2 — pull facts gathered by the ReAct loop into structured list
function consolidateFacts(s: BriefingState): void {
  // parseListOutput strips numbering / bullets from a text block
  const rawFacts = s.facts.join("\n");
  const cleaned = parseListOutput(rawFacts);
  s.facts = cleaned.length > 0 ? cleaned : s.facts;
  kvMemory.set("facts", JSON.stringify(s.facts));
  console.log(`  📋  ${s.facts.length} facts consolidated`);
}

// ── Inner section graph ───────────────────────────────────────────────────────
// Declare the intro/body/conclusion workflow as a DAG and compile it.
// In a real system this section graph could be shared / reused.

async function draftIntro(s: BriefingState): Promise<void> {
  console.log("    ✍️  [graph] drafting intro");
  const { text, usage } = await callLlmWithUsage(
    `Write a 2-sentence introduction for a briefing titled "${s.topic}".`,
  );
  s.intro = text.trim();
  s.tokensUsed += usage.totalTokens;
  s.__stepCost = calcCost(usage.inputTokens, usage.outputTokens);
}

async function draftBody(s: BriefingState): Promise<void> {
  console.log("    ✍️  [graph] drafting body");
  const facts = s.facts.slice(0, 5).join("\n");
  const { text, usage } = await callLlmWithUsage(
    `Write a 3-paragraph body section for a briefing on "${s.topic}".\nFacts:\n${facts}`,
  );
  s.body = text.trim();
  s.tokensUsed += usage.totalTokens;
  s.__stepCost = calcCost(usage.inputTokens, usage.outputTokens);
}

async function draftConclusion(s: BriefingState): Promise<void> {
  console.log("    ✍️  [graph] drafting conclusion");
  const { text, usage } = await callLlmWithUsage(
    `Write a 1-paragraph conclusion for a briefing on "${s.topic}".`,
  );
  s.conclusion = text.trim();
  s.tokensUsed += usage.totalTokens;
  s.__stepCost = calcCost(usage.inputTokens, usage.outputTokens);
}

// Compile graph: intro → body → conclusion (linear for simplicity;
// addEdge() supports conditional edges and back-edges for complex DAGs)
const sectionGraph = new FlowBuilder<BriefingState>()
  .addNode("intro", draftIntro)
  .addNode("body", draftBody)
  .addNode("conclusion", draftConclusion)
  .addEdge("intro", "body")
  .addEdge("body", "conclusion")
  .compile();

// Step 3 — run the compiled section graph as a sub-flow
async function runSectionGraph(s: BriefingState): Promise<void> {
  console.log("  📐  Running compiled section graph …");
  await sectionGraph.run(s);
}

// parallelAtomic fns for quality-check pass (same pattern as v1)
async function checkIntroQuality(s: BriefingState): Promise<void> {
  const { text, usage } = await callLlmWithUsage(
    `Rate this intro from 0.0–1.0 (number only):\n${s.intro}`,
  );
  const score = parseFloat(text);
  console.log(
    `    ⬡  [parallel] intro quality: ${isNaN(score) ? "?" : score.toFixed(2)}`,
  );
  s.tokensUsed += usage.totalTokens;
  s.__stepCost = calcCost(usage.inputTokens, usage.outputTokens);
}

async function checkBodyQuality(s: BriefingState): Promise<void> {
  const { text, usage } = await callLlmWithUsage(
    `Rate this body from 0.0–1.0 (number only):\n${s.body}`,
  );
  const score = parseFloat(text);
  console.log(
    `    ⬡  [parallel] body quality:  ${isNaN(score) ? "?" : score.toFixed(2)}`,
  );
  s.tokensUsed += usage.totalTokens;
  s.__stepCost = calcCost(usage.inputTokens, usage.outputTokens);
}

async function checkConclusionQuality(s: BriefingState): Promise<void> {
  const { text, usage } = await callLlmWithUsage(
    `Rate this conclusion from 0.0–1.0 (number only):\n${s.conclusion}`,
  );
  const score = parseFloat(text);
  console.log(
    `    ⬡  [parallel] conclusion quality: ${isNaN(score) ? "?" : score.toFixed(2)}`,
  );
  s.tokensUsed += usage.totalTokens;
  s.__stepCost = calcCost(usage.inputTokens, usage.outputTokens);
}

// Step 4 — synthesise into structured JSON and write to __llmOutput
// (withStructuredOutput will validate it and write to __structuredOutput)
async function synthesizeBriefing(s: BriefingState): Promise<void> {
  console.log("  ✍️  Synthesising structured briefing …");
  const { text, usage } = await callLlmWithUsage(
    `You are finalising a briefing on "${s.topic}".

Sections:
INTRO: ${s.intro}
BODY:  ${s.body}
CONCLUSION: ${s.conclusion}

Reply ONLY with a JSON object matching this schema:
{ "title": string, "summary": string (1-2 sentences), "keyPoints": string[] (3-5 items) }`,
  );
  s.__llmOutput = text.trim(); // withStructuredOutput reads this key
  s.tokensUsed += usage.totalTokens;
  s.__stepCost = calcCost(usage.inputTokens, usage.outputTokens);
}

// Promote validated structured output into named field
function promoteStructuredOutput(s: BriefingState): void {
  if (s.__structuredOutput) {
    s.briefing = s.__structuredOutput as BriefingState["briefing"];
    console.log(`  ✅  Structured briefing validated: "${s.briefing?.title}"`);
  } else if (s.__validationError) {
    console.warn(
      `  ⚠  Structured output validation failed: ${s.__validationError}`,
    );
  }
}

// Step 8 — parseRegexOutput demo: extract a score pattern from a key point
// (real-world use: pull version numbers, dates, percentages from LLM text)
function parseKeyPointsDemo(s: BriefingState): void {
  if (!s.briefing?.keyPoints.length) return;
  // Try to extract a "N%" or "N/M" pattern from the first key point
  const first = s.briefing.keyPoints[0] ?? "";
  const match = parseRegexOutput(
    first,
    /(?<numerator>\d+)\s*[%\/]\s*(?<denominator>\d+)?/,
  );
  if (match) {
    console.log(
      `  🔎  Regex match in first key point: ${JSON.stringify(match)}`,
    );
  } else {
    console.log(`  🔎  No numeric pattern found in: "${first.slice(0, 60)}"`);
  }
}

// Eval flow — a tiny FlowBuilder used as the "system under test" by runEvalSuite.
// It simply copies `shared.output` through, letting scoreFns read the final state.
interface EvalItem {
  topic: string;
  output: string;
  keyPoints: string[];
}

const evalFlow = new FlowBuilder<EvalItem>().startWith((_s) => {
  // No-op: the flow just runs once so scoreFns can inspect the final state.
});

// Step 6 — run eval suite against the final briefing (post-flow quality gate)
async function runEvaluation(s: BriefingState): Promise<void> {
  if (!s.briefing) return;
  console.log("  📊  Running eval suite …");

  const keyword = s.topic.split(" ")[0] ?? "quantum";

  // Build a one-item dataset from the finished briefing
  const dataset: EvalItem[] = [
    {
      topic: s.topic,
      output: s.briefing.summary,
      keyPoints: s.briefing.keyPoints,
    },
  ];

  const { results, summary } = await runEvalSuite<EvalItem>(dataset, evalFlow, {
    // Each ScoreFn<EvalItem> receives the final EvalItem shared state
    containsTopic: (item: EvalItem) => containsMatch(item.output, keyword),
    f1Quality: (item: EvalItem) => f1Score(item.output, item.topic),
    relevance: (item: EvalItem) =>
      answerRelevance(item.output, item.topic.split(" ").slice(0, 3)),
  });

  s.evalResults = results as unknown as EvalResult<BriefingState>[];
  console.log(
    `  📈  Eval complete — avg scores: ${Object.entries(summary.averages)
      .map(([k, v]) => `${k}=${v.toFixed(2)}`)
      .join(" | ")}`,
  );
}

// Step 7 — publish via channel + stream
function publishBriefing(s: BriefingState): void {
  sendTo(s, "briefings", s.briefing);
  const published = receiveFrom<BriefingState["briefing"]>(s, "briefings");
  const b = published[0];
  if (!b) return;

  emit(s, { type: "briefing", title: b.title, summary: b.summary });

  console.log("\n" + "═".repeat(70));
  console.log(`📰  FINAL BRIEFING — "${b.title}"`);
  console.log("═".repeat(70));
  console.log(`SUMMARY: ${b.summary}`);
  console.log("\nKEY POINTS:");
  b.keyPoints.forEach((kp, i) => console.log(`  ${i + 1}. ${kp}`));
  console.log("═".repeat(70) + "\n");
}

// Fallback handler
function gracefulFallback(s: BriefingState): void {
  const fe = s.__fallbackError;
  s.lastError = fe
    ? `Step ${fe.stepIndex} (${fe.stepType}) failed: ${fe.message}`
    : "A step failed — flow degraded gracefully.";
  console.error("  ⚠  Fallback triggered:", s.lastError);
}

// ── Budget ────────────────────────────────────────────────────────────────────

const TOKEN_BUDGET = 60_000;

// ── Main flow definition ──────────────────────────────────────────────────────

const flow = new FlowBuilder<BriefingState>()

  // ── Resilience ────────────────────────────────────────────────────────────
  .withCircuitBreaker({
    maxFailures: 3,
    resetMs: 15_000,
  } satisfies CircuitBreakerOptions)
  .withTimeout(90_000) // 90s wall-clock cap per step
  .withCycles(50) // max anchor-jumps
  .withStepLimit(300) // max step executions

  // ── Persistence ───────────────────────────────────────────────────────────
  // NEW: diff-based versioned checkpoints (git-like branching)
  .withVersionedCheckpoint(versionedStore)
  .withAuditLog(auditStore)

  // ── LLM ───────────────────────────────────────────────────────────────────
  .withTokenBudget(TOKEN_BUDGET)
  .withCostTracker()
  .withRateLimit({ intervalMs: 200 })
  // NEW: validate structured synthesis output via briefingSchema
  .withStructuredOutput(briefingSchema, {
    outputKey: "__llmOutput",
    retries: 2,
  })

  // ── Observability ─────────────────────────────────────────────────────────
  .withHistory()
  .withTiming()
  // NEW: label-aware lifecycle callbacks (fires on llm:* / tool:* / agent:* labels)
  .withCallbacks(callbacks)
  // NEW: OTEL-style spans via shared TelemetryDaemon
  .withTelemetry({ daemon: telemetryDaemon })

  // ── Messaging ─────────────────────────────────────────────────────────────
  .withChannels()
  .withStream((chunk) => {
    const c = chunk as { type: string; title?: string; summary?: string };
    if (c.type === "briefing") {
      console.log(
        `  📡  [stream] briefing: "${c.title}" — ${String(c.summary).slice(0, 60)}…`,
      );
    }
  })

  // ── Memory ────────────────────────────────────────────────────────────────
  // NEW: attach BufferWindowMemory — available as shared.__memory in steps
  .withMemory(conversationMemory)

  // ── Tools ─────────────────────────────────────────────────────────────────
  // NEW: register ToolRegistry — shared.__tools used by withReActLoop
  .withTools([searchTool, calculatorTool, wikiFetchTool])

  // ── Error recovery ────────────────────────────────────────────────────────
  .withFallback(gracefulFallback)

  // ────────────────────────────────────────────────────────────────────────────
  // Steps
  // ────────────────────────────────────────────────────────────────────────────

  // Step 0 — init memory
  .startWith(initMemoryAndState)

  // Step 1 — ReAct research loop (agent:* label fires onAgentAction/Finish)
  // NEW: .withReActLoop() replaces manual while-loops like clawneer.ts
  .withReActLoop({
    think: researchThink,
    maxIterations: 4,
    onObservation: onToolObservation,
  })

  // Step 2 — consolidate facts gathered by the agent
  .then(consolidateFacts)

  // Step 3 — human gate: only fires if no facts were gathered
  //   - NEW: .humanNode() replaces raw .interruptIf() + manual savedShared handling
  //   - resumeFlow() is called by the catch block below when human provides feedback
  .humanNode({
    condition: (s) => s.facts.length === 0,
    prompt: "No facts gathered. Please provide seed context for the briefing:",
  })

  // Step 4 — run compiled section graph (intro → body → conclusion)
  .then(runSectionGraph)

  // Step 5 — parallel quality check; each fn gets an isolated draft copy
  .parallelAtomic(
    [checkIntroQuality, checkBodyQuality, checkConclusionQuality],
    (_shared, _drafts) => {
      // quality scores are logged inline; no merge needed here
    },
  )

  // Step 6 — synthesise structured briefing; withStructuredOutput validates
  //   shared.__llmOutput and writes result to shared.__structuredOutput
  .then(synthesizeBriefing, { retries: 2, delaySec: 1 })

  // Step 7 — promote __structuredOutput → s.briefing
  .then(promoteStructuredOutput)

  // Step 8 — regex parser demo (named entity extraction from key points)
  .then(parseKeyPointsDemo)

  // Step 9 — eval suite
  .then(runEvaluation)

  // Step 10 — publish via channels + stream
  .then(publishBriefing);

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const shared: BriefingState = {
    topic: "large-scale quantum error correction breakthroughs 2025",
    facts: [],
    tokensUsed: 0,
  };

  const ac = new AbortController();
  const abortTimer = setTimeout(() => ac.abort(), 8 * 60 * 1_000); // 8 min

  console.log(
    "┌─────────────────────────────────────────────────────────────────┐",
  );
  console.log(
    "│  Flowneer — Kitchen-Sink v2: Multi-Agent Tech Briefing System   │",
  );
  console.log(
    "└─────────────────────────────────────────────────────────────────┘\n",
  );

  try {
    await flow.run(shared, {}, { signal: ac.signal });
  } catch (e) {
    if (e instanceof InterruptError) {
      // ── humanNode paused because facts were empty ──────────────────────────
      // In a real app: persist e.savedShared, send __humanPrompt to the user,
      // wait for input, then call resumeFlow() to restart from the saved step.
      console.warn("\n⏸  Flow paused at humanNode.");
      console.log(
        `   Prompt: ${(e.savedShared as BriefingState).__humanPrompt}`,
      );
      console.log("   Demo: providing mock human feedback and resuming …\n");

      // Inject human feedback into the saved snapshot
      const restored = e.savedShared as BriefingState;
      restored.__humanFeedback =
        "Focus on IBM and Google quantum milestones from 2025.";
      restored.facts = [`Human context: ${restored.__humanFeedback}`];

      // resumeFlow() skips already-completed steps and continues from the
      // interrupt point. The step index is carried in e.stepIndex.
      await resumeFlow(flow, restored, {}, (e as any).stepIndex ?? 3);
    } else if (e instanceof FlowError) {
      console.error(`\n✖  FlowError at step "${e.step}":`, e.cause);
    } else {
      throw e;
    }
  } finally {
    clearTimeout(abortTimer);
    // Flush any remaining telemetry spans
    await telemetryDaemon.stop();
  }

  // ── Post-run diagnostics ────────────────────────────────────────────────────

  console.log(
    "─── Run diagnostics ────────────────────────────────────────────────",
  );
  console.log(
    `  Tokens used  : ${shared.tokensUsed.toLocaleString()} / ${TOKEN_BUDGET.toLocaleString()}`,
  );
  console.log(`  Total cost   : $${(shared.__cost ?? 0).toFixed(6)}`);
  console.log(`  Facts gathered : ${shared.facts.length}`);
  console.log(`  Audit entries  : ${auditLog.length}`);
  console.log(`  Agent exhausted: ${shared.__reactExhausted ?? false}`);

  if (shared.__timings) {
    const totalTime = Object.values(shared.__timings).reduce(
      (s, ms) => s + ms,
      0,
    );
    console.log(`  Total time   : ${totalTime}ms`);
  }

  if (shared.__history) {
    console.log(`  History snapshots: ${shared.__history.length}`);
  }

  if (shared.evalResults?.length) {
    console.log(`  Eval results : ${shared.evalResults.length} entries`);
  }

  // Show KV memory entries
  console.log(
    `  KV fact store: topic="${kvMemory.getValue("topic")}", facts=${kvMemory.getValue("facts") !== undefined ? "stored" : "missing"}`,
  );

  if (shared.lastError) {
    console.warn(`  ⚠  Degraded run — fallback fired: ${shared.lastError}`);
  }
}

main().catch(console.error);

// ─────────────────────────────────────────────────────────────────────────────
// APPENDIX A: Resuming with withVersionedCheckpoint (git-like branching)
// ─────────────────────────────────────────────────────────────────────────────
// withVersionedCheckpoint saves a diff after each step (only changed keys).
// To resume from an earlier point and run a different "branch":
//
//   await new FlowBuilder<BriefingState>()
//     .withVersionedCheckpoint(versionedStore)
//     // … all same plugins …
//     .resumeFrom("v3", versionedStore) // resolves snapshot at step 3
//     .startWith(initMemoryAndState)
//     // … same steps …
//     .run(newShared);
//
// ─────────────────────────────────────────────────────────────────────────────
// APPENDIX B: supervisorCrew / sequentialCrew (multi-agent patterns)
// ─────────────────────────────────────────────────────────────────────────────
// Instead of manually wiring parallel steps, use factory helpers:
//
//   import { supervisorCrew, sequentialCrew } from "flowneer/plugins/agent";
//
//   // Supervisor assigns tasks; workers draft subsections in parallel
//   const crew = supervisorCrew<BriefingState>(
//     async (s) => { s.tasks = splitTopics(s.topic); },
//     [
//       async (s) => { s.intro = await draftSection("intro", s); },
//       async (s) => { s.body  = await draftSection("body",  s); },
//     ],
//     { post: async (s) => { s.briefing = merge(s); } },
//   );
//   await crew.run(shared);
//
//   // Linear pipeline — pass each step as an array
//   const pipeline = sequentialCrew<BriefingState>([
//     fetchData, analyzeData, formatData,
//   ]);
//   await pipeline.run(shared);
//
// ─────────────────────────────────────────────────────────────────────────────
// APPENDIX C: withGraph — declare a sub-pipeline as a DAG
// ─────────────────────────────────────────────────────────────────────────────
// The `sectionGraph` above is compiled from addNode/addEdge calls.
// For conditional routing add a predicate to addEdge():
//
//   .addEdge("body", "expandBody", (s) => s.qualityScore < 0.7)
//   .addEdge("body", "conclusion",  (s) => s.qualityScore >= 0.7)
//
// This compiles to a .branch() call in the underlying FlowBuilder chain.
//
// ─────────────────────────────────────────────────────────────────────────────
// APPENDIX D: runEvalSuite — offline quality assurance
// ─────────────────────────────────────────────────────────────────────────────
// Run a dataset against any scoring functions offline without modifying the
// main flow. Useful for CI:
//
//   import { runEvalSuite, f1Score, exactMatch } from "flowneer/plugins/eval";
//
//   const dataset = [
//     { input: "What is quantum computing?", expected: "quantum" },
//     { input: "Explain GPT-4 in one sentence.", expected: "language model" },
//   ];
//
//   const summary = await runEvalSuite(
//     dataset,
//     async (entry) => callLlm(entry.input),
//     { f1: f1Score, exact: exactMatch },
//   );
//   console.log(summary.averageScores); // { f1: 0.73, exact: 0.5 }
