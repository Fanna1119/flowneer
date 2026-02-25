// ---------------------------------------------------------------------------
// withReActLoop — built-in ReAct / tool-calling agent loop
// ---------------------------------------------------------------------------
// Replaces manual while-loops like those in examples/clawneer.ts.
//
//   thought → action → observation → repeat until FINISH or maxIterations
// ---------------------------------------------------------------------------

import type { FlowBuilder, FlowneerPlugin, NodeFn } from "../../Flowneer";
import type { ToolCall, ToolResult } from "../tools/withTools";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The result of a `think` function.
 *
 * - Return `{ action: "finish", output }` to end the loop.
 * - Return `{ action: "tool", calls }` to invoke tools, the results of
 *   which will be available in `shared.__toolResults` on the next iteration.
 */
export type ThinkResult =
  | { action: "finish"; output?: unknown }
  | { action: "tool"; calls: ToolCall[] };

export interface ReActLoopOptions<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * The "think" step — receives shared state (which includes tool results
   * from the previous iteration) and returns the next action.
   */
  think: (shared: S, params: P) => ThinkResult | Promise<ThinkResult>;
  /**
   * Maximum number of think → act iterations. Defaults to 10.
   * When exceeded the loop breaks and `shared.__reactExhausted = true`.
   */
  maxIterations?: number;
  /**
   * Optional callback invoked after each tool execution round.
   * Useful for logging, appending to conversation history, etc.
   */
  onObservation?: (
    results: ToolResult[],
    shared: S,
    params: P,
  ) => void | Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin
// ─────────────────────────────────────────────────────────────────────────────

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Inserts a ReAct agent loop into the flow.
     *
     * The loop runs `think → [tool calls] → observation → repeat` until
     * the think step returns `{ action: "finish" }` or `maxIterations`
     * is reached.
     *
     * Requires `.withTools(tools)` to have been called first so that
     * `shared.__tools` is available.
     *
     * @example
     * flow
     *   .withTools([calculatorTool, searchTool])
     *   .withReActLoop({
     *     think: async (s) => {
     *       const response = await callLlm(buildPrompt(s));
     *       if (response.toolCalls.length) {
     *         return { action: "tool", calls: response.toolCalls };
     *       }
     *       return { action: "finish", output: response.text };
     *     },
     *     maxIterations: 5,
     *   })
     */
    withReActLoop(options: ReActLoopOptions<S, P>): this;
  }
}

export const withReActLoop: FlowneerPlugin = {
  withReActLoop(this: FlowBuilder<any, any>, options: ReActLoopOptions) {
    const { think, maxIterations = 10, onObservation } = options;

    // Use a loop + branch to implement the ReAct cycle
    let iterations = 0;

    this.loop(
      (shared: any) => {
        // Continue while not finished and under the iteration cap
        return !shared.__reactFinished && iterations < maxIterations;
      },
      (b: FlowBuilder<any, any>) => {
        b.startWith(async (shared: any, params: any) => {
          iterations++;
          const result = await think(shared, params);

          if (result.action === "finish") {
            shared.__reactFinished = true;
            shared.__reactOutput = result.output;
            return;
          }

          // Tool-calling path
          shared.__pendingToolCalls = result.calls;
        }).then(async (shared: any, params: any) => {
          if (shared.__reactFinished) return;

          const calls: ToolCall[] = shared.__pendingToolCalls ?? [];
          if (calls.length === 0) return;

          // Execute tools via the registry
          const registry = shared.__tools;
          if (!registry) {
            throw new Error(
              "withReActLoop requires .withTools() — no tool registry found on shared.__tools",
            );
          }

          const results: ToolResult[] = await registry.executeAll(calls);
          shared.__toolResults = results;
          delete shared.__pendingToolCalls;

          if (onObservation) {
            await onObservation(results, shared, params);
          }
        });
      },
    );

    // Post-loop step: mark exhaustion if we hit the cap
    this.then((shared: any) => {
      if (!shared.__reactFinished) {
        shared.__reactExhausted = true;
      }
      // Clean up internal flags
      delete shared.__reactFinished;
      delete shared.__pendingToolCalls;
    });

    return this;
  },
};
