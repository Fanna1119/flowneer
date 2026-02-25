// ---------------------------------------------------------------------------
// withHumanNode — ergonomic human-in-the-loop pause / resume
// ---------------------------------------------------------------------------

import { InterruptError, FlowBuilder } from "../../Flowneer";
import type { FlowneerPlugin, NodeFn } from "../../Flowneer";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface HumanNodeOptions<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * Key on `shared` where the prompt / question for the human is stored.
   * The step will set `shared[promptKey]` before interrupting so the
   * caller knows what input is expected.
   * Defaults to `"__humanPrompt"`.
   */
  promptKey?: string;
  /**
   * Optional condition — when provided, the node only interrupts when
   * the condition returns `true`. Defaults to always interrupt.
   */
  condition?: (shared: S, params: P) => boolean | Promise<boolean>;
  /**
   * Optional prompt message to store on `shared[promptKey]` before
   * interrupting. If omitted, step uses whatever is already on shared.
   */
  prompt?: string | ((shared: S, params: P) => string | Promise<string>);
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin
// ─────────────────────────────────────────────────────────────────────────────

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Insert a human-in-the-loop pause point.
     *
     * When this step executes it throws an `InterruptError` carrying a
     * deep clone of `shared`. The caller catches the interrupt, obtains
     * human input, and calls `resumeFlow()` to continue.
     *
     * @example
     * const flow = new FlowBuilder<MyState>()
     *   .startWith(generateDraft)
     *   .humanNode({ prompt: "Please review the draft above." })
     *   .then(applyFeedback);
     *
     * try {
     *   await flow.run(shared);
     * } catch (e) {
     *   if (e instanceof InterruptError) {
     *     const userInput = await getUserInput(e.savedShared.__humanPrompt);
     *     await resumeFlow(flow, e.savedShared, { feedback: userInput }, 2);
     *   }
     * }
     */
    humanNode(options?: HumanNodeOptions<S, P>): this;
  }
}

export const withHumanNode: FlowneerPlugin = {
  humanNode(this: any, options?: HumanNodeOptions) {
    const promptKey = options?.promptKey ?? "__humanPrompt";
    const condition = options?.condition;
    const prompt = options?.prompt;

    const humanFn: NodeFn = async (shared: any, params: any) => {
      // Check condition if present
      if (condition) {
        const shouldInterrupt = await condition(shared, params);
        if (!shouldInterrupt) return; // skip — no human input needed
      }

      // Store prompt
      if (prompt) {
        shared[promptKey] =
          typeof prompt === "function" ? await prompt(shared, params) : prompt;
      }

      throw new InterruptError(JSON.parse(JSON.stringify(shared)));
    };

    return this.then(humanFn);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Resume helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resume a flow from an `InterruptError`.
 *
 * Merges `edits` into the saved shared state, then re-runs the flow
 * starting from step `fromStep` (defaults to 0, which replays from
 * the beginning — combine with `withReplay(fromStep)` to skip already-
 * completed steps).
 *
 * @param flow   The same FlowBuilder instance that was interrupted.
 * @param saved  The `savedShared` captured by `InterruptError`.
 * @param edits  Partial state to merge (human's input / corrections).
 * @param fromStep  Step index to effectively resume from (uses `withReplay`).
 */
export async function resumeFlow<S extends Record<string, any>>(
  flow: FlowBuilder<S, any>,
  saved: S,
  edits?: Partial<S>,
  fromStep?: number,
): Promise<void> {
  const merged = { ...saved, ...edits } as S;

  if (fromStep !== undefined && fromStep > 0) {
    // Dynamically apply replay to skip completed steps
    // We import lazily so the persistence plugin is optional
    const { withReplay } = await import("../persistence/withReplay");
    FlowBuilder.use(withReplay);
    (flow as any).withReplay(fromStep);
  }

  return flow.run(merged);
}
