import { OpenAI } from "openai";
import "dotenv/config";

export interface CallLlmOptions {
  /** Enable OpenAI web search tool so the model can look up current info */
  webSearch?: boolean;
}

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }
  _client = new OpenAI({ apiKey });
  return _client;
}

export async function callLlm(
  prompt: string,
  opts: CallLlmOptions = {},
): Promise<string> {
  const client = getClient();

  if (opts.webSearch) {
    // Use Responses API with web search tool
    const r = await client.responses.create({
      model: "o4-mini",
      tools: [{ type: "web_search" }],
      input: prompt,
    });
    return r.output_text || "";
  }

  // Default: Chat Completions API (no web search)
  const r = await client.chat.completions.create({
    model: "o4-mini",
    messages: [{ role: "user", content: prompt }],
  });
  return r.choices[0]?.message?.content || "";
}

// ── Token-aware variant ─────────────────────────────────────────────────────

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CallLlmResult {
  text: string;
  usage: LlmUsage;
}

/**
 * Like `callLlm` but also returns the token counts reported by the API.
 * Only works with the Chat Completions path (no webSearch).
 */
export async function callLlmWithUsage(prompt: string): Promise<CallLlmResult> {
  const client = getClient();
  const r = await client.chat.completions.create({
    model: "o4-mini",
    messages: [{ role: "user", content: prompt }],
  });
  const usage: LlmUsage = {
    inputTokens: r.usage?.prompt_tokens ?? 0,
    outputTokens: r.usage?.completion_tokens ?? 0,
    totalTokens: r.usage?.total_tokens ?? 0,
  };
  return { text: r.choices[0]?.message?.content ?? "", usage };
}
