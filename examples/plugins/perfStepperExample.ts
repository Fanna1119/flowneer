// ---------------------------------------------------------------------------
// Flowneer — withPerfAnalyzer + withManualStepping: interactive perf inspector
// ---------------------------------------------------------------------------
// Combines manual step-by-step execution with per-step performance profiling
// so you can pause before each step, observe the fresh perf snapshot after it
// completes, then decide when to advance to the next one.
//
// The flow simulates a realistic LLM pipeline with varying costs:
//
//   load-context   — cheap, fast
//   embed-query    — moderate heap allocation (large float array)
//   llm:generate   — CPU-intensive, large heap spike
//   parse-output   — fast parse + validate
//   save-result    — minimal overhead
//
// All steps are mock implementations — no API key required.
// Run with:  bun run examples/plugins/perfStepperExample.ts
// ---------------------------------------------------------------------------

import readline from "node:readline";
import { FlowBuilder } from "../../Flowneer";
import { withManualStepping } from "../../plugins/persistence";
import { withPerfAnalyzer } from "../../plugins/dev";
import type { StepMeta, AugmentedState } from "../../Flowneer";
import type { StepPerfStats } from "../../plugins/dev";

// ─────────────────────────────────────────────────────────────────────────────
// Shared state
// ─────────────────────────────────────────────────────────────────────────────

