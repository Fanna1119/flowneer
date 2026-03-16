// ---------------------------------------------------------------------------
// Clawneer — Graph edition
// ---------------------------------------------------------------------------
//
// The same agent loop as clawneer.ts, rebuilt with the withGraph plugin.
// The key difference is how the loop is expressed:
//
//   clawneer.ts              →  .loop() wrapping .batch()
//   clawneerGraph.ts         →  conditional back-edge + inline tool iteration
//
// Flow topology:
//
//   seed ──► callModel ──(done?)──► emitAnswer
//               │                       ▲
//               ▼                       │
//           executeTools ──(loop?)──────┘
//
// Nodes:
//   seed         — initialise message list and counters
//   callModel    — call the LLM; set s.done when the model returns text
//   executeTools — iterate pending tool calls inline (no .batch() needed)
//   emitAnswer   — print the final response
//
// Edges:
//   callModel    → emitAnswer   conditional forward skip — fires when done
//   executeTools → callModel    conditional back-edge   — fires to loop
//   all others                  unconditional (topological order)
//
// Run with:  bun run examples/agents/clawneerGraph.ts
// Requires:  OPENAI_API_KEY environment variable
// ---------------------------------------------------------------------------

import "dotenv/config";
import { OpenAI } from "openai";
import { FlowBuilder } from "../../Flowneer";
import { withGraph } from "../../plugins/graph";
import { withRateLimit } from "../../plugins/llm";
import { withCircuitBreaker } from "../../plugins/resilience";

const ClawneerGraph = FlowBuilder.extend([
  withGraph,
  withRateLimit,
  withCircuitBreaker,
]);

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
// DAG node functions
// ─────────────────────────────────────────────────────────────────────────────
// Each node receives the full shared state and mutates it. Because every node
// fires beforeStep / wrapStep / afterStep — identical to a plain .then() step
// — middleware like withRateLimit and withCircuitBreaker apply automatically
// to each node without any extra configuration.

async function seed(s: AgentState) {
  s.messages = [
    { role: "system", content: s.systemPrompt },
    ...s.history,
    { role: "user", content: s.userPrompt },
  ];
  s.turn = 0;
  s.done = false;
  s.tokensUsed = 0;
  s.pendingCalls = [];
}

async function callModel(s: AgentState) {
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
}

// executeTools iterates s.pendingCalls inline — in clawneer.ts this was
// expressed as a .batch() call; here it's just a regular node function.
// The graph models the loop structure; per-item batching is plain iteration.
async function executeTools(s: AgentState) {
  for (const call of s.pendingCalls) {
    if (call.type !== "function") continue;

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
  }
}

async function emitAnswer(s: AgentState) {
  if (!s.answer) {
    const last = [...s.messages].reverse().find((m) => m.role === "assistant");
    s.answer = typeof last?.content === "string" ? last.content : "(no answer)";
  }
  console.log(`\n\x1b[1mClawneer:\x1b[0m ${s.answer}`);
  console.log(
    `\x1b[2m(${s.turn} turn(s) · ${s.tokensUsed.toLocaleString()} tokens)\x1b[0m`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph flow
// ─────────────────────────────────────────────────────────────────────────────
//
// Compared to clawneer.ts, the loop structure is expressed entirely through
// edges rather than .loop() / .batch() method calls. The graph plugin's
// transparent DAG handler fires per-node lifecycle hooks, so withRateLimit
// and withCircuitBreaker apply to each node identically to .then() steps.

const agentFlow = new ClawneerGraph<AgentState>()
  .withRateLimit({ intervalMs: 500 })
  .withCircuitBreaker({ maxFailures: 3, resetMs: 15_000 })

  // Nodes — execution order derives from edges, not declaration order
  .addNode("seed", seed)
  .addNode("callModel", callModel, { label: "llm:callModel" })
  .addNode("executeTools", executeTools)
  .addNode("emitAnswer", emitAnswer)

  // Unconditional edges — define topological order
  .addEdge("seed", "callModel")
  .addEdge("callModel", "executeTools")
  .addEdge("executeTools", "emitAnswer")

  // Conditional forward skip — jump past executeTools when model is done
  .addEdge("callModel", "emitAnswer", (s) => s.done || s.turn >= s.maxTurns)

  // Conditional back-edge — loop back to callModel after tool execution
  .addEdge("executeTools", "callModel", (s) => !s.done && s.turn < s.maxTurns)

  .compile();

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

console.log("\x1b[1mClawneer (Graph edition)\x1b[0m\n");

const answer = await runAgent(
  "What is (144 / 12) ** 2 and what time is it right now?",
);
console.log();
