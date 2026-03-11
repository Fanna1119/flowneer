// ---------------------------------------------------------------------------
// clarifyLoop — generate → evaluate → interrupt for clarification → retry
// ---------------------------------------------------------------------------

import { FlowBuilder, InterruptError } from "../../Flowneer";
import type { NodeFn } from "../../Flowneer";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ClarifyLoopOptions<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * The generation step — produces `shared.output` (or whatever key your
   * state uses). On subsequent rounds, `shared.humanClarification` holds the
   * human's last clarification so it can be incorporated into the prompt.
   */
  generateStep: NodeFn<S, P>;
  /**
   * Maximum number of clarification rounds before the preset falls
   * through without interrupting, even if `evaluateFn` still returns true.
   *
   * @default 3
   */
  maxRounds?: number;
  /**
   * Returns `true` when the generated output needs human clarification.
   * Called after every `generateStep` invocation.
   *
   * @default (s) => (s as any).confidence < 0.7 || String((s as any).output ?? "").includes("unclear")
   */
  evaluateFn?: (shared: S, params: P) => boolean | Promise<boolean>;
  /**
   * Prompt to present to the human when clarification is needed.
   * Can be a static string or a function computed from shared state.
   * Stored on `shared.__humanPrompt` before interrupting.
   *
   * @default (s) => `The output is unclear or low-confidence. Please clarify:\n${(s as any).output ?? ""}`
   */
  clarifyPrompt?: string | ((shared: S, params: P) => string | Promise<string>);
}

// ─────────────────────────────────────────────────────────────────────────────
// Preset
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Refinement loop: run `generateStep`, evaluate the output, and — if the
 * evaluation fails — pause for human clarification, then regenerate.
 *
 * **First run** — `generateStep` runs. If `evaluateFn` returns `true` and
 * `maxRounds` has not been reached, `shared.__humanPrompt` is set and an
 * `InterruptError` is thrown.
 *
 * **Resume** — the caller merges the human's clarification via
 * `resumeFlow(flow, saved, { humanClarification: "…" })`. The flow
 * re-runs from the start: `__clarifyRounds` is preserved (via `??=`),
 * `generateStep` re-runs with `humanClarification` set, and the
 * evaluation step checks again.
 *
 * The loop exits normally (without interrupting) when either:
 * - `evaluateFn` returns `false` (output is satisfactory), or
 * - `maxRounds` clarification rounds have been exhausted.
 *
 * @example
 * ```typescript
 * import { clarifyLoop } from "flowneer/presets/pipeline";
 * import { InterruptError } from "flowneer";
 * import { resumeFlow } from "flowneer/plugins/agent";
 *
 * interface QueryState {
 *   query: string;
 *   output: string;
 *   confidence: number;
 *   humanClarification?: string;
 * }
 *
 * const flow = clarifyLoop<QueryState>({
 *   generateStep: async (s) => {
 *     const prompt = s.humanClarification
 *       ? `${s.query}\nAdditional context: ${s.humanClarification}`
 *       : s.query;
 *     const result = await llm(prompt);
 *     s.output = result.text;
 *     s.confidence = result.confidence;
 *   },
 *   evaluateFn: (s) => s.confidence < 0.8,
 *   maxRounds: 2,
 * });
 *
 * try {
 *   await flow.run(state);
 * } catch (e) {
 *   if (e instanceof InterruptError) {
 *     console.log("Needs clarification:", e.savedShared.__humanPrompt);
 *     // later…
 *     await resumeFlow(flow, e.savedShared, { humanClarification: "…" });
 *   }
 * }
 * ```
 */
export function clarifyLoop<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
>(options: ClarifyLoopOptions<S, P>): FlowBuilder<S, P> {
  const { generateStep, maxRounds = 3, evaluateFn, clarifyPrompt } = options;

  const defaultEvaluateFn = (shared: S): boolean => {
    const s = shared as any;
    return (
      (typeof s.confidence === "number" && s.confidence < 0.7) ||
      String(s.output ?? "").includes("unclear")
    );
  };

  const evaluate = evaluateFn ?? defaultEvaluateFn;

  const defaultClarifyPrompt = (shared: S): string => {
    const s = shared as any;
    return `The output is unclear or low-confidence. Please clarify:\n${s.output ?? ""}`;
  };

  // Step 1 — initialise / preserve the round counter across resume cycles
  const initFn: NodeFn<S, P> = (shared: S) => {
    (shared as any).__clarifyRounds ??= 0;
  };

  // Step 2 — user-defined generation step (passed through as-is)

  // Step 3 — evaluate and optionally interrupt for clarification
  const evaluateFnStep: NodeFn<S, P> = async (shared: S, params: P) => {
    const rounds: number = (shared as any).__clarifyRounds;

    if (rounds >= maxRounds) return; // exhausted — fall through

    const needsClarification = await evaluate(shared, params);
    if (!needsClarification) return; // satisfied — fall through

    // Needs another round
    (shared as any).__clarifyRounds = rounds + 1;

    const resolvedPrompt =
      typeof clarifyPrompt === "function"
        ? await clarifyPrompt(shared, params)
        : (clarifyPrompt ?? defaultClarifyPrompt(shared));

    (shared as any).__humanPrompt = resolvedPrompt;
    throw new InterruptError(JSON.parse(JSON.stringify(shared)));
  };

  // Step 4 — cleanup internal state once the loop exits normally
  const cleanupFn: NodeFn<S, P> = (shared: S) => {
    delete (shared as any).__clarifyRounds;
    delete (shared as any).__humanPrompt;
  };

  return new FlowBuilder<S, P>()
    .startWith(initFn)
    .then(generateStep)
    .then(evaluateFnStep)
    .then(cleanupFn);
}
