// ---------------------------------------------------------------------------
// SummaryMemory — summarises older messages when the buffer grows too large
// ---------------------------------------------------------------------------

import type { Memory, MemoryMessage } from "./types";

export interface SummaryMemoryOptions {
  /**
   * Maximum number of recent messages to keep verbatim.
   * When this limit is exceeded the oldest messages are passed to
   * `summarize` and replaced by a single system-summary message.
   * Defaults to 10.
   */
  maxMessages?: number;
  /**
   * User-supplied summarisation function.
   * Receives the messages to compress and should return a concise prose summary.
   *
   * Typically calls an LLM, but can be any async function.
   */
  summarize: (messages: MemoryMessage[]) => string | Promise<string>;
}

export class SummaryMemory implements Memory {
  private messages: MemoryMessage[] = [];
  private runningSummary: string = "";
  private readonly max: number;
  private readonly summarize: SummaryMemoryOptions["summarize"];

  constructor(options: SummaryMemoryOptions) {
    this.max = options.maxMessages ?? 10;
    this.summarize = options.summarize;
  }

  async add(message: MemoryMessage): Promise<void> {
    this.messages.push(message);
    if (this.messages.length > this.max) {
      // Compress the oldest half into the running summary
      const half = Math.ceil(this.messages.length / 2);
      const toCompress = this.messages.slice(0, half);
      this.messages = this.messages.slice(half);

      const previousContext = this.runningSummary
        ? `Previous summary:\n${this.runningSummary}\n\n`
        : "";
      const block = toCompress.map((m) => `${m.role}: ${m.content}`).join("\n");
      this.runningSummary = await this.summarize([
        {
          role: "system",
          content: `${previousContext}Conversation so far:\n${block}`,
        },
      ]);
    }
  }

  get(): MemoryMessage[] {
    const result: MemoryMessage[] = [];
    if (this.runningSummary) {
      result.push({
        role: "system",
        content: `[Summary] ${this.runningSummary}`,
      });
    }
    result.push(...this.messages);
    return result;
  }

  clear(): void {
    this.messages = [];
    this.runningSummary = "";
  }

  toContext(): string {
    const parts: string[] = [];
    if (this.runningSummary) {
      parts.push(`[Summary] ${this.runningSummary}`);
    }
    for (const m of this.messages) {
      parts.push(`${m.role}: ${m.content}`);
    }
    return parts.join("\n");
  }
}
