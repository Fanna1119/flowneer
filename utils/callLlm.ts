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
