import type { FlowneerPlugin } from "../../Flowneer";

// ─────────────────────────────────────────────────────────────────────────────
// Channel utilities — call these from inside NodeFn step functions
// ─────────────────────────────────────────────────────────────────────────────

/** Send a message to a named channel on `shared.__channels`. */
export function sendTo<S extends Record<string, any>>(
  shared: S,
  channel: string,
  message: unknown,
): void {
  const channels: Map<string, unknown[]> =
    (shared as any).__channels ?? new Map();
  if (!(shared as any).__channels) (shared as any).__channels = channels;
  const queue = channels.get(channel) ?? [];
  if (!channels.has(channel)) channels.set(channel, queue);
  queue.push(message);
}

/** Receive (drain) all pending messages from a named channel. */
export function receiveFrom<T = unknown>(
  shared: Record<string, any>,
  channel: string,
): T[] {
  const channels: Map<string, unknown[]> | undefined = (shared as any)
    .__channels;
  if (!channels) return [];
  const queue = channels.get(channel);
  if (!queue || queue.length === 0) return [];
  const messages = [...queue] as T[];
  queue.length = 0;
  return messages;
}

/** Peek at pending messages without draining. */
export function peekChannel<T = unknown>(
  shared: Record<string, any>,
  channel: string,
): T[] {
  const channels: Map<string, unknown[]> | undefined = (shared as any)
    .__channels;
  if (!channels) return [];
  return [...(channels.get(channel) ?? [])] as T[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin
// ─────────────────────────────────────────────────────────────────────────────

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Initialise a `Map`-based message channel system on `shared.__channels`.
     * Nodes communicate via `sendTo(shared, ch, msg)` / `receiveFrom(shared, ch)`.
     */
    withChannels(): this;
  }
}

export const withChannels: FlowneerPlugin = {
  withChannels(this: any) {
    this._setHooks({
      beforeFlow: (shared: any) => {
        if (!(shared as any).__channels) {
          (shared as any).__channels = new Map<string, unknown[]>();
        }
      },
    });
    return this;
  },
};
