# parseJsonOutput

Extracts and parses JSON from LLM output, handling common formatting artifacts like markdown code fences and surrounding prose.

## Import

```typescript
import { parseJsonOutput } from "flowneer/plugins/output";
```

## Usage

````typescript
// Raw JSON
const data = parseJsonOutput<{ name: string }>('{"name": "Alice"}');
// → { name: "Alice" }

// Markdown-fenced JSON
const data2 = parseJsonOutput(
  'Sure! Here is the data:\n```json\n{"score": 8}\n```',
);
// → { score: 8 }

// JSON embedded in prose
const data3 = parseJsonOutput(
  'The result is {"status": "ok", "value": 42} as requested.',
);
// → { status: "ok", value: 42 }

// With a Zod validator
import { z } from "zod";
const schema = z.object({ score: z.number(), label: z.string() });
const validated = parseJsonOutput(llmOutput, schema);
// → type-safe: { score: number, label: string }
````

## Signature

```typescript
function parseJsonOutput<T = unknown>(
  text: string,
  validator?: Validator<T>,
): T;
```

## Extraction Strategy

1. **Direct parse** — tries `JSON.parse(text)` first.
2. **Code fence stripping** — if that fails, looks for ` ```json ... ``` ` or ` ``` ... ``` ` blocks.
3. **Embedded JSON extraction** — finds the first `{` or `[` and last matching `}` or `]`, then parses what's between them.
4. **Throws** `parseJsonOutput: could not extract valid JSON from input` if all strategies fail.

## With `withStructuredOutput`

```typescript
import { withStructuredOutput } from "flowneer/plugins/llm";
import { parseJsonOutput } from "flowneer/plugins/output";

.withStructuredOutput(MySchema, {
  parse: (raw) => parseJsonOutput(raw),  // use the robust extractor as the parse fn
})
```
