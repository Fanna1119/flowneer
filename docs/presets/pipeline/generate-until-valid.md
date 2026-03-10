# generateUntilValid

Generate → validate → retry loop. If the generated output fails validation the error message is placed on shared state so the generator can correct itself on the next attempt.

Distinct from the [`withStructuredOutput`](../../plugins/llm/structured-output.md) plugin (which wraps every step) — this is a self-contained flow for a single generation step with retry logic.

## Import

```typescript
import { generateUntilValid } from "flowneer/presets/pipeline";
```

## Usage

```typescript
interface CodeState {
  prompt: string;
  code: string;
  __validationError?: string;
}

const flow = generateUntilValid<CodeState>({
  generate: async (s) => {
    const hint = s.__validationError
      ? `\nPrevious error: ${s.__validationError}`
      : "";
    s.code = await llm(`Write a TypeScript function.${hint}\n${s.prompt}`);
  },
  validate: (s) => {
    try {
      new Function(s.code);
      return true;
    } catch (e) {
      return (e as Error).message;
    }
  },
  maxAttempts: 3,
});

await flow.run({ prompt: "Sort an array of numbers", code: "" });
```

## Options

| Option        | Type                                                            | Default | Description                                                                                          |
| ------------- | --------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `generate`    | `NodeFn<S, P>`                                                  | —       | Produces the output. On retries `(shared as any).__validationError` holds the previous error message |
| `validate`    | `(shared, params) => true \| string \| Promise<true \| string>` | —       | Return `true` when valid, or an error string to retry                                                |
| `maxAttempts` | `number`                                                        | `3`     | Maximum generation attempts                                                                          |

## State keys

| Key                 | Description                                                                        |
| ------------------- | ---------------------------------------------------------------------------------- |
| `__validationError` | `undefined` on success, or the last validation error string if all attempts failed |

## Return value

Returns a `FlowBuilder<S, P>`:

```typescript
const flow = generateUntilValid({ generate, validate })
  .withTiming()
  .withCostTracker();
```

## See Also

- [`mapReduceLlm`](./map-reduce-llm.md) — batch LLM calls across N items
- [`withStructuredOutput`](../../plugins/llm/structured-output.md) — step-level output parsing and retry
