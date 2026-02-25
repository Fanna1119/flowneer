// ---------------------------------------------------------------------------
// Evaluation & testing primitives
// ---------------------------------------------------------------------------
// Pure scoring functions and a dataset runner — zero external dependencies.
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";

// ─────────────────────────────────────────────────────────────────────────────
// Scoring functions
// ─────────────────────────────────────────────────────────────────────────────

/** Case-insensitive exact match. Returns 1.0 or 0.0. */
export function exactMatch(predicted: string, expected: string): number {
  return predicted.trim().toLowerCase() === expected.trim().toLowerCase()
    ? 1.0
    : 0.0;
}

/** Checks if the expected string is contained in the predicted string. */
export function containsMatch(predicted: string, expected: string): number {
  return predicted.toLowerCase().includes(expected.toLowerCase()) ? 1.0 : 0.0;
}

/**
 * Token-level F1 score.
 *
 * Tokenises both strings by whitespace, computes precision/recall of
 * the predicted tokens against the expected tokens, and returns their
 * harmonic mean.
 */
export function f1Score(predicted: string, expected: string): number {
  const predTokens = new Set(
    predicted.toLowerCase().split(/\s+/).filter(Boolean),
  );
  const expTokens = new Set(
    expected.toLowerCase().split(/\s+/).filter(Boolean),
  );

  if (predTokens.size === 0 && expTokens.size === 0) return 1.0;
  if (predTokens.size === 0 || expTokens.size === 0) return 0.0;

  let overlap = 0;
  for (const t of predTokens) {
    if (expTokens.has(t)) overlap++;
  }

  if (overlap === 0) return 0.0;

  const precision = overlap / predTokens.size;
  const recall = overlap / expTokens.size;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Retrieval precision — fraction of retrieved items that are relevant.
 *
 * @param retrieved  Array of retrieved document IDs / strings.
 * @param relevant   Set or array of relevant document IDs / strings.
 */
export function retrievalPrecision(
  retrieved: string[],
  relevant: string[] | Set<string>,
): number {
  if (retrieved.length === 0) return 0.0;
  const rel = relevant instanceof Set ? relevant : new Set(relevant);
  let hits = 0;
  for (const r of retrieved) {
    if (rel.has(r)) hits++;
  }
  return hits / retrieved.length;
}

/**
 * Retrieval recall — fraction of relevant items that were retrieved.
 *
 * @param retrieved  Array of retrieved document IDs / strings.
 * @param relevant   Set or array of relevant document IDs / strings.
 */
export function retrievalRecall(
  retrieved: string[],
  relevant: string[] | Set<string>,
): number {
  const rel = relevant instanceof Set ? relevant : new Set(relevant);
  if (rel.size === 0) return 1.0; // vacuously true
  const retSet = new Set(retrieved);
  let hits = 0;
  for (const r of rel) {
    if (retSet.has(r)) hits++;
  }
  return hits / rel.size;
}

/**
 * Simple keyword-based answer relevance.
 *
 * Returns the fraction of `keywords` that appear in the `answer`.
 * Case-insensitive.
 */
export function answerRelevance(answer: string, keywords: string[]): number {
  if (keywords.length === 0) return 1.0;
  const lower = answer.toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) hits++;
  }
  return hits / keywords.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset evaluator
// ─────────────────────────────────────────────────────────────────────────────

/** A single scoring function that reads from shared state after a flow run. */
export type ScoreFn<S> = (shared: S) => number | Promise<number>;

/** Result of evaluating a single dataset item. */
export interface EvalResult<S> {
  /** The index of the item in the dataset. */
  index: number;
  /** The shared state after the flow completed. */
  shared: S;
  /** Map of score-function name → score. */
  scores: Record<string, number>;
  /** If the flow threw, the error. */
  error?: unknown;
}

/** Aggregate summary from `runEvalSuite`. */
export interface EvalSummary {
  /** Total items evaluated. */
  total: number;
  /** Items that completed without error. */
  passed: number;
  /** Items that threw. */
  failed: number;
  /** Per-metric average across all non-error items. */
  averages: Record<string, number>;
}

/**
 * Run a `FlowBuilder` over a dataset and collect scores.
 *
 * @param dataset    Array of initial shared-state objects (one per item).
 * @param flow       The flow to execute for each item.
 * @param scoreFns   Named scoring functions — each receives the final shared
 *                   state and returns a numeric score.
 *
 * @returns `{ results, summary }` — per-item results and aggregate averages.
 *
 * @example
 * const { results, summary } = await runEvalSuite(
 *   testCases.map(tc => ({ input: tc.prompt, expected: tc.answer })),
 *   myFlow,
 *   {
 *     exact: (s) => exactMatch(s.output, s.expected),
 *     f1: (s) => f1Score(s.output, s.expected),
 *   },
 * );
 * console.log(summary.averages); // { exact: 0.6, f1: 0.82 }
 */
export async function runEvalSuite<S extends Record<string, any>>(
  dataset: S[],
  flow: FlowBuilder<S, any>,
  scoreFns: Record<string, ScoreFn<S>>,
): Promise<{ results: EvalResult<S>[]; summary: EvalSummary }> {
  const results: EvalResult<S>[] = [];

  for (let i = 0; i < dataset.length; i++) {
    // Deep clone to avoid cross-contamination
    const shared: S = JSON.parse(JSON.stringify(dataset[i]));
    const result: EvalResult<S> = { index: i, shared, scores: {} };

    try {
      await flow.run(shared);
      result.shared = shared;
      for (const [name, fn] of Object.entries(scoreFns)) {
        result.scores[name] = await fn(shared);
      }
    } catch (err) {
      result.error = err;
    }

    results.push(result);
  }

  // Compute aggregates
  const passed = results.filter((r) => !r.error);
  const metricNames = Object.keys(scoreFns);
  const averages: Record<string, number> = {};
  for (const name of metricNames) {
    const scores = passed.map((r) => r.scores[name] ?? 0);
    averages[name] =
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  }

  return {
    results,
    summary: {
      total: dataset.length,
      passed: passed.length,
      failed: results.length - passed.length,
      averages,
    },
  };
}
