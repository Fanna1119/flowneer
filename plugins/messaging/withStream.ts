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
  interface AugmentedState {
    /** Active stream subscriber. Call `emit(shared, chunk)` to push to it. Written by `.withStream()`. */
    __stream?: (chunk: unknown) => void;
  }
}
/**
 * @deprecated The `withStream` plugin is deprecated and will be removed in a future release. Use the built-in streaming capabilities of Flowneer instead, which allow you to emit chunks directly from any step without needing to register a subscriber first.
 * Plugin that adds streaming capabilities to FlowBuilder.
 * Use `FlowBuilder.extend([withStream])` to create a subclass before creating any
 */
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
