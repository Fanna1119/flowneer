// ---------------------------------------------------------------------------
// withStructuredOutput — validate + retry LLM output against a Validator<T>
// ---------------------------------------------------------------------------

import type {
  FlowBuilder,
  FlowneerPlugin,
  StepMeta,
  Validator,
} from "../../Flowneer";

export interface StructuredOutputOptions {
  /**
   * Number of retry attempts when the validator rejects the output.
   * Defaults to 1 (a single validation attempt, no retry).
   */
  retries?: number;
  /**
   * Key on `shared` where the raw LLM output string is stored.
   * The plugin reads this after each step, parses it, and writes
   * the validated result back to `shared[outputKey]`.
   * Defaults to `"__llmOutput"`.
   */
  outputKey?: string;
  /**
   * Key on `shared` where the validated result is stored.
   * Defaults to `"__structuredOutput"`.
   */
  resultKey?: string;
  /**
   * Custom parse function to apply before the validator.
   * Defaults to `JSON.parse`.
   */
  parse?: (raw: string) => unknown;
}

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Validates the output of subsequent steps against a `Validator<T>`.
     *
     * After each step completes, the plugin reads `shared[outputKey]`
     * (default `"__llmOutput"`), runs it through `parse` then `validator.parse()`,
     * and stores the result on `shared[resultKey]` (default `"__structuredOutput"`).
     *
     * If validation fails and `retries > 1`, the plugin stores the error on
     * `shared.__validationError` so the next step can adapt its prompt.
     *
     * The validator interface is structurally compatible with Zod, ArkType,
     * Valibot, or any object with a `.parse(input): T` method.
     *
     * @example
     * import { z } from "zod";
     *
     * const schema = z.object({ answer: z.string(), confidence: z.number() });
     *
     * const flow = new FlowBuilder<MyState>()
     *   .withStructuredOutput(schema)
     *   .startWith(async (s) => { s.__llmOutput = await callLlm("..."); })
     *   .then((s) => { console.log(s.__structuredOutput); });
     */
    withStructuredOutput<T = unknown>(
      validator: Validator<T>,
      options?: StructuredOutputOptions,
    ): this;
  }
}

export const withStructuredOutput: FlowneerPlugin = {
  withStructuredOutput(
    this: FlowBuilder<any, any>,
    validator: Validator,
    options?: StructuredOutputOptions,
  ) {
    const retries = options?.retries ?? 1;
    const outputKey = options?.outputKey ?? "__llmOutput";
    const resultKey = options?.resultKey ?? "__structuredOutput";
    const parseFn = options?.parse ?? JSON.parse;

    (this as any)._setHooks({
      afterStep: (_meta: StepMeta, shared: any) => {
        const raw = shared[outputKey];
        if (raw === undefined) return; // step didn't produce output — skip

        let lastError: unknown;
        for (let attempt = 0; attempt < retries; attempt++) {
          try {
            const parsed = typeof raw === "string" ? parseFn(raw) : raw;
            const validated = validator.parse(parsed);
            shared[resultKey] = validated;
            delete shared.__validationError;
            return; // success
          } catch (err) {
            lastError = err;
          }
        }

        // Exhausted retries — store error for downstream steps to handle
        shared.__validationError = {
          message:
            lastError instanceof Error ? lastError.message : String(lastError),
          raw,
          attempts: retries,
        };
      },
    });
    return this;
  },
};