interface PipelineState extends AugmentedState {
  query: string;
  context?: string[];
  embedding?: number[];
  rawOutput?: string;
  parsedResult?: { answer: string; confidence: number };
  saved?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock step functions
// ─────────────────────────────────────────────────────────────────────────────

/** Simulates loading context docs from a store (fast, cheap). */
async function loadContext(s: PipelineState) {
  await sleep(20);
  s.context = [
    "Flowneer is a TypeScript flow engine.",
    "It supports plugins, graph DAGs, and streaming.",
    "Version 0.9.4 ships withPerfAnalyzer and withManualStepping.",
  ];
}

/** Simulates embedding the query — allocates a large float array. */
async function embedQuery(s: PipelineState) {
  await sleep(60);
  // Allocate a 1536-dim embedding vector (OpenAI ada-002 size) — visible in heapΔ
  s.embedding = Array.from({ length: 1536 }, () => Math.random() * 2 - 1);
}

/** Simulates an LLM call — burns CPU, does string work. */
async function callLlm(s: PipelineState) {
  await sleep(180);
  // Simulate CPU work: build a fake token stream and concatenate
  let output = "";
  for (let i = 0; i < 2000; i++) {
    output += `token_${i} `;
  }
  s.rawOutput = JSON.stringify({
    answer: `Flowneer ${output.slice(0, 40).trim()}...`,
    confidence: 0.91,
  });
}

/** Parses and validates the raw LLM output. */
async function parseOutput(s: PipelineState) {
  await sleep(10);
  if (!s.rawOutput) throw new Error("No LLM output to parse");
  const parsed = JSON.parse(s.rawOutput) as {
    answer: string;
    confidence: number;
  };
  s.parsedResult = {
    answer: parsed.answer.slice(0, 80),
    confidence: parsed.confidence,
  };
}

/** Simulates persisting the result. */
async function saveResult(s: PipelineState) {
  await sleep(15);
  s.saved = true;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";
const BLUE = "\x1b[34m";

function fmtMs(ms: number) {
  return `${ms.toFixed(2)} ms`;
}

function fmtBytes(bytes: number) {
  const sign = bytes >= 0 ? "+" : "";
  const abs = Math.abs(bytes);
  const colour = bytes > 512 * 1024 ? RED : bytes > 0 ? YELLOW : GREEN;
  if (abs < 1024) return `${colour}${sign}${bytes} B${RESET}`;
  if (abs < 1024 * 1024)
    return `${colour}${sign}${(bytes / 1024).toFixed(1)} KB${RESET}`;
  return `${colour}${sign}${(bytes / (1024 * 1024)).toFixed(2)} MB${RESET}`;
}

function fmtHeapAbs(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function printStepBanner(meta: StepMeta, stepNumber: number, total: number) {
  console.log(
    `\n${BOLD}${CYAN}┌─ Step ${stepNumber}/${total}${"─".repeat(52)}${RESET}`,
  );
  console.log(
    `${BOLD}${CYAN}│${RESET}  ${BOLD}index${RESET} : ${meta.index}   ` +
      `${BOLD}type${RESET} : ${meta.type}   ` +
      `${BOLD}label${RESET} : ${meta.label ?? DIM + "(unlabelled)" + RESET}`,
  );
  console.log(`${BOLD}${CYAN}└${"─".repeat(60)}${RESET}`);
}

function printStepStats(stat: StepPerfStats) {
  const gcInfo =
    stat.gcCount > 0
      ? `${RED}${stat.gcCount} event(s), ${fmtMs(stat.gcDurationMs)}${RESET}`
      : `${DIM}none${RESET}`;

  console.log(`\n  ${BOLD}${GREEN}✔ Step complete${RESET}`);
  console.log(
    `  ${BOLD}Wall-clock${RESET}  : ${MAGENTA}${fmtMs(stat.durationMs)}${RESET}`,
  );
  console.log(
    `  ${BOLD}CPU${RESET}         : user ${BLUE}${fmtMs(stat.cpuUserMs)}${RESET}` +
      `  sys ${BLUE}${fmtMs(stat.cpuSystemMs)}${RESET}`,
  );
  console.log(
    `  ${BOLD}Heap${RESET}        : ${fmtBytes(stat.heapDeltaBytes)}` +
      `  (after: ${DIM}${fmtHeapAbs(stat.heapUsedAfter)}${RESET})`,
  );
  console.log(
    `  ${BOLD}RSS Δ${RESET}       : ${fmtBytes(stat.rssDeltaBytes)}` +
      `   ${BOLD}External Δ${RESET}: ${fmtBytes(stat.externalDeltaBytes)}`,
  );
  console.log(`  ${BOLD}GC${RESET}          : ${gcInfo}`);
  if (stat.threw) console.log(`  ${BOLD}${RED}⚠  Step threw an error${RESET}`);
}

function printFinalReport(stats: StepPerfStats[]) {
  const total = stats.reduce((a, s) => a + s.durationMs, 0);
  const totalCpuUser = stats.reduce((a, s) => a + s.cpuUserMs, 0);
  const totalGcMs = stats.reduce((a, s) => a + s.gcDurationMs, 0);
  const peakHeap = stats.reduce((a, s) => Math.max(a, s.heapUsedAfter), 0);
  const slowest = stats.reduce((a, s) => (s.durationMs > a.durationMs ? s : a));
  const heaviest = stats.reduce((a, s) =>
    s.heapDeltaBytes > a.heapDeltaBytes ? s : a,
  );

  console.log(`\n${BOLD}${"═".repeat(62)}${RESET}`);
  console.log(`${BOLD}  FLOW SUMMARY${RESET}`);
  console.log(`${"═".repeat(62)}`);
  console.log(`  Total wall-clock : ${MAGENTA}${fmtMs(total)}${RESET}`);
  console.log(`  CPU user total   : ${BLUE}${fmtMs(totalCpuUser)}${RESET}`);
  console.log(`  Total GC time    : ${RED}${fmtMs(totalGcMs)}${RESET}`);
  console.log(`  Peak heap        : ${YELLOW}${fmtHeapAbs(peakHeap)}${RESET}`);
  console.log(
    `\n  ${BOLD}Slowest${RESET}  : ${slowest.label ?? `step ${slowest.index}`}` +
      ` (${MAGENTA}${fmtMs(slowest.durationMs)}${RESET})`,
  );
  console.log(
    `  ${BOLD}Heaviest${RESET} : ${heaviest.label ?? `step ${heaviest.index}`}` +
      ` (${fmtBytes(heaviest.heapDeltaBytes)} heap delta)`,
  );
  console.log(`${"═".repeat(62)}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactive mode — press Enter to advance, q to quit
// ─────────────────────────────────────────────────────────────────────────────
// A single readline interface is reused for every prompt. Creating and closing
// a new interface per step causes stdin buffering bugs: the \n from the
// previous Enter is instantly consumed by the freshly created interface,
// making it resolve without waiting and skipping the stats display.

async function waitForEnter(
  rl: readline.Interface,
  prompt: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim().toLowerCase() !== "q");
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 5;

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(
    `\n${BOLD}Flowneer — Per-Step Perf Inspector${RESET}` +
      `\nPauses before each step. Press ${BOLD}Enter${RESET} to run it, ${BOLD}q + Enter${RESET} to abort.\n`,
  );

  // ── Build the extended class ────────────────────────────────────────────
  const AppFlow = FlowBuilder.extend([withPerfAnalyzer, withManualStepping]);

  // ── Wire the flow ───────────────────────────────────────────────────────
  // Plugin order matters for wrapStep nesting (last registered = innermost).
  // withManualStepping must be outermost so its _stepDone promise resolves
  // AFTER withPerfAnalyzer's finally block has written the stats.
  const builder = new AppFlow<PipelineState>()
    .withManualStepping() // outermost: pause/resume gate
    .withPerfAnalyzer({ trackGc: true }) // innermost: runs inside the gate
    .then(loadContext, { label: "load-context" })
    .then(embedQuery, { label: "embed-query" })
    .then(callLlm, { label: "llm:generate" })
    .then(parseOutput, { label: "parse-output" })
    .then(saveResult, { label: "save-result" });

  const shared: PipelineState = { query: "What is Flowneer?" };

  // ── Start the flow (does NOT block — it suspends at the first step) ─────
  const done = builder.run(shared);

  let stepNumber = 0;

  // ── Step-by-step interactive loop ──────────────────────────────────────
  let meta: StepMeta | null;
  while ((meta = await builder.stepper.waitUntilPaused()) !== null) {
    stepNumber++;
    printStepBanner(meta, stepNumber, TOTAL_STEPS);

    const shouldContinue = await waitForEnter(
      rl,
      `  ${DIM}Press Enter to run this step, q to quit…${RESET} `,
    );
    if (!shouldContinue) {
      console.log(`\n${YELLOW}Aborted by user.${RESET}\n`);
      rl.close();
      process.exit(0);
    }

    // Execute the step and wait for it to finish
    await builder.stepper.continue();

    // The most recent entry in __perfStats belongs to this step
    const stats = shared.__perfStats ?? [];
    const latest = stats[stats.length - 1];
    if (latest) printStepStats(latest);
  }

  // ── Wait for flow.run() to settle ──────────────────────────────────────
  await done;

  // ── Final report ───────────────────────────────────────────────────────
  rl.close();
  if (shared.__perfStats && shared.__perfStats.length > 0) {
    printFinalReport(shared.__perfStats);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
