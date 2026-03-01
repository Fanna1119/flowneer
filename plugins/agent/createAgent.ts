// ---------------------------------------------------------------------------
// createAgent — LangChain-style tool() + createAgent() factory
// ---------------------------------------------------------------------------
//
// Provides two ergonomic entry-points that mirror LangChain's API:
//
//   const getWeather = tool(
//     ({ city }) => `Sunny in ${city}!`,
//     {
//       name: "get_weather",
//       description: "Get the weather for a given city",
//       schema: z.object({ city: z.string() }),   // Zod or plain params
//     },
//   );
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
import { withTools } from "../tools";
import { withReActLoop } from "./withReActLoop";
import type {
  Tool,
  ToolParam,
  ToolCall,
  ToolResult,
  ToolRegistry,
} from "../tools";
import type { ThinkResult } from "./withReActLoop";

FlowBuilder.use(withTools);
FlowBuilder.use(withReActLoop);

// ─────────────────────────────────────────────────────────────────────────────
// Zod duck-type helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal structural interface that matches a Zod ZodObject.
 * We duck-type against `.shape` so this plugin has zero Zod dependency —
 * pass a real `z.object(...)` and it just works.
 */
export interface ZodLikeObject {
  shape: Record<
    string,
    {
      _def: { typeName: string; description?: string };
      isOptional?(): boolean;
    }
  >;
}

function zodTypeToParamType(typeName: string): ToolParam["type"] {
  switch (typeName) {
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodObject":
      return "object";
    case "ZodArray":
      return "array";
    default:
      return "string";
  }
}

function zodSchemaToParams(schema: ZodLikeObject): Record<string, ToolParam> {
  const params: Record<string, ToolParam> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    params[key] = {
      type: zodTypeToParamType(field._def.typeName),
      description: field._def.description ?? key,
      required: field.isOptional ? !field.isOptional() : true,
    };
  }
  return params;
}

// ─────────────────────────────────────────────────────────────────────────────
// tool() — LangChain-style tool factory
// ─────────────────────────────────────────────────────────────────────────────

/** Config when using a Zod-compatible schema. */
export interface ToolConfigSchema<TArgs> {
  name: string;
  description: string;
  schema: ZodLikeObject;
  execute?: (args: TArgs) => unknown | Promise<unknown>;
}

/** Config when using plain Flowneer ToolParam definitions. */
export interface ToolConfigParams<TArgs> {
  name: string;
  description: string;
  params: Record<string, ToolParam>;
  execute?: (args: TArgs) => unknown | Promise<unknown>;
}

export type ToolConfig<TArgs> =
  | ToolConfigSchema<TArgs>
  | ToolConfigParams<TArgs>;

function isSchemaConfig<TArgs>(
  cfg: ToolConfig<TArgs>,
): cfg is ToolConfigSchema<TArgs> {
  return "schema" in cfg && cfg.schema != null;
}

/**
 * Create a Flowneer `Tool` from an execute function + config.
 *
 * Mirrors LangChain's `tool()` factory. Accepts either:
 * - `schema: z.object(...)` — a Zod-compatible schema (duck-typed, no import needed)
 * - `params: Record<string, ToolParam>` — plain Flowneer param definitions
 *
 * @example
 * // With Zod schema:
 * const getWeather = tool(
 *   ({ city }) => `Always sunny in ${city}!`,
 *   {
 *     name: "get_weather",
 *     description: "Get the weather for a given city",
 *     schema: z.object({ city: z.string().describe("The city name") }),
 *   },
 * );
 *
 * // With plain params:
 * const getTime = tool(
 *   () => new Date().toISOString(),
 *   {
 *     name: "get_time",
 *     description: "Get the current UTC time",
 *     params: {},
 *   },
 * );
 */
export function tool<TArgs = Record<string, unknown>>(
  execute: (args: TArgs) => unknown | Promise<unknown>,
  config: ToolConfig<TArgs>,
): Tool<TArgs> {
  const params = isSchemaConfig(config)
    ? zodSchemaToParams(config.schema)
    : config.params;

  return {
    name: config.name,
    description: config.description,
    params,
    execute,
  };
}

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
