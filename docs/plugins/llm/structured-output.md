# withStructuredOutput

Validates LLM output against a schema after each step. Retries on validation failure by storing the error on `shared.__validationError` so your LLM step can adapt its prompt.

Works with **Zod**, **ArkType**, **Valibot**, or any object with a `.parse(input): T` method.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withStructuredOutput } from "flowneer/plugins/llm";

FlowBuilder.use(withStructuredOutput);
```

## Usage

```typescript
import { z } from "zod";

const AnalysisSchema = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
});

type Analysis = z.infer<typeof AnalysisSchema>;

interface State {
  text: string;
  __llmOutput?: string;
  __structuredOutput?: Analysis;
  __validationError?: { message: string; raw: string; attempts: number };
}

const flow = new FlowBuilder<State>()
  .withStructuredOutput(AnalysisSchema, { retries: 2 })
  .startWith(async (s) => {
    const errorHint = s.__validationError
      ? `\nPrevious attempt failed: ${s.__validationError.message}. Fix it.`
      : "";
    s.__llmOutput = await callLlm(
      `Analyse the sentiment of: "${s.text}". Return JSON.${errorHint}`,
    );
  })
  .then((s) => {
    const result = s.__structuredOutput!;
    console.log(result.sentiment, result.confidence);
  });
```

## Options

| Option      | Type                       | Default                | Description                                                  |
| ----------- | -------------------------- | ---------------------- | ------------------------------------------------------------ |
| `retries`   | `number`                   | `1`                    | Total validation attempts (1 = no retry)                     |
| `outputKey` | `string`                   | `"__llmOutput"`        | Key on `shared` where the raw LLM output string is read from |
| `resultKey` | `string`                   | `"__structuredOutput"` | Key on `shared` where the validated result is written        |
| `parse`     | `(raw: string) => unknown` | `JSON.parse`           | Pre-validator parse function                                 |

## Behaviour

After each step:

1. Reads `shared[outputKey]`. If absent, skips (step didn't produce output).
2. Runs `parse(raw)` to turn the raw string into a value.
3. Calls `validator.parse(value)`.
4. On success: stores the result on `shared[resultKey]` and clears `__validationError`.
5. On failure: if `retries > 1`, stores the error on `shared.__validationError` for the next step's prompt to consume. Exhausting all attempts leaves the error on shared but does **not** throw.

## State Keys

| Key                  | Direction             | Description                          |
| -------------------- | --------------------- | ------------------------------------ |
| `__llmOutput`        | **Write** (your step) | Raw LLM response string              |
| `__structuredOutput` | **Read** (your step)  | Validated typed result               |
| `__validationError`  | **Read** (your step)  | Error context from failed validation |

## Custom Parse Function

Strip markdown fences before JSON-parsing:

````typescript
.withStructuredOutput(MySchema, {
  parse: (raw) => {
    const match = raw.match(/```json\s*([\s\S]*?)```/);
    return JSON.parse(match ? match[1]! : raw);
  },
})
````

Or use the built-in `parseJsonOutput` helper:

```typescript
import { parseJsonOutput } from "flowneer/plugins/output";

.withStructuredOutput(MySchema, { parse: parseJsonOutput })
```
