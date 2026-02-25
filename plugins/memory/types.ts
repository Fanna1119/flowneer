// ---------------------------------------------------------------------------
// Memory abstractions — shared types
// ---------------------------------------------------------------------------

/** A single message in conversational memory. */
export interface MemoryMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Optional metadata (tool call IDs, timestamps, etc.). */
  meta?: Record<string, unknown>;
}

/**
 * A conversational memory store.
 *
 * Implementations decide how messages are stored, pruned, and summarised.
 * All methods may be sync or async to support both in-memory and persistent
 * backends.
 */
export interface Memory {
  /** Add a message to memory. */
  add(message: MemoryMessage): void | Promise<void>;
  /** Return the current messages (after any pruning/summarisation). */
  get(): MemoryMessage[] | Promise<MemoryMessage[]>;
  /** Remove all messages. */
  clear(): void | Promise<void>;
  /**
   * Serialise memory into a string suitable for an LLM context window.
   * This is a convenience — callers can also iterate `get()` manually.
   */
  toContext(): string | Promise<string>;
}
