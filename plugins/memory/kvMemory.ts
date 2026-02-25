// ---------------------------------------------------------------------------
// KVMemory — key-value episodic memory store
// ---------------------------------------------------------------------------

import type { Memory, MemoryMessage } from "./types";

/**
 * A simple key-value memory store for episodic / entity facts.
 *
 * Unlike `BufferWindowMemory` this is not a message log — it stores
 * discrete facts (entities, user preferences, extracted knowledge)
 * that persist across turns and can be serialised into context.
 *
 * Also implements `Memory` so it can be used with `withMemory()`.
 */
export class KVMemory implements Memory {
  private store = new Map<string, string>();

  /** Store a key-value pair. Overwrites if key exists. */
  set(key: string, value: string): void {
    this.store.set(key, value);
  }

  /** Retrieve a value by key. Returns `undefined` if not found. */
  getValue(key: string): string | undefined {
    return this.store.get(key);
  }

  /** Delete a key. Returns `true` if the key existed. */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /** List all stored keys. */
  keys(): string[] {
    return [...this.store.keys()];
  }

  /** Number of entries. */
  get size(): number {
    return this.store.size;
  }

  // ── Memory interface ────────────────────────────────────────────────────

  /**
   * For `Memory` compatibility — adds the message content as a key-value
   * pair using the format `"msg_{index}"`.
   */
  add(message: MemoryMessage): void {
    const key = `msg_${this.store.size}`;
    this.store.set(key, message.content);
  }

  get(): MemoryMessage[] {
    return [...this.store.entries()].map(([key, value]) => ({
      role: "system" as const,
      content: `${key}: ${value}`,
    }));
  }

  clear(): void {
    this.store.clear();
  }

  toContext(): string {
    if (this.store.size === 0) return "";
    const lines: string[] = [];
    for (const [key, value] of this.store) {
      lines.push(`- ${key}: ${value}`);
    }
    return lines.join("\n");
  }

  /** Serialise the entire store to a JSON string. */
  toJSON(): string {
    return JSON.stringify(Object.fromEntries(this.store));
  }

  /** Restore from a JSON string produced by `toJSON()`. */
  static fromJSON(json: string): KVMemory {
    const kv = new KVMemory();
    const obj = JSON.parse(json);
    for (const [k, v] of Object.entries(obj)) {
      kv.set(k, String(v));
    }
    return kv;
  }
}
