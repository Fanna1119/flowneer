// ---------------------------------------------------------------------------
// agentExample — LangChain-style tool() + createAgent() built on Flowneer
// ---------------------------------------------------------------------------
//
// This example recreates the ergonomics of LangChain's pattern:
//
//   const getWeather = tool(({ city }) => `Sunny in ${city}!`, {
//     name: "get_weather",
//     description: "Get the weather for a given city",
//     schema: z.object({ city: z.string() }),       // Zod schema
//   });
//
//   const agent = createAgent({ tools: [getWeather], callLlm: openAiAdapter });
//   await agent.run(state);
//
// Key differences from LangChain:
//   • `createAgent` returns a FlowBuilder — call .run(shared) to execute.
//   • `callLlm` is a user-supplied adapter — keeps the factory LLM-agnostic.
//   • `tool()` accepts either a Zod-compatible `schema` or plain `params`
//     (the existing Flowneer ToolParam shape) — both styles work identically.
//
// Run with:  bun run examples/agentExample.ts
// Requires:  OPENAI_API_KEY environment variable
// ---------------------------------------------------------------------------

import "dotenv/config";
import { OpenAI } from "openai";
import { tool, createAgent } from "../plugins/agent";
import type { LlmAdapter, LlmResponse, AgentState } from "../plugins/agent";

// ─────────────────────────────────────────────────────────────────────────────
// Concrete OpenAI adapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an `LlmAdapter` backed by OpenAI Chat Completions.
 *
 * @example
 * const callLlm = makeOpenAiAdapter({ model: "gpt-4o" });
 */
export function makeOpenAiAdapter(opts: {
  model?: string;
  apiKey?: string;
}): LlmAdapter {
  const openai = new OpenAI({
    apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY,
  });
  const model = opts.model ?? "gpt-4o-mini";

  return async (messages, toolDefs): Promise<LlmResponse> => {
    const oaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = toolDefs.map(
      (t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters as Record<string, unknown>,
        },
      }),
    );

    const response = await openai.chat.completions.create({
      model,
      messages:
        messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      tools: oaiTools.length > 0 ? oaiTools : undefined,
      tool_choice: oaiTools.length > 0 ? "auto" : undefined,
    });

    const choice = response.choices[0]!.message;

    if (choice.tool_calls && choice.tool_calls.length > 0) {
      return {
        toolCalls: choice.tool_calls
          .filter(
            (
              tc,
            ): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
              tc.type === "function",
          )
          .map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments) as Record<string, unknown>,
          })),
      };
    }

    return { text: choice.content ?? "" };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Example tools
// ─────────────────────────────────────────────────────────────────────────────

// --- Using a Zod-compatible schema (mimics LangChain's pattern) ---
// In a real project you'd: import { z } from "zod";
// Here we construct a minimal Zod-like shape manually so this file has
// zero extra dependencies. Replace with real Zod if you prefer.
const fakeZodString = (description?: string) => ({
  _def: { typeName: "ZodString", description },
  isOptional: () => false,
});

const getWeather = tool(
  ({ city }: { city: string }) => {
    // In production, call a real weather API here.
    return `It's always sunny in ${city}! (mock response)`;
  },
  {
    name: "get_weather",
    description: "Get the current weather for a given city",
    schema: {
      shape: {
        city: fakeZodString("The name of the city to get weather for"),
      },
    },
  },
);

// --- Using plain ToolParam (existing Flowneer style) ---
const getTime = tool(() => new Date().toUTCString(), {
  name: "get_time",
  description: "Get the current UTC date and time",
  params: {},
});

// ─────────────────────────────────────────────────────────────────────────────
// Usage — mirrors LangChain's createAgent pattern
// ─────────────────────────────────────────────────────────────────────────────

const agent = createAgent({
  tools: [getWeather, getTime],
  callLlm: makeOpenAiAdapter({ model: "gpt-4o-mini" }),
  systemPrompt:
    "You are a helpful assistant. Use the available tools when needed.",
  maxIterations: 5,
});

const state: AgentState = {
  input: "What's the weather in Paris right now, and what time is it?",
  messages: [],
};

console.log("Running agent with input:", state.input);
await agent.run(state);
console.log("\nAgent output:", state.output);
