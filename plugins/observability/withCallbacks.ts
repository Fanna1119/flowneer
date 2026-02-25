// ---------------------------------------------------------------------------
// withCallbacks — expanded lifecycle callbacks for LLM / tool / agent events
// ---------------------------------------------------------------------------
// Maps onto existing beforeStep/afterStep/onError hooks by inspecting
// StepMeta.label conventions.
//
// Label conventions:
//   "llm:*"    → onLLMStart / onLLMEnd
//   "tool:*"   → onToolStart / onToolEnd
//   "agent:*"  → onAgentAction / onAgentFinish
//
// Steps without a label prefix still fire onChainStart / onChainEnd.
// ---------------------------------------------------------------------------

import type { FlowBuilder, FlowneerPlugin, StepMeta } from "../../Flowneer";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CallbackHandlers<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  onLLMStart?: (meta: StepMeta, shared: S, params: P) => void | Promise<void>;
  onLLMEnd?: (meta: StepMeta, shared: S, params: P) => void | Promise<void>;
  onToolStart?: (meta: StepMeta, shared: S, params: P) => void | Promise<void>;
  onToolEnd?: (meta: StepMeta, shared: S, params: P) => void | Promise<void>;
  onAgentAction?: (
    meta: StepMeta,
    shared: S,
    params: P,
  ) => void | Promise<void>;
  onAgentFinish?: (
    meta: StepMeta,
    shared: S,
    params: P,
  ) => void | Promise<void>;
  onChainStart?: (meta: StepMeta, shared: S, params: P) => void | Promise<void>;
  onChainEnd?: (meta: StepMeta, shared: S, params: P) => void | Promise<void>;
  onError?: (meta: StepMeta, error: unknown, shared: S, params: P) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

type Prefix = "llm" | "tool" | "agent" | null;

function getPrefix(meta: StepMeta): Prefix {
  const label = meta.label;
  if (!label) return null;
  if (label.startsWith("llm:")) return "llm";
  if (label.startsWith("tool:")) return "tool";
  if (label.startsWith("agent:")) return "agent";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin
// ─────────────────────────────────────────────────────────────────────────────

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Register expanded lifecycle callbacks.
     *
     * Callbacks are dispatched based on the `label` field in `StepMeta`:
     *
     * | Label prefix | Before callback | After callback     |
     * |:-------------|:----------------|:-------------------|
     * | `"llm:*"`    | `onLLMStart`    | `onLLMEnd`         |
     * | `"tool:*"`   | `onToolStart`   | `onToolEnd`        |
     * | `"agent:*"`  | `onAgentAction` | `onAgentFinish`    |
     * | (other/none) | `onChainStart`  | `onChainEnd`       |
     *
     * Set labels via `NodeOptions` or dynamically via other plugins.
     *
     * @example
     * flow.withCallbacks({
     *   onLLMStart: (meta) => console.log(`LLM step ${meta.index} starting`),
     *   onLLMEnd: (meta, s) => console.log(`LLM done, tokens: ${s.tokensUsed}`),
     *   onError: (meta, err) => console.error(`Step ${meta.index} failed:`, err),
     * });
     */
    withCallbacks(handlers: CallbackHandlers<S, P>): this;
  }
}

export const withCallbacks: FlowneerPlugin = {
  withCallbacks(this: FlowBuilder<any, any>, handlers: CallbackHandlers) {
    (this as any)._setHooks({
      beforeStep: async (meta: StepMeta, shared: any, params: any) => {
        const prefix = getPrefix(meta);
        switch (prefix) {
          case "llm":
            await handlers.onLLMStart?.(meta, shared, params);
            break;
          case "tool":
            await handlers.onToolStart?.(meta, shared, params);
            break;
          case "agent":
            await handlers.onAgentAction?.(meta, shared, params);
            break;
          default:
            await handlers.onChainStart?.(meta, shared, params);
        }
      },
      afterStep: async (meta: StepMeta, shared: any, params: any) => {
        const prefix = getPrefix(meta);
        switch (prefix) {
          case "llm":
            await handlers.onLLMEnd?.(meta, shared, params);
            break;
          case "tool":
            await handlers.onToolEnd?.(meta, shared, params);
            break;
          case "agent":
            await handlers.onAgentFinish?.(meta, shared, params);
            break;
          default:
            await handlers.onChainEnd?.(meta, shared, params);
        }
      },
      onError: (meta: StepMeta, error: unknown, shared: any, params: any) => {
        handlers.onError?.(meta, error, shared, params);
      },
    });
    return this;
  },
};
