// ---------------------------------------------------------------------------
// evaluatorOptimizer — DSPy-style generate → evaluate → improve loop
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import type { NodeFn } from "../../Flowneer";

export interface EvaluatorOptimizerResult {
  /** Score in `[0, 1]`. Loop stops when `score >= threshold`. */
  score: number;
  /** Optional feedback string placed on `(shared as any).__eoFeedback`. */
  feedback?: string;
}

export interface EvaluatorOptimizerOptions<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * Generator step — produces or revises the output.
   * On retries, `(shared as any).__eoFeedback` holds the evaluator's
   * feedback from the previous round.
   */
  generate: NodeFn<S, P>;
  /**
   * Evaluator step — scores the output and optionally provides feedback
   * for the next generation attempt.
   */
  evaluate: (
    shared: S,
    params: P,
  ) => EvaluatorOptimizerResult | Promise<EvaluatorOptimizerResult>;
  /** Score threshold in `[0, 1]`. Stops when `score >= threshold`. */
  threshold: number;
  /** Maximum generate → evaluate iterations. Defaults to 5. */
  maxIterations?: number;
}

/**
 * DSPy-style evaluator-optimizer: generate → evaluate → if score below
 * threshold, regenerate with feedback, repeat.
 *
 * After the loop, `(shared as any).__eoScore` holds the final score.
 *
 * @example
 * const flow = evaluatorOptimizer({
 *   generate: async (s) => { s.answer = await llm(buildPrompt(s)); },
 *   evaluate: async (s) => ({
 *     score: await scoreAnswer(s.answer),
 *     feedback: "Add more supporting evidence",
 *   }),
 *   threshold: 0.8,
 *   maxIterations: 4,
 * });
 */
export function evaluatorOptimizer<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
>(options: EvaluatorOptimizerOptions<S, P>): FlowBuilder<S, P> {
  const { generate, evaluate, threshold, maxIterations = 5 } = options;

  return new FlowBuilder<S, P>()
    .startWith((shared: S) => {
      (shared as any).__eoIter = 0;
      (shared as any).__eoScore = 0;
      (shared as any).__eoFeedback = undefined;
    })
    .loop(
      (shared: S) =>
        (shared as any).__eoScore < threshold &&
        (shared as any).__eoIter < maxIterations,
      (b) => {
        b.startWith(generate).then(async (shared: S, params: P) => {
          const result = await evaluate(shared, params);
          (shared as any).__eoScore = result.score;
          (shared as any).__eoFeedback = result.feedback;
          (shared as any).__eoIter++;
        });
      },
    )
    .then((shared: S) => {
      delete (shared as any).__eoIter;
    });
}
