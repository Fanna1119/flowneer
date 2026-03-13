// ---------------------------------------------------------------------------
// Flowneer — shared internal utilities
// ---------------------------------------------------------------------------

import type { NumberOrFn, StepMeta, StepFilter } from "../types";
import type { Step } from "../steps";

export function matchesFilter(filter: StepFilter, meta: StepMeta): boolean {
  if (!Array.isArray(filter)) return filter(meta);

  const label = meta.label;
  if (label === undefined) return false;

  return filter.some((p) =>
    p.includes("*")
      ? new RegExp(
          "^" +
            p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") +
            "$",
        ).test(label)
      : p === label,
  );
}

export function resolveNumber<S, P extends Record<string, unknown>>(
  val: NumberOrFn<S, P> | undefined,
  fallback: number,
  shared: S,
  params: P,
): number {
  if (val === undefined) return fallback;
  return typeof val === "function" ? val(shared, params) : val;
}

export async function retry<T>(
  times: number,
  delaySec: number,
  fn: () => Promise<T> | T,
): Promise<T> {
  if (times === 1) return fn(); // fast path
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (!--times) throw err;
      if (delaySec > 0)
        await new Promise((r) => setTimeout(r, delaySec * 1000));
    }
  }
}

export function withTimeout<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    fn().finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`step timed out after ${ms}ms`)),
        ms,
      );
    }),
  ]);
}

export const isAnchorTarget = (value: unknown): value is string =>
  typeof value === "string" && value[0] === "#";

/**
 * Drive a fn step's result to completion.
 *
 * - If the result is an async generator, iterates it manually so each yielded
 *   value is forwarded to `__stream` and the final return value can route.
 * - Otherwise treats a `"#anchor"` string return as a goto target.
 *
 * Returns the anchor name (without `#`) to jump to, or `undefined`.
 */
export async function runFnResult<S>(
  result: unknown,
  shared: S,
): Promise<string | undefined> {
  if (
    result != null &&
    typeof (result as any)[Symbol.asyncIterator] === "function"
  ) {
    const gen = result as AsyncGenerator<
      unknown,
      string | undefined | void,
      unknown
    >;
    let next = await gen.next();
    while (!next.done) {
      (shared as any).__stream?.(next.value);
      next = await gen.next();
    }
    return isAnchorTarget(next.value) ? next.value.slice(1) : undefined;
  }
  return isAnchorTarget(result) ? result.slice(1) : undefined;
}

export function buildAnchorMap<S, P extends Record<string, unknown>>(
  steps: Step<S, P>[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (s.type === "anchor") map.set(s.name, i);
  }
  return map;
}
