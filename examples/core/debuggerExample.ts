// ---------------------------------------------------------------------------
// Flowneer — withDebugger example
// ---------------------------------------------------------------------------
// Demonstrates how to use the withDebugger plugin to pause flow execution
// at specific lifecycle points using the native `debugger` statement.
//
// Run this file with an inspector attached so the breakpoints are hit:
//
//   bun --inspect-brk run examples/core/debuggerExample.ts
//
// Then open chrome://inspect in Chrome (or the VS Code "Attach" launch config)
// and DevTools will pause at each configured hook point, with `meta`, `shared`,
// and `params` all visible in the Scope panel.
//
// Three patterns are shown:
//
//   1. Default         — pause before every step (beforeStep only)
//   2. Selective hooks — pause before AND after, plus on errors
//   3. Step filter     — pause only on steps matching a label glob
//
// No API key required — all steps are plain sync/async functions.
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import { withDebugger } from "../../plugins/dev/withDebugger";

const DebugFlow = FlowBuilder.extend([withDebugger]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function separator(title: string) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(` ${title}`);
  console.log("─".repeat(60));
}

// ── Shared state ─────────────────────────────────────────────────────────────

interface PipelineState {
  input: string;
  normalized?: string;
  tokens?: string[];
  result?: string;
}

// =============================================================================
// Pattern 1 — Default: pause before every step
// =============================================================================
// withDebugger() with no arguments pauses at beforeStep for every step.
// Useful when you want a quick "walk-through" of the whole flow.

separator("Pattern 1 — pause before every step (default)");

await new DebugFlow<PipelineState>()
  .withDebugger() // { beforeStep: true } is the default
  .startWith(
    async (s) => {
      s.normalized = s.input.trim().toLowerCase();
      console.log("  [normalize]", s.normalized);
    },
    { label: "normalize" },
  )
  .then(
    async (s) => {
      s.tokens = s.normalized!.split(/\s+/);
      console.log("  [tokenize]", s.tokens);
    },
    { label: "tokenize" },
  )
  .then(
    async (s) => {
      s.result = s.tokens!.join("-");
      console.log("  [join]", s.result);
    },
    { label: "join" },
  )
  .run({ input: "  Hello World  " });

// =============================================================================
// Pattern 2 — Selective hooks: beforeStep + afterStep + onError
// =============================================================================
// Pass a DebuggerHooks object to choose exactly which lifecycle points pause.
// Here we also pause after each step completes and whenever a step throws,
// so you can inspect the state diff and the thrown error in scope.

separator("Pattern 2 — beforeStep + afterStep + onError");

try {
  await new DebugFlow<PipelineState>()
    .withDebugger(undefined, {
      beforeStep: true,
      afterStep: true,
      onError: true,
    })
    .startWith(
      async (s) => {
        s.normalized = s.input.trim().toUpperCase();
        console.log("  [uppercase]", s.normalized);
      },
      { label: "uppercase" },
    )
    .then(
      async (_s) => {
        // Simulate a transient failure so the onError breakpoint is hit
        throw new Error("simulated failure");
      },
      { label: "failing-step" },
    )
    .run({ input: "hello" });
} catch {
  console.log("  (caught expected error — onError breakpoint was hit above)");
}

// =============================================================================
// Pattern 3 — Step filter: pause only on "llm:*" labelled steps
// =============================================================================
// Pass a StepFilter as the first argument to scope the debugger to a subset
// of steps. Other steps run normally without any pause.
// Glob patterns ("llm:*") and plain label arrays both work.

separator('Pattern 3 — filter to "llm:*" steps only');

await new DebugFlow<PipelineState>()
  .withDebugger(
    ["llm:*"], // only steps whose label matches this glob
    { beforeStep: true, afterStep: true },
  )
  .startWith(
    async (s) => {
      // No breakpoint here — label doesn't match "llm:*"
      s.normalized = s.input.trim();
      console.log("  [prepare] no pause here");
    },
    { label: "prepare" },
  )
  .then(
    async (s) => {
      // Breakpoint fires here — label matches "llm:summarise"
      s.result = `[mock LLM output for: ${s.normalized}]`;
      console.log("  [llm:summarise] paused before + after");
    },
    { label: "llm:summarise" },
  )
  .then(
    async (s) => {
      // No breakpoint — label doesn't match "llm:*"
      console.log("  [format] no pause, result:", s.result);
    },
    { label: "format" },
  )
  .run({ input: "Flowneer makes flows easy" });

console.log("\nAll patterns complete.");
