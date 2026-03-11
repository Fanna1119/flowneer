// ---------------------------------------------------------------------------
// approvalGate — conditional human approval / review step
// ---------------------------------------------------------------------------

import { FlowBuilder, InterruptError } from "../../Flowneer";
import type { NodeFn } from "../../Flowneer";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ApprovalGateOptions<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * Prompt to present to the human reviewer.
   * Can be a static string or a function computed from shared state.
   * Stored on `shared.__humanPrompt` before interrupting.
   *
   * @default (s) => `Approve this output?\n\n${JSON.stringify((s as any).output ?? s, null, 2)}`
   */
  prompt?: string | ((shared: S, params: P) => string | Promise<string>);
  /**
   * Optional condition — when provided, the gate only activates (interrupts)
   * when the condition returns `true`. When it returns `false`, the gate is
   * skipped entirely and the flow continues without interrupting.
   */
  condition?: (shared: S, params: P) => boolean | Promise<boolean>;
  /**
   * Called whenever the human responds with anything that isn't `"approve"`,
   * `"yes"`, or an `"edit: …"` prefix. Defaults to throwing an error.
   *
   * @default (s, feedback) => { throw new Error("Rejected by human"); }
   */
  onReject?: (shared: S, feedback?: string) => void | Promise<void>;
  /**
   * Key on `shared` where the human's response is injected when resuming.
   * Pass `{ [responseKey]: "approve" }` (or `"yes"`, `"edit: …"`) as the
   * `edits` argument to `resumeFlow`.
   *
   * @default "__approvalResponse"
   */
  responseKey?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Preset
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert a human approval / review gate into a flow.
 *
 * **First run** — throws an `InterruptError` carrying a snapshot of shared
 * state. The caller catches the error, delivers `savedShared.__humanPrompt`
 * to a human (email, Slack, UI, etc.) and then calls `resumeFlow` when the
 * human responds.
 *
 * **Resume** — the caller merges the response via `resumeFlow(flow, saved,
 * { __approvalResponse: "approve" })`. The gate step detects the response
 * key, processes the response (setting `shared.approved`, `shared.humanEdit`,
 * or `shared.humanFeedback`), cleans up, and lets the flow continue.
 *
 * Outcomes after resume:
 * - `"approve"` / `"yes"` (case-insensitive) → `shared.approved = true`
 * - `"edit: <text>"` → `shared.humanEdit = "<text>"`, `shared.approved = true`
 * - any other response → `shared.approved = false`, `shared.humanFeedback =
 *   response`, `onReject(shared, response)` called
 *
 * @example
 * ```typescript
 * import { approvalGate } from "flowneer/presets/pipeline";
 * import { InterruptError, resumeFlow } from "flowneer";
 *
 * const flow = new FlowBuilder<DraftState>()
 *   .startWith(generateDraft)
 *   .add(approvalGate({ prompt: (s) => `Review draft:\n${s.draft}` }))
 *   .then((s) => {
 *     if (!s.approved) return; // stopped by onReject or anchor jump
 *     await publish(s.draft);
 *   });
 *
 * try {
 *   await flow.run(state);
 * } catch (e) {
 *   if (e instanceof InterruptError) {
 *     console.log("Awaiting review:", e.savedShared.__humanPrompt);
 *     // later…
 *     await resumeFlow(flow, e.savedShared, { __approvalResponse: "approve" });
 *   }
 * }
 * ```
 */
export function approvalGate<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
>(options: ApprovalGateOptions<S, P> = {}): FlowBuilder<S, P> {
  const {
    prompt,
    condition,
    onReject = (_s: S, _feedback?: string) => {
      throw new Error("Rejected by human");
    },
    responseKey = "__approvalResponse",
  } = options;

  const defaultPrompt = (shared: S): string =>
    `Approve this output?\n\n${JSON.stringify((shared as any).output ?? shared, null, 2)}`;

  const gateFn: NodeFn<S, P> = async (shared: S, params: P) => {
    // ── Resume path ─────────────────────────────────────────────────────────
    const response: string | undefined = (shared as any)[responseKey];
    if (response !== undefined) {
      delete (shared as any)[responseKey];
      delete (shared as any).__humanPrompt;

      const lower = response.toLowerCase().trim();

      if (lower === "approve" || lower === "yes") {
        (shared as any).approved = true;
      } else if (lower.startsWith("edit:")) {
        (shared as any).humanEdit = response.slice(5).trim();
        (shared as any).approved = true;
      } else {
        (shared as any).approved = false;
        (shared as any).humanFeedback = response;
        await onReject(shared, response);
      }
      return;
    }

    // ── Interrupt path ───────────────────────────────────────────────────────
    if (condition) {
      const shouldInterrupt = await condition(shared, params);
      if (!shouldInterrupt) return;
    }

    const resolvedPrompt =
      typeof prompt === "function"
        ? await prompt(shared, params)
        : (prompt ?? defaultPrompt(shared));

    (shared as any).__humanPrompt = resolvedPrompt;
    throw new InterruptError(JSON.parse(JSON.stringify(shared)));
  };

  return new FlowBuilder<S, P>().then(gateFn);
}
