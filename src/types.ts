// ---------------------------------------------------------------------------
// Flowneer — public type definitions
// ---------------------------------------------------------------------------

import type { FlowBuilder } from "./FlowBuilder";

/**
 * Generic validator interface — structurally compatible with Zod, ArkType,
 * Valibot, or any custom implementation that exposes `.parse(input)`.
 * Used by `withStructuredOutput` and output parsers.
 */
export interface Validator<T = unknown> {
  parse(input: unknown): T;
}

/**
 * Events yielded by `FlowBuilder.stream()`.
 */
export type StreamEvent<S = any> =
  | { type: "step:before"; meta: StepMeta }
  | { type: "step:after"; meta: StepMeta; shared: S }
  | { type: "chunk"; data: unknown }
  | { type: "error"; error: unknown }
  | { type: "done" };

/**
 * Function signature for all step logic.
 * Return an action string to route, or undefined/void to continue.
 *
 * Steps may also be declared as `async function*` generators — each `yield`
 * forwards its value to the active stream consumer as a `chunk` event.
 * The generator's final `return` value is still routed normally, so
 * `return "#anchorName"` works exactly as it does in plain steps.
 *
 * @example
 * .then(async function* (s) {
 *   for await (const token of llmStream(s.prompt)) {
 *     s.response += token;
 *     yield token;           // → chunk event on flow.stream()
 *   }
 * })
 */
export type NodeFn<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> = (
  shared: S,
  params: P,
) =>
  | Promise<string | undefined | void>
  | string
  | undefined
  | void
  | AsyncGenerator<unknown, string | undefined | void, unknown>;

/**
 * A numeric value or a function that computes it from the current shared state
 * and params. Use functions for dynamic per-item behaviour, e.g.
 * `retries: (s) => (s.__batchItem % 3 === 0 ? 3 : 1)`.
 */
export type NumberOrFn<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> = number | ((shared: S, params: P) => number);

export interface NodeOptions<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  retries?: NumberOrFn<S, P>;
  delaySec?: NumberOrFn<S, P>;
  timeoutMs?: NumberOrFn<S, P>;
}

export interface RunOptions {
  signal?: AbortSignal;
}

/** Metadata exposed to hooks — intentionally minimal to avoid coupling. */
export interface StepMeta {
  index: number;
  type: "fn" | "branch" | "loop" | "batch" | "parallel" | "anchor";
  label?: string;
}

/** Lifecycle hooks that plugins can register. */
export interface FlowHooks<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Fires once before the first step runs. */
  beforeFlow?: (shared: S, params: P) => void | Promise<void>;
  beforeStep?: (meta: StepMeta, shared: S, params: P) => void | Promise<void>;
  /**
   * Wraps step execution — call `next()` to invoke the step body.
   * Omitting `next()` skips execution (dry-run, mock, etc.).
   * Multiple `wrapStep` registrations are composed innermost-first.
   */
  wrapStep?: (
    meta: StepMeta,
    next: () => Promise<void>,
    shared: S,
    params: P,
  ) => Promise<void>;
  afterStep?: (meta: StepMeta, shared: S, params: P) => void | Promise<void>;
  /**
   * Wraps individual functions within a `.parallel()` step.
   * `fnIndex` is the position within the fns array.
   */
  wrapParallelFn?: (
    meta: StepMeta,
    fnIndex: number,
    next: () => Promise<void>,
    shared: S,
    params: P,
  ) => Promise<void>;
  onError?: (meta: StepMeta, error: unknown, shared: S, params: P) => void;
  afterFlow?: (shared: S, params: P) => void | Promise<void>;
}

/**
 * A plugin is an object whose keys become methods on `FlowBuilder.prototype`.
 * Each method receives the builder as `this` and should return `this` for chaining.
 *
 * Use declaration merging to get type-safe access:
 * ```ts
 * declare module "flowneer" {
 *   interface FlowBuilder<S, P> { withTracing(fn: TraceCallback): this; }
 * }
 * ```
 */
export type FlowneerPlugin = Record<
  string,
  (this: FlowBuilder<any, any>, ...args: any[]) => any
>;
