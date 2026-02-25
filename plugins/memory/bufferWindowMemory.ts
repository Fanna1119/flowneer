// ---------------------------------------------------------------------------
// BufferWindowMemory — keeps the last `k` messages
// ---------------------------------------------------------------------------

import type { Memory, MemoryMessage } from "./types";

export interface BufferWindowOptions {
  /** Maximum number of messages to retain. Defaults to 20. */
  maxMessages?: number;
}

export class BufferWindowMemory implements Memory {
  private messages: MemoryMessage[] = [];
  private readonly max: number;

  constructor(options?: BufferWindowOptions) {
    this.max = options?.maxMessages ?? 20;
  }

  add(message: MemoryMessage): void {
    this.messages.push(message);
    if (this.messages.length > this.max) {
      this.messages = this.messages.slice(-this.max);
    }
  }

  get(): MemoryMessage[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }

  toContext(): string {
    return this.messages.map((m) => `${m.role}: ${m.content}`).join("\n");
  }
}
