// ---------------------------------------------------------------------------
// Clawneer — JsonFlowBuilder edition
// ---------------------------------------------------------------------------
//
// The same agent loop as clawneer.ts, rebuilt with JsonFlowBuilder.
// The flow topology is described as a plain FlowConfig object — serialisable
// JSON that can be stored in a database, returned from an API, or generated
// by a UI.  All runtime functions are registered in a FnRegistry and looked
// up by name at build time.
//
// Flow config (mirrors clawneer.ts exactly):
//
//   steps:
//     - fn: seed                    ← initialise messages + counters
//     - loop(shouldContinue):
//         - fn: callModel           ← call the LLM
//         - batch(getPendingCalls, key: currentCall):
//             - fn: executeTool     ← execute one tool call
//     - fn: emitAnswer              ← print the response
//
// Compared to clawneer.ts the only change is representation: the builder
// chain becomes a JSON config; the flow logic stays in the registry.
//
// Compared to clawneerGraph.ts the loop is expressed with a "loop" step type
// rather than conditional back-edges, and per-item dispatch uses the "batch"
// step type instead of inline iteration.
//
// Run with:  bun run examples/agents/clawneerJson.ts
// Requires:  OPENAI_API_KEY environment variable
// ---------------------------------------------------------------------------

import "dotenv/config";
import { OpenAI } from "openai";
import { JsonFlowBuilder } from "../../presets/config";
import { withRateLimit } from "../../plugins/llm";
import { withCircuitBreaker } from "../../plugins/resilience";
import type { FlowConfig, FnRegistry } from "../../plugins/config";
import { FlowBuilder } from "../../Flowneer";

// ─────────────────────────────────────────────────────────────────────────────
// Extended builder class — carries middleware alongside JSON-assembled steps
// ─────────────────────────────────────────────────────────────────────────────
//
// JsonFlowBuilder.build() accepts a custom FlowClass so that extended builders
// (with extra mixins) can be produced from config.  We pass ClawneerFlow here
// so the resulting instance has .withRateLimit() and .withCircuitBreaker().

const ClawneerFlow = FlowBuilder.extend([withRateLimit, withCircuitBreaker]);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type OAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface Tool<Input = any> {
  name: string;
  description: string;
  params: Record<string, { type: string; description: string }>;
  execute: (input: Input) => unknown | Promise<unknown>;
}

interface AgentState {
  systemPrompt: string;
  userPrompt: string;
  tools: Tool[];
  maxTurns: number;
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
// Tool schema helper
// ─────────────────────────────────────────────────────────────────────────────

function toOpenAITool(tool: Tool): OpenAI.Chat.Completions.ChatCompletionTool {
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
        required: Object.keys(tool.params),
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tools
// ─────────────────────────────────────────────────────────────────────────────

const builtinTools: Tool[] = [
  {
    name: "calculator",
    description: "Evaluate a safe arithmetic expression.",
    params: {
      expression: { type: "string", description: "Arithmetic expression" },
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
];

// ─────────────────────────────────────────────────────────────────────────────
// FnRegistry — references resolved by name from the FlowConfig
// ─────────────────────────────────────────────────────────────────────────────
//
// Every function referenced in the config must appear here.  The registry
// acts as the "code" side of the config/code split: the config owns topology,
// the registry owns implementation.

const registry: FnRegistry = {
  // Initialise messages and counters
  seed(s: AgentState) {
    s.messages = [
      { role: "system", content: s.systemPrompt },
      ...s.history,
      { role: "user", content: s.userPrompt },
    ];
    s.turn = 0;
    s.done = false;
    s.tokensUsed = 0;
    s.pendingCalls = [];
  },

  // Loop condition — evaluated before each iteration
  shouldContinue(s: AgentState) {
    return !s.done && s.turn < s.maxTurns;
  },

  // Call the model and collect tool calls (or final answer)
  async callModel(s: AgentState) {
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
  },

  // Batch item selector — returns the array to iterate
  getPendingCalls(s: AgentState) {
    return s.pendingCalls;
  },

  // Execute a single tool call.  The batch step injects the item into the
  // key specified in the config ("currentCall") before running this fn.
  async executeTool(s: AgentState) {
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
        result = await tool.execute(JSON.parse(call.function.arguments));
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
    }

    s.messages.push({
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify(result),
    });
  },

  // Print the final answer
  emitAnswer(s: AgentState) {
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
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// FlowConfig — serialisable description of the flow topology
// ─────────────────────────────────────────────────────────────────────────────
//
// This object can be stored as JSON in a file, database, or returned from an
// API.  It has no runtime dependencies — just plain data that describes which
// steps to run and in what order.

const config: FlowConfig = {
  steps: [
    // 1. Initialise
    { type: "fn", fn: "seed" },

    // 2. Agentic loop
    {
      type: "loop",
      condition: "shouldContinue",
      body: [
        // 2a. Call the model
        { type: "fn", fn: "callModel", label: "llm:callModel" },

        // 2b. Execute all pending tool calls (one step per item)
        {
          type: "batch",
          items: "getPendingCalls",
          key: "currentCall",
          processor: [{ type: "fn", fn: "executeTool" }],
        },
      ],
    },

    // 3. Emit answer
    { type: "fn", fn: "emitAnswer" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Build — validate config + wire up the flow
// ─────────────────────────────────────────────────────────────────────────────
//
// JsonFlowBuilder.build() validates the config (all fn refs must exist in the
// registry) and then assembles an equivalent FlowBuilder chain.  We pass our
// extended FlowClass so the resulting instance has the middleware mixins, then
// call .withRateLimit() / .withCircuitBreaker() on it directly.

const agentFlow = (
  JsonFlowBuilder.build<AgentState>(
    config,
    registry,
    ClawneerFlow as any,
  ) as any
)
  .withRateLimit({ intervalMs: 500 })
  .withCircuitBreaker({ maxFailures: 3, resetMs: 15_000 });

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export async function runAgent(
  userPrompt: string,
  opts: {
    tools?: Tool[];
    systemPrompt?: string;
    maxTurns?: number;
    history?: OAIMessage[];
  } = {},
): Promise<string> {
  const state: AgentState = {
    systemPrompt:
      opts.systemPrompt ??
      "You are Clawneer, a helpful assistant with access to tools. Use tools whenever they give a better answer than guessing. When you have enough information, respond directly.",
    userPrompt,
    tools: [...builtinTools, ...(opts.tools ?? [])],
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
// Demo
// ─────────────────────────────────────────────────────────────────────────────

console.log("\x1b[1mClawneer (JsonFlowBuilder edition)\x1b[0m\n");

const answer = await runAgent(
  "What is (144 / 12) ** 2 and what time is it right now?",
);
console.log();
