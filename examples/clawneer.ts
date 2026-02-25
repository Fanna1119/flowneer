// ---------------------------------------------------------------------------
// Clawneer — a tiny autonomous tool-calling agent, powered by Flowneer
// ---------------------------------------------------------------------------
//
// Mimics the core loop of multi-agent frameworks (OpenAI Agents SDK, etc.)
// but built entirely on Flowneer:
//
//   user prompt
//     └─ loop until no tool calls pending
//          ├─ call LLM with available tools
//          ├─ if tool calls → batch-execute → append results
//          └─ if final answer → break
//     └─ print answer
//
// Features:
//   • Interactive CLI — readline loop, conversation history across turns
//   • Persistent memory — reads/writes memory.md (human-editable markdown)
//   • TelemetryDaemon  — per-step spans flushed after every agent run
//
// Tools:
//   calculator   — safe arithmetic expression evaluator
//   currentTime  — current UTC timestamp
//   webSearch    — real web search via OpenAI responses API
//   memoryWrite  — write a key/value pair to memory.md
//   memoryRead   — read a value from memory.md
//   memoryDelete — permanently remove a key from memory.md
//   memoryList   — list all keys in memory.md
//   setTimer     — fire a message after N seconds
//   runCommand   — run a safe, read-only shell command (AI-gated + code-gated)
//
// Run with:  bun run examples/clawneer.ts
// Requires:  OPENAI_API_KEY environment variable
// ---------------------------------------------------------------------------

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { exec } from "child_process";
import { OpenAI } from "openai";
import { FlowBuilder } from "../Flowneer";
import { withRateLimit } from "../plugins/llm";
import { withCircuitBreaker } from "../plugins/resilience";
import {
  TelemetryDaemon,
  consoleExporter,
} from "../plugins/telemetry/telemetry";

FlowBuilder.use(withRateLimit);
FlowBuilder.use(withCircuitBreaker);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// Persistent memory backed by memory.md
// ─────────────────────────────────────────────────────────────────────────────
// Format:
//   # Clawneer Memory
//
//   ## key
//   value
//
//   ## another_key
//   another value

const MEMORY_PATH = path.join(import.meta.dir, "memory.md");

function loadMemory(): Record<string, string> {
  if (!fs.existsSync(MEMORY_PATH)) return {};
  const text = fs.readFileSync(MEMORY_PATH, "utf8");
  const store: Record<string, string> = {};
  // Split on "## key" headings
  const sections = text.split(/^## /m).slice(1); // drop preamble
  for (const section of sections) {
    const nl = section.indexOf("\n");
    if (nl === -1) continue;
    const key = section.slice(0, nl).trim();
    const value = section.slice(nl + 1).trim();
    if (key) store[key] = value;
  }
  return store;
}

function saveMemory(store: Record<string, string>): void {
  const lines = ["# Clawneer Memory\n"];
  for (const [key, value] of Object.entries(store)) {
    lines.push(`## ${key}\n${value}\n`);
  }
  fs.writeFileSync(MEMORY_PATH, lines.join("\n"), "utf8");
}

// Live in-process store — loaded once on start, flushed on every write
const memoryStore: Record<string, string> = loadMemory();

// ─────────────────────────────────────────────────────────────────────────────
// TelemetryDaemon — runs for the lifetime of the process
// ─────────────────────────────────────────────────────────────────────────────

const telemetry = new TelemetryDaemon({
  exporter: consoleExporter,
  flushIntervalMs: 30_000, // background flush every 30 s
  maxBuffer: 200,
});

// ─────────────────────────────────────────────────────────────────────────────
// Tool helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolParam {
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
}

export interface Tool<Input = any> {
  name: string;
  description: string;
  params: Record<string, ToolParam>;
  execute: (input: Input) => unknown | Promise<unknown>;
}

function toOpenAITool(tool: Tool): OpenAI.Chat.Completions.ChatCompletionTool {
  const required = Object.entries(tool.params)
    .filter(([, p]) => p.required !== false)
    .map(([k]) => k);
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(tool.params).map(([k, p]) => [
            k,
            { type: p.type, description: p.description },
          ]),
        ),
        required,
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Built-in tools
// ─────────────────────────────────────────────────────────────────────────────

