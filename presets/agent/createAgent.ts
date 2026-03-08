// ---------------------------------------------------------------------------
// createAgent — LangChain-style createAgent() factory
// ---------------------------------------------------------------------------
//
//   const agent = createAgent({
//     tools: [getWeather],
//     callLlm: myLlmAdapter,
//   });
//
//   await agent.run({ input: "Weather in Paris?", messages: [] });
//
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import { withTools } from "../../plugins/tools";
import { withReActLoop } from "./withReActLoop";
import type { Tool, ToolRegistry } from "../../plugins/tools";
import type { ToolCall, ToolResult } from "../../plugins/tools/withTools";
import type { ThinkResult } from "./withReActLoop";

FlowBuilder.use(withTools);
FlowBuilder.use(withReActLoop);

// ─────────────────────────────────────────────────────────────────────────────
// LLM adapter types
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal chat message shape understood by `createAgent`. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present on assistant messages when the LLM wants to call tools. */
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  /** Present on tool result messages. */
  tool_call_id?: string;
}

/** Tool definition shape forwarded to the LLM. */
export interface LlmToolDef {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

/** Response returned by an `LlmAdapter`. */
export interface LlmResponse {
  /** Plain-text reply — present when the model is done. */
  text?: string;
  /** Tool calls — present when the model wants to invoke tools. */
  toolCalls?: ToolCall[];
}

/**
 * A vendor-agnostic LLM adapter.
 *
 * Receives the current conversation history and available tool definitions,
 * returns either a final answer or a list of tool calls.
 *
 * @example
 * // OpenAI adapter (see examples/agentExample.ts for a full implementation)
 * const callLlm: LlmAdapter = async (messages, tools) => { ... };
 */
export type LlmAdapter = (
  messages: ChatMessage[],
  tools: LlmToolDef[],
) => Promise<LlmResponse>;

// ─────────────────────────────────────────────────────────────────────────────
// Agent shared state
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentState {
  /** The user's input prompt. */
  input: string;
  /** The agent's final answer — set after the flow completes. */
  output?: string;
  /** Conversation history accumulated during the run. */
  messages: ChatMessage[];
  /** Optional system prompt (can also be passed to `createAgent`). */
  systemPrompt?: string;
  // — Injected by withTools / withReActLoop —
  __tools?: ToolRegistry;
  __reactOutput?: unknown;
  __toolResults?: ToolResult[];
  __reactExhausted?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// createAgent()
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateAgentOptions {
  /** Tools the agent can invoke. */
  tools: Tool[];
  /** LLM adapter — call your preferred provider here. */
  callLlm: LlmAdapter;
  /** System prompt inserted before the conversation. */
  systemPrompt?: string;
  /** Maximum think → act iterations. Defaults to 10. */
  maxIterations?: number;
}

/**
 * Create a reusable agent flow.
 *
 * Returns a `FlowBuilder<AgentState>`. Call `.run(state)` to execute.
 *
 * @example
 * const agent = createAgent({
 *   tools: [getWeather, getTime],
 *   callLlm: openAiAdapter,
 *   systemPrompt: "You are a helpful assistant.",
 * });
 *
 * const state: AgentState = { input: "What's the weather in Paris?", messages: [] };
 * await agent.run(state);
 * console.log(state.output);
 */
export function createAgent(
  options: CreateAgentOptions,
): FlowBuilder<AgentState> {
  const { tools, callLlm, systemPrompt, maxIterations = 10 } = options;

  return (
    new FlowBuilder<AgentState>()
      // 1. Register tools so shared.__tools is available to all steps.
      .withTools(tools)

      // 2. Seed the conversation with an optional system message + user input.
      .startWith((s) => {
        s.messages = [];
        const sys = systemPrompt ?? s.systemPrompt;
        if (sys) s.messages.push({ role: "system", content: sys });
        s.messages.push({ role: "user", content: s.input });
      })

      // 3. Run the ReAct loop.
      .withReActLoop({
        maxIterations,

        think: async (s): Promise<ThinkResult> => {
          const toolDefs = s.__tools!.definitions() as LlmToolDef[];
          const response = await callLlm(s.messages, toolDefs);

          if (response.toolCalls && response.toolCalls.length > 0) {
            // Append the assistant's tool-call intent to conversation history.
            s.messages.push({
              role: "assistant",
              content: "",
              tool_calls: response.toolCalls.map((tc) => ({
                id: tc.id ?? `call_${tc.name}_${Date.now()}`,
                type: "function" as const,
                function: {
                  name: tc.name,
                  arguments: JSON.stringify(tc.args),
                },
              })),
            });
            return { action: "tool", calls: response.toolCalls };
          }

          // No tool calls → the model produced a final answer.
          s.messages.push({ role: "assistant", content: response.text ?? "" });
          return { action: "finish", output: response.text };
        },

        // After each tool round, append results so the next think step has context.
        onObservation: (results, s) => {
          for (const r of results) {
            s.messages.push({
              role: "tool",
              tool_call_id: r.callId ?? r.name,
              content:
                r.error != null
                  ? `Error: ${r.error}`
                  : JSON.stringify(r.result),
            });
          }
        },
      })

      // 4. Surface the final answer.
      .then((s) => {
        s.output =
          typeof s.__reactOutput === "string"
            ? s.__reactOutput
            : JSON.stringify(s.__reactOutput ?? "");
      })
  );
}
