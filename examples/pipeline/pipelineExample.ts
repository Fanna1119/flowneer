// ---------------------------------------------------------------------------
// Pipeline Presets — generateUntilValid and mapReduceLlm
// ---------------------------------------------------------------------------
//
//   1. generateUntilValid — keeps retrying until the output passes validation
//   2. mapReduceLlm       — summarises each document, then folds into one answer
//
// Run with:  bun run examples/pipelineExample.ts
// Requires:  OPENAI_API_KEY environment variable
// ---------------------------------------------------------------------------

import "dotenv/config";
import { callLlm } from "../../utils/callLlm";
import { generateUntilValid, mapReduceLlm } from "../../presets/pipeline";

function separator(title: string) {
  console.log(`\n${"─".repeat(60)}\n ${title}\n${"─".repeat(60)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. generateUntilValid — generate a JSON object, retry until it parses cleanly
// ─────────────────────────────────────────────────────────────────────────────

interface JsonState {
  prompt: string;
  output: string;
  __guvAttempt?: number;
  __guvDone?: boolean;
  __validationError?: string;
}

const jsonFlow = generateUntilValid<JsonState>({
  generate: async (s) => {
    const attempt = s.__guvAttempt ?? 0;
    const hint = s.__validationError
      ? `\n\nPrevious attempt failed validation: ${s.__validationError}\nFix that issue.`
      : "";

    console.log(
      `  [generate] Attempt ${attempt + 1}${hint ? " (with error hint)" : ""}…`,
    );

    s.output = await callLlm(
      `${s.prompt}${hint}

Reply with valid JSON only, no markdown fences.`,
    );
  },

  validate: (s) => {
    try {
      JSON.parse(s.output.trim());
      console.log("  [validate] ✓ Valid JSON");
      return null; // null = valid
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  [validate] ✗ ${msg}`);
      return msg;
    }
  },

  maxAttempts: 4,
});

const jsonState: JsonState = {
  prompt:
    'Generate a JSON object with keys "name", "version", and "features" (an array of 3 strings) describing a fictional edge-runtime agent framework.',
  output: "",
};

separator("1. generateUntilValid — JSON output with retry");
await jsonFlow.run(jsonState);
console.log("\nFinal output:\n" + jsonState.output);

// ─────────────────────────────────────────────────────────────────────────────
// 2. mapReduceLlm — summarise each changelog entry, fold into one overview
// ─────────────────────────────────────────────────────────────────────────────

const CHANGELOGS = [
  `v0.5.0 – FlowBuilder.batch() added. Parallel step processing with configurable concurrency.
   Breaking: anchor() no longer auto-resumes; call resumeFlow() explicitly.`,

  `v0.6.0 – Plugins revamped. FlowBuilder.extend([...plugins]) creates an isolated subclass.
   New: withMemory plugin ships out of the box. withTools now supports async tool definitions.`,

  `v0.7.0 – Presets folder introduced. createAgent, withReActLoop, patterns moved out of plugins.
   New presets: ragPipeline, iterativeRag, generateUntilValid, mapReduceLlm.
   Deprecation: importing agent patterns from "flowneer/plugins/agent" logs a warning.`,
];

interface ChangelogState {
  documents: string[];
  summaries: string[];
  finalSummary: string;
}

const summaryFlow = mapReduceLlm<ChangelogState>({
  map: async (s, index) => {
    const doc = s.documents[index]!;
    console.log(`  [map] Summarising document ${index + 1}…`);
    return await callLlm(
      `Summarise this changelog entry in one sentence, starting with the version number.

${doc}`,
    );
  },

  reduce: async (s) => {
    console.log("  [reduce] Folding summaries into one overview…");
    s.finalSummary = await callLlm(
      `Combine these release summaries into a single cohesive paragraph suitable for a blog post introduction.

${s.summaries.map((s, i) => `• ${s}`).join("\n")}`,
    );
  },
});

const summaryState: ChangelogState = {
  documents: CHANGELOGS,
  summaries: [],
  finalSummary: "",
};

separator("2. mapReduceLlm — changelog summarisation");
await summaryFlow.run(summaryState);
console.log("\nPer-release summaries:");
summaryState.summaries.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
console.log("\nCombined overview:\n" + summaryState.finalSummary);