const builtinTools: Tool[] = [
  {
    name: "calculator",
    description:
      "Evaluate a safe arithmetic expression. Supports +, -, *, /, **, %, parentheses, Math.*",
    params: {
      expression: {
        type: "string",
        description: "Arithmetic expression, e.g. '(12 * 4) / 3'",
      },
    },
    execute({ expression }: { expression: string }) {
      if (
        /[^0-9\s\+\-\*\/\.\(\)\%\^MathpowsqrflooeilPIabcrounding,]/.test(
          expression,
        )
      )
        return { error: "Unsafe expression rejected" };
      try {
        const result = new Function(
          `"use strict"; const Math = globalThis.Math; return (${expression})`,
        )();
        return { result };
      } catch {
        return { error: "Could not evaluate expression" };
      }
    },
  },

  {
    name: "currentTime",
    description: "Returns the current UTC date and time as ISO 8601.",
    params: {},
    execute() {
      return { utc: new Date().toISOString() };
    },
  },

  {
    name: "webSearch",
    description: "Search the web for up-to-date information.",
    params: {
      query: { type: "string", description: "The search query" },
    },
    async execute({ query }: { query: string }) {
      const resp = await openai.responses.create({
        model: "gpt-4o-mini",
        tools: [{ type: "web_search_preview" } as any],
        input: query,
      });
      return { summary: resp.output_text?.trim() ?? "(no results)" };
    },
  },

  {
    name: "memoryWrite",
    description:
      "Store a value in persistent memory (memory.md). Survives across sessions.",
    params: {
      key: { type: "string", description: "Memory key" },
      value: { type: "string", description: "Value to store" },
    },
    execute({ key, value }: { key: string; value: string }) {
      memoryStore[key] = value;
      saveMemory(memoryStore); // flush to disk immediately
      return { stored: true, key };
    },
  },

  {
    name: "memoryRead",
    description: "Read a value from persistent memory.",
    params: {
      key: { type: "string", description: "Memory key to look up" },
    },
    execute({ key }: { key: string }) {
      const value = memoryStore[key];
      return value !== undefined
        ? { key, value }
        : { key, error: "key not found" };
    },
  },

  {
    name: "memoryDelete",
    description: "Permanently delete a key from persistent memory (memory.md).",
    params: {
      key: { type: "string", description: "Memory key to delete" },
    },
    execute({ key }: { key: string }) {
      if (!(key in memoryStore))
        return { deleted: false, key, error: "key not found" };
      delete memoryStore[key];
      saveMemory(memoryStore);
      return { deleted: true, key };
    },
  },

  {
    name: "memoryList",
    description: "List all keys currently stored in memory.",
    params: {},
    execute() {
      return { keys: Object.keys(memoryStore) };
    },
  },

  {
    name: "setTimer",
    description:
      "Schedule a message to be printed to the user after a delay. Use this when the user asks to be reminded or notified after a certain number of seconds.",
    params: {
      message: {
        type: "string",
        description: "The message to display when the timer fires",
      },
      seconds: {
        type: "number",
        description: "How many seconds to wait before showing the message",
      },
    },
    execute({ message, seconds }: { message: string; seconds: number }) {
      const ms = Math.max(0, Math.round(seconds * 1000));
      setTimeout(() => {
        process.stdout.write("\n\r");
        console.log(`\x1b[1m⏰ Timer:\x1b[0m ${message}`);
        process.stdout.write("\x1b[1mYou:\x1b[0m ");
      }, ms);
      return { scheduled: true, message, firesInMs: ms };
    },
  },

  {
    name: "runCommand",
    description:
      "Execute a shell command and return its output. " +
      "ONLY call this for safe, read-only, non-destructive commands such as: " +
      "ls, pwd, cat, echo, date, whoami, uname, df, du, ps, which, find, head, tail, wc, grep, env, printenv. " +
      "NEVER call this for commands that write files, delete data, install software, " +
      "make network requests, escalate privileges, or could cause any side effects. " +
      "If unsure whether a command is safe, refuse and explain why instead of calling this tool.",
    params: {
      command: {
        type: "string",
        description: "The shell command to execute",
      },
    },
    execute({ command }: { command: string }) {
      // ── Code-level safety guard (second layer after model judgment) ─────
      const ALLOWED =
        /^(ls|pwd|cat|echo|date|whoami|uname|df|du|ps|which|find|head|tail|wc|grep|env|printenv)\b/;
      const BLOCKED =
        /(rm|sudo|kill|chmod|chown|chgrp|curl|wget|nc |ncat|ssh|scp|rsync|python|node|bun|deno|ruby|perl|php|bash|sh |zsh|fish|eval|exec|source|\$\(|`|>{1,2}|\|\s*(sh|bash|zsh|bun|node))/i;

      if (!ALLOWED.test(command.trimStart()))
        return {
          error:
            "Command not in allowed list. Permitted: ls, pwd, cat, echo, date, whoami, uname, df, du, ps, which, find, head, tail, wc, grep, env, printenv.",
        };
      if (BLOCKED.test(command))
        return {
          error: "Command contains a blocked pattern and was not executed.",
        };

      return new Promise<unknown>((resolve) => {
        const deadline = setTimeout(
          () => resolve({ error: "Command timed out after 5s" }),
          5_000,
        );
        exec(
          command,
          { timeout: 5_000, maxBuffer: 64 * 1024 },
          (err, stdout, stderr) => {
            clearTimeout(deadline);
            const out = stdout.slice(0, 2_000);
            const errOut = stderr.slice(0, 500);
            if (err && !out) resolve({ error: errOut || err.message });
            else
              resolve({ stdout: out, ...(errOut ? { stderr: errOut } : {}) });
          },
        );
      });
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Agent state
// ─────────────────────────────────────────────────────────────────────────────

type OAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

interface AgentState {
  systemPrompt: string;
  userPrompt: string;
  tools: Tool[];
  maxTurns: number;
  // conversation history passed in from the CLI loop
  history: OAIMessage[];

  // runtime
  messages: OAIMessage[];
  pendingCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  currentCall?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall;
  turn: number;
  done: boolean;
  tokensUsed: number;

  // output
  answer: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Flowneer agent flow
// ─────────────────────────────────────────────────────────────────────────────

const agentFlow = new FlowBuilder<AgentState>()
  .withRateLimit({ intervalMs: 500 })
  .withCircuitBreaker({ maxFailures: 3, resetMs: 15_000 })

  // ── 1. Seed the conversation ────────────────────────────────────────────
  .startWith((s) => {
    s.messages = [
      { role: "system", content: s.systemPrompt },
      ...s.history,
      { role: "user", content: s.userPrompt },
    ];
    s.turn = 0;
    s.done = false;
    s.tokensUsed = 0;
    s.pendingCalls = [];
  })

  // ── 2. Agentic loop ─────────────────────────────────────────────────────
  .loop(
    (s) => !s.done && s.turn < s.maxTurns,
    (body) =>
      body
        // 2a. Call the model
        .startWith(async (s) => {
          s.turn++;
          process.stdout.write(`\x1b[2m  [turn ${s.turn}]\x1b[0m `);

          const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: s.messages,
            tools: s.tools.map(toOpenAITool),
            tool_choice: "auto",
          });

          s.tokensUsed += response.usage?.total_tokens ?? 0;

          const msg = response.choices[0]!.message;
          s.messages.push(msg as OAIMessage);

          const toolCalls = (msg.tool_calls ?? []).filter(
            (
              tc,
            ): tc is OpenAI.Chat.Completions.ChatCompletionMessageToolCall & {
              type: "function";
            } => tc.type === "function",
          );
          s.pendingCalls = toolCalls;

          if (toolCalls.length === 0) {
            process.stdout.write("\n");
            s.done = true;
            s.answer = msg.content ?? "";
          } else {
            const names = toolCalls.map((tc) => tc.function.name).join(", ");
            process.stdout.write(`\x1b[33m${names}\x1b[0m\n`);
          }
        })

        // 2b. Execute all pending tool calls
        .batch(
          (s) => s.pendingCalls,
          (b) =>
            b.startWith(async (s) => {
              const call =
                s.currentCall as OpenAI.Chat.Completions.ChatCompletionMessageToolCall & {
                  type: "function";
                };
              const tool = s.tools.find((t) => t.name === call.function.name);

              let result: unknown;
              if (!tool) {
                result = { error: `Unknown tool "${call.function.name}"` };
              } else {
                try {
                  result = await tool.execute(
                    JSON.parse(call.function.arguments),
                  );
                } catch (err) {
                  result = {
                    error: err instanceof Error ? err.message : String(err),
                  };
                }
              }

              s.messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: JSON.stringify(result),
              });
            }),
          { key: "currentCall" },
        ),
  )

  // ── 3. Emit answer ──────────────────────────────────────────────────────
  .then((s) => {
    if (!s.answer) {
      const last = [...s.messages]
        .reverse()
        .find((m) => m.role === "assistant");
      s.answer =
        typeof last?.content === "string" ? last.content : "(no answer)";
    }
    console.log(`\n\x1b[1mClawneer:\x1b[0m ${s.answer}`);
    console.log(
      `\x1b[2m(${s.turn} turn(s) · ${s.tokensUsed.toLocaleString()} tokens)\x1b[0m`,
    );
  });

// Attach telemetry daemon to the flow
(agentFlow as any)._setHooks(telemetry.hooks());

// ─────────────────────────────────────────────────────────────────────────────
// runAgent — public entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function runAgent(
  userPrompt: string,
  opts: {
    tools?: Tool[];
    systemPrompt?: string;
    maxTurns?: number;
    extraTools?: Tool[];
    history?: OAIMessage[];
  } = {},
): Promise<string> {
  const state: AgentState = {
    systemPrompt:
      opts.systemPrompt ??
      `You are Clawneer, a helpful assistant with access to tools and persistent memory.
Use memoryWrite to store things the user asks you to remember.
Use memoryDelete to remove a specific key when the user asks to delete or forget something. Always use memoryDelete — never overwrite a key with empty content to simulate deletion.
Use memoryList to see what keys exist before reading or deleting.
Use setTimer when the user asks to be reminded or notified after a delay — pass the exact message they want to see and the number of seconds to wait.
Use runCommand only for safe, read-only shell commands (ls, pwd, cat, date, whoami, uname, df, ps, grep, etc.). Never use it for anything destructive, network-related, or that writes to disk.
Use tools whenever they would give a better answer than guessing.
When you have enough information, respond directly.`,
    userPrompt,
    tools: [...builtinTools, ...(opts.tools ?? []), ...(opts.extraTools ?? [])],
    maxTurns: opts.maxTurns ?? 10,
    history: opts.history ?? [],
    messages: [],
    pendingCalls: [],
    turn: 0,
    done: false,
    tokensUsed: 0,
    answer: "",
  };

  await agentFlow.run(state);
  return state.answer;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactive CLI
// ─────────────────────────────────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (prompt: string) =>
  new Promise<string | null>((resolve) => {
    const onClose = () => resolve(null);
    rl.once("close", onClose);
    rl.question(prompt, (answer) => {
      rl.removeListener("close", onClose); // prevent listener accumulation
      resolve(answer);
    });
  });

// Persist conversation history for the session
const conversationHistory: OAIMessage[] = [];

// Show memory keys on start if any exist
const existingKeys = Object.keys(memoryStore);
console.log("\x1b[1m╔══════════════════════════════╗\x1b[0m");
console.log("\x1b[1m║        Clawneer  🐾          ║\x1b[0m");
console.log("\x1b[1m╚══════════════════════════════╝\x1b[0m");
if (existingKeys.length > 0)
  console.log(`\x1b[2mMemory loaded: ${existingKeys.join(", ")}\x1b[0m`);
console.log(
  '\x1b[2mType "exit" or Ctrl+C to quit. "/memory" to inspect memory.md.\x1b[0m\n',
);

// Graceful shutdown
const shutdown = async () => {
  console.log("\n\x1b[2mFlushing telemetry...\x1b[0m");
  await telemetry.stop();
  rl.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

while (true) {
  const input = await ask("\x1b[1mYou:\x1b[0m ");

  if (input === null || input.trim().toLowerCase() === "exit") {
    await shutdown();
    break;
  }

  const trimmed = input.trim();
  if (!trimmed) continue;

  // Built-in CLI commands
  if (trimmed === "/memory") {
    if (!fs.existsSync(MEMORY_PATH)) {
      console.log("\x1b[2m(memory.md not yet created)\x1b[0m\n");
    } else {
      console.log("\n" + fs.readFileSync(MEMORY_PATH, "utf8") + "\n");
    }
    continue;
  }

  if (trimmed === "/history") {
    console.log(
      conversationHistory.length === 0
        ? "\x1b[2m(no history yet)\x1b[0m\n"
        : conversationHistory
            .map(
              (m) =>
                `\x1b[2m${m.role}:\x1b[0m ${typeof m.content === "string" ? m.content.slice(0, 120) : "..."}`,
            )
            .join("\n") + "\n",
    );
    continue;
  }

  try {
    const answer = await runAgent(trimmed, {
      history: conversationHistory,
    });

    // Append this exchange to session history so context carries forward
    conversationHistory.push({ role: "user", content: trimmed });
    conversationHistory.push({ role: "assistant", content: answer });
  } catch (err) {
    console.error(
      `\x1b[31mError:\x1b[0m ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  console.log();
}
