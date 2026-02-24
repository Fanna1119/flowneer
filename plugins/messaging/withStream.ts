import type { FlowBuilder, FlowneerPlugin } from "../../Flowneer";

/** Callback invoked each time a step calls `emit()`. */
export type StreamSubscriber<T = unknown> = (chunk: T) => void;

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Registers a streaming subscriber for this flow.
     * Steps call `emit(shared, chunk)` to push data to the subscriber in real-time.
     * The subscriber is stored on `shared.__stream` before the first step runs
     * so it is automatically inherited by sub-flows (loop, batch, etc.).
     *
     * @example
     * const flow = new FlowBuilder<MyState>()
     *   .withStream((chunk) => console.log("[stream]", chunk))
     *   // ...
     *
     * // Inside a step:
     * emit(s, { type: "draft", content: s.draft });
     */
    withStream<T = unknown>(subscriber: StreamSubscriber<T>): this;
  }
}

export const withStream: FlowneerPlugin = {
  withStream(this: FlowBuilder<any, any>, subscriber: StreamSubscriber) {
    (this as any)._setHooks({
      beforeFlow: (shared: any) => {
        shared.__stream = subscriber;
      },
    });
    return this;
  },
};

/**
 * Push a chunk to the subscriber registered via `.withStream()`.
 * Safe to call unconditionally — silently no-ops when no subscriber is registered.
 *
 * @example
 * async function refineDraft(s: MyState) {
 *   // ... produce s.draft ...
 *   emit(s, { type: "draft", round: s.round, content: s.draft });
 * }
 */
export function emit<T = unknown>(
  shared: { __stream?: StreamSubscriber<T> },
  chunk: T,
): void {
  shared.__stream?.(chunk);
}
