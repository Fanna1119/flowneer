#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Flowneer — AI-generated flows via JsonFlowBuilder
// ---------------------------------------------------------------------------
// The AI (o4-mini) receives a task description and a tool registry catalogue.
// It responds with a valid FlowConfig JSON. Flowneer validates it, compiles it,
// and executes it — all in the same process.
//
// The AI can compose any combination of:
//   write, fetch, summarise, classify, sentiment, keywords, translate,
//   rewrite, wordCount, uppercase, lowercase, reverse, wait, log, fail (for testing)
//
// Interactive REPL loop — each prompt builds and runs a fresh flow.
// The flow's final shared state is printed after every run.
//
// Run with:  bun run examples/aiFlowBuilder.ts
// Requires:  OPENAI_API_KEY environment variable
// ---------------------------------------------------------------------------

import "dotenv/config";
import { createInterface } from "readline";
import { callLlm } from "../../utils/callLlm";
import { JsonFlowBuilder, ConfigValidationError } from "../../presets/config";
import type { FlowConfig, FnRegistry } from "../../plugins/config";

// ─────────────────────────────────────────────────────────────────────────────
// Tool registry — functions the AI-generated flow can call
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Each function receives the shared state and may read/write any key.
 * Keys that any function writes are documented below so the AI knows what
 * is available downstream.
 *
 *   write              → s.text       (calls LLM to generate text from s.writePrompt; auto-set to the user's task)
 *   fetch(url?)        → s.text       (fetches s.url or s.fetchUrl, stores body)
 *   summarise          → s.summary    (calls LLM, reads s.text)
 *   classify           → s.category   (calls LLM, reads s.text)
 *   sentiment          → s.sentiment  (calls LLM, reads s.text)
 *   keywords           → s.keywords   (calls LLM array, reads s.text)
 *   translate          → s.translated (reads s.targetLang; generic single-language fallback)
 *   translate<Lang>    → s.<lang>     (per-request — injected when task mentions a known language;
 *                                      e.g. translateFrench → s.french, translateGerman → s.german)
 *   rewrite(tone?)     → s.rewritten  (calls LLM, reads s.text, uses s.tone or "formal")
 *   wordCount          → s.wordCount  (reads s.text)
 *   uppercase          → s.text       (mutates s.text in-place)
 *   lowercase          → s.text       (mutates s.text in-place)
 *   reverse            → s.text       (reverses words in s.text)
 *   log                → (prints s to console)
 *   wait               → (waits s.waitMs or 200 ms)
 *   fail               → (throws, for testing error handling)
 */
const REGISTRY: FnRegistry = {
  write: async (s: any) => {
    const prompt: string = s.writePrompt ?? "";
    s.text = await callLlm(prompt);
  },

  fetch: async (s: any) => {
    const url: string = s.fetchUrl ?? s.url ?? "";
    if (!url) {
      s.text = "(no URL provided — set s.fetchUrl)";
      return;
    }
    const r = await globalThis.fetch(url);
    s.text = await r.text();
  },

  summarise: async (s: any) => {
    const text: string = s.text ?? "";
    s.summary = await callLlm(
      `Summarise the following in 2–3 sentences:\n\n${text.slice(0, 4000)}`,
    );
  },

  classify: async (s: any) => {
    const text: string = s.text ?? "";
    s.category = await callLlm(
      `Classify the following text into exactly ONE category from: ` +
        `news, opinion, technical, fiction, marketing, other.\n` +
        `Reply with just the category word.\n\n${text.slice(0, 2000)}`,
    );
    s.category = s.category.trim().toLowerCase();
  },

  sentiment: async (s: any) => {
    const text: string = s.text ?? "";
    s.sentiment = await callLlm(
      `Analyse the sentiment of the following text.\n` +
        `Reply with exactly one of: positive, neutral, negative.\n\n${text.slice(0, 2000)}`,
    );
    s.sentiment = s.sentiment.trim().toLowerCase();
  },

  keywords: async (s: any) => {
    const text: string = s.text ?? "";
    const raw = await callLlm(
      `Extract up to 8 key topics from the following text.\n` +
        `Reply with a JSON array of strings only, no other text.\n\n${text.slice(0, 2000)}`,
    );
    try {
      s.keywords = JSON.parse(raw.replace(/```json\n?|```/g, "").trim());
    } catch {
      s.keywords = raw.split(",").map((k: string) => k.trim());
    }
  },

  translate: async (s: any) => {
    const text: string = s.text ?? s.summary ?? "";
    const lang: string = s.targetLang ?? "Spanish";
    s.translated = await callLlm(
      `Translate the following text to ${lang}. Reply with only the translation.\n\n${text.slice(0, 2000)}`,
    );
  },

  rewrite: async (s: any) => {
    const text: string = s.text ?? "";
    const tone: string = s.tone ?? "formal";
    s.rewritten = await callLlm(
      `Rewrite the following text in a ${tone} tone. Reply with only the rewrite.\n\n${text.slice(0, 2000)}`,
    );
  },

  wordCount: (s: any) => {
    s.wordCount = (s.text ?? "").split(/\s+/).filter(Boolean).length;
  },

  uppercase: (s: any) => {
    s.text = (s.text ?? "").toUpperCase();
  },
  lowercase: (s: any) => {
    s.text = (s.text ?? "").toLowerCase();
  },
  reverse: (s: any) => {
    s.text = (s.text ?? "").split(/\s+/).reverse().join(" ");
  },

  log: (s: any) => {
    const display = { ...s };
    if (display.text && display.text.length > 200)
      display.text = display.text.slice(0, 200) + "…";
    console.log(
      "\n  [log step] shared state:\n" +
        JSON.stringify(display, null, 4)
          .split("\n")
          .map((l) => "  " + l)
          .join("\n"),
    );
  },

  wait: async (s: any) => {
    const ms: number = s.waitMs ?? 200;
    await new Promise((r) => setTimeout(r, ms));
  },

  fail: () => {
    throw new Error("deliberate failure (test step)");
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// System prompt — tells the model the schema and exact registry keys
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT_BASE = `\
You are a flow-builder assistant for the Flowneer framework.

Your job is to return a VALID JSON FlowConfig given a task description.
Respond with RAW JSON only — no markdown fences, no extra text.

### FlowConfig schema

{
  "steps": [ <StepConfig>... ]
}

StepConfig is one of:

{ "type": "fn",       "fn": "<registryKey>", "label": "<optional>", "retries": <optional int> }
{ "type": "branch",   "router": "<registryKey>", "branches": { "<key>": "<registryKey>", ... }, "label": "<optional>" }
{ "type": "loop",     "condition": "<registryKey>", "body": [ <StepConfig>... ], "label": "<optional>" }
{ "type": "parallel", "fns": ["<key>", ...], "label": "<optional>" }
{ "type": "anchor",   "name": "<string>", "maxVisits": <optional int> }

### Base registry keys

  write        — LLM: generates new text from shared.writePrompt (auto-set to task); writes shared.text
  fetch        — fetches shared.fetchUrl; writes shared.text
  summarise    — LLM: summarises shared.text; writes shared.summary
  classify     — LLM: classifies shared.text into one category; writes shared.category
  sentiment    — LLM: analyses sentiment of shared.text; writes shared.sentiment
  keywords     — LLM: extracts keywords from shared.text; writes shared.keywords (array)
  translate    — LLM: translates shared.text to shared.targetLang (default Spanish); writes shared.translated
  rewrite      — LLM: rewrites shared.text in shared.tone (default "formal"); writes shared.rewritten
  wordCount    — counts words in shared.text; writes shared.wordCount (number)
  uppercase    — uppercases shared.text in-place
  lowercase    — lowercases shared.text in-place
  reverse      — reverses word order of shared.text in-place
  log          — prints current shared state to console (no writes)
  wait         — sleeps shared.waitMs ms (default 200)
  fail         — throws an error (use to test error handling)

### Important
- shared.writePrompt is automatically set to the user's task before the flow runs.
  Use "write" to generate content from scratch when no existing text is provided.
- ALWAYS use a { "type": "parallel" } step for independent tasks (analysis, translation, etc.).
  Steps inside parallel run simultaneously — prefer this whenever outputs don't depend on each other.

### Rules
- Use ONLY the registry keys listed above (plus any injected below). Any unknown key fails validation.
- For branching, the router fn must return a string matching a key in "branches".
- Return ONLY the JSON object, nothing else.
`;

// ─────────────────────────────────────────────────────────────────────────────
// Build + run a flow from a natural-language task description
// ─────────────────────────────────────────────────────────────────────────────

interface RunState {
  text?: string;
  writePrompt?: string;
  fetchUrl?: string;
  targetLang?: string;
  tone?: string;
  waitMs?: number;
  [key: string]: unknown;
}

// Known languages: name → shared-state key written by the injected translate fn
const LANGUAGE_MAP: Record<string, string> = {
  French: "french",
  German: "german",
  Spanish: "spanish",
  Italian: "italian",
  Dutch: "dutch",
  Portuguese: "portuguese",
  Japanese: "japanese",
  Chinese: "chinese",
  Korean: "korean",
  Russian: "russian",
  Arabic: "arabic",
  Hindi: "hindi",
  Turkish: "turkish",
  Polish: "polish",
  Swedish: "swedish",
  Norwegian: "norwegian",
  Danish: "danish",
  Finnish: "finnish",
};

function extractLanguages(task: string): string[] {
  return Object.keys(LANGUAGE_MAP).filter((lang) =>
    task.toLowerCase().includes(lang.toLowerCase()),
  );
}

function makeTranslateFn(
  lang: string,
  stateKey: string,
): (s: any) => Promise<void> {
  return async (s: any) => {
    const text: string = s.text ?? s.summary ?? "";
    s[stateKey] = await callLlm(
      `Translate the following text to ${lang}. Reply with only the translation.\n\n${text.slice(0, 2000)}`,
    );
  };
}

async function buildAndRun(
  task: string,
  initialState: RunState = {},
): Promise<void> {
  // ── Build per-request registry with injected translate<Lang> fns ──────────
  const detectedLangs = extractLanguages(task);
  const registry: FnRegistry = { ...REGISTRY };
  const injectedLines: string[] = [];

  for (const lang of detectedLangs) {
    const key = LANGUAGE_MAP[lang]!;
    const fnName = `translate${lang}`;
    registry[fnName] = makeTranslateFn(lang, key);
    injectedLines.push(
      `  ${fnName.padEnd(22)} — LLM: translates shared.text (or shared.summary) to ${lang}; writes shared.${key}`,
    );
  }

  // ── Build prompt (base + optional injected-keys section + task) ───────────
  let prompt = SYSTEM_PROMPT_BASE;
  if (injectedLines.length > 0) {
    prompt += `\n### Injected registry keys for this task\n\n`;
    prompt += injectedLines.join("\n");
    if (detectedLangs.length > 1) {
      prompt +=
        `\n\nBecause the task requires ${detectedLangs.length} languages, you MUST use a` +
        ` { "type": "parallel" } step containing [${detectedLangs.map((l) => `"translate${l}"`).join(", ")}].` +
        ` Do NOT use the generic "translate" key for these languages.`;
    }
  }
  prompt += `\n\n### Task\n${task}`;

  // ── 1. Ask the LLM for a FlowConfig ──────────────────────────────────────
  console.log("\n  ⏳ Asking the model to design a flow…");
  const raw = await callLlm(prompt);

  // ── 2. Parse JSON ─────────────────────────────────────────────────────────
  let config: FlowConfig;
  try {
    config = JSON.parse(raw.replace(/```json\n?|```/g, "").trim());
  } catch {
    console.error("\n  ✗ Model returned invalid JSON:\n");
    console.error(raw);
    return;
  }

  console.log("\n  Generated FlowConfig:");
  console.log(
    JSON.stringify(config, null, 4)
      .split("\n")
      .map((l) => "  " + l)
      .join("\n"),
  );

  // ── 3. Validate ───────────────────────────────────────────────────────────
  const check = JsonFlowBuilder.validate(config, registry);
  if (!check.valid) {
    console.error(`\n  ✗ Validation failed (${check.errors.length} error(s)):`);
    for (const e of check.errors) console.error(`    ${e.path}: ${e.message}`);
    return;
  }
  console.log("\n  ✓ Validation passed.");

  // ── 4. Build + run ────────────────────────────────────────────────────────
  let flow;
  try {
    flow = JsonFlowBuilder.build(config, registry);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      console.error("\n  ✗ Build failed:");
      for (const e of err.errors) console.error(`    ${e.path}: ${e.message}`);
    } else {
      console.error("\n  ✗ Build error:", err);
    }
    return;
  }

  console.log("\n  ▶ Running flow…\n");
  const shared: RunState = {
    writePrompt: task,
    ...(detectedLangs.length === 1 ? { targetLang: detectedLangs[0] } : {}),
    ...initialState,
  };
  const start = performance.now();
  try {
    await flow.run(shared);
  } catch (err: any) {
    console.error(`\n  ✗ Flow error: ${err?.message ?? err}`);
    return;
  }
  const elapsed = (performance.now() - start).toFixed(0);

  // ── 5. Print results ──────────────────────────────────────────────────────
  const display: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(shared)) {
    if (k.startsWith("__")) continue;
    if (typeof v === "string" && v.length > 300) {
      display[k] = v.slice(0, 300) + "…";
    } else {
      display[k] = v;
    }
  }

  console.log(`\n  ✓ Flow completed in ${elapsed} ms`);
  console.log("\n  ── Final shared state ──────────────────────────────────");
  for (const [k, v] of Object.entries(display)) {
    const line =
      typeof v === "string"
        ? v.replace(/\n/g, " ").slice(0, 120)
        : JSON.stringify(v);
    console.log(`  ${k.padEnd(14)} ${line}`);
  }
  console.log();
}

// ─────────────────────────────────────────────────────────────────────────────
// REPL
// ─────────────────────────────────────────────────────────────────────────────

const EXAMPLE_TASKS = [
  "Summarise this text and extract its keywords in parallel: " +
    "'Bun is a fast JavaScript runtime. It has a built-in bundler, " +
    "test runner, and package manager. It is written in Zig.'",
  "Count the words in 'The quick brown fox jumps over the lazy dog'" +
    " and then uppercase the text.",
  "Run sentiment analysis and classification on: " +
    "'I absolutely love how fast Flowneer compiles flows!'",
  "Translate the following to French and also rewrite it as casual: " +
    "'The deployment pipeline has been updated to reduce build times.'",
];

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  console.log("\n┌─────────────────────────────────────────────────────────┐");
  console.log("│         Flowneer × AI Flow Builder  (o4-mini)           │");
  console.log("│                                                         │");
  console.log("│  Describe a text-processing task in plain English.      │");
  console.log("│  The AI designs a FlowConfig; Flowneer executes it.     │");
  console.log("│                                                         │");
  console.log("│  Available tools: write · fetch · summarise · classify  │");
  console.log("│    sentiment · keywords · translate · rewrite           │");
  console.log("│    wordCount · uppercase · lowercase · reverse          │");
  console.log("│    log · wait · fail                                    │");
  console.log("│                                                         │");
  console.log("│  Type  examples  for pre-built tasks.                   │");
  console.log("│  Type  quit  to exit.                                   │");
  console.log("└─────────────────────────────────────────────────────────┘\n");

  while (true) {
    const input = (await ask("  task> ")).trim();

    if (!input) continue;
    if (input === "quit" || input === "exit") break;

    if (input === "examples") {
      console.log("\n  Example tasks:");
      EXAMPLE_TASKS.forEach((t, i) =>
        console.log(
          `  [${i + 1}] ${t.slice(0, 80)}${t.length > 80 ? "…" : ""}`,
        ),
      );
      const pick = (
        await ask("\n  Pick a number (or press Enter to skip): ")
      ).trim();
      const idx = parseInt(pick, 10) - 1;
      const chosen = EXAMPLE_TASKS[idx];
      if (chosen) {
        console.log(`\n  Running: ${chosen}`);
        await buildAndRun(chosen);
      }
      continue;
    }

    // Let the user optionally seed the initial text via "text: ..." prefix
    let task = input;
    let initialState: RunState = {};

    const textMatch = input.match(/^text:\s*"([^"]+)"\s*(.*)$/s);
    if (textMatch) {
      initialState.text = textMatch[1];
      task = textMatch[2] ?? input;
    }

    await buildAndRun(task, initialState);
  }

  rl.close();
  console.log("\n  Goodbye.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
