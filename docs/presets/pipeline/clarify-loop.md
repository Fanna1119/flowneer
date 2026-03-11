# clarifyLoop

A refinement loop that generates an output, evaluates whether it needs human clarification, and — if so — pauses to ask, then regenerates with the clarification incorporated. Repeats up to `maxRounds` times.

Common use cases: ambiguous user queries, low-confidence LLM responses, outputs that reference unresolved terms.

## Import

```typescript
import { clarifyLoop } from "flowneer/presets/pipeline";
```

## Usage

```typescript
import { InterruptError } from "flowneer";
import { resumeFlow } from "flowneer/plugins/agent";
import { clarifyLoop } from "flowneer/presets/pipeline";

interface QueryState {
  query: string;
  output: string;
  confidence: number;
  humanClarification?: string;
}

const flow = clarifyLoop<QueryState>({
  generateStep: async (s) => {
    const prompt = s.humanClarification
      ? `${s.query}\nAdditional context: ${s.humanClarification}`
      : s.query;
    const result = await llm(prompt);
    s.output = result.text;
    s.confidence = result.confidence;
  },
  evaluateFn: (s) => s.confidence < 0.8,
  clarifyPrompt: (s) =>
    `The response has low confidence (${s.confidence}). ` +
    `Please clarify your question or add more context:\n\n${s.output}`,
  maxRounds: 2,
});

// ─── First run ────────────────────────────────────────────────────

try {
  await flow.run(state);
  // flow completed — output is either satisfactory or maxRounds exhausted
} catch (e) {
  if (e instanceof InterruptError) {
    // Deliver the prompt to the user
    console.log("Clarification needed:", e.savedShared.__humanPrompt);

    // When the user replies:
    await resumeFlow(flow, e.savedShared, {
      humanClarification: "I meant the 2025 fiscal year totals",
    });
  }
}
```

## Options

| Option          | Type                                            | Default                                                                  | Description                                                                                             |
| --------------- | ----------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `generateStep`  | `NodeFn<S, P>`                                  | —                                                                        | The generation step. On clarification rounds, `shared.humanClarification` holds the human's last input  |
| `maxRounds`     | `number`                                        | `3`                                                                      | Maximum clarification rounds. After this the flow falls through even if `evaluateFn` still returns true |
| `evaluateFn`    | `(s, p) => boolean \| Promise<boolean>`         | `s.confidence < 0.7 \|\| output.includes("unclear")`                     | Returns `true` when the output needs clarification                                                      |
| `clarifyPrompt` | `string \| (s, p) => string \| Promise<string>` | `"The output is unclear or low-confidence. Please clarify:\n<s.output>"` | Prompt stored on `shared.__humanPrompt` before interrupting                                             |

## State keys

### Internal (deleted on normal completion)

| Key               | Description                                                                           |
| ----------------- | ------------------------------------------------------------------------------------- |
| `__clarifyRounds` | Counter of clarification rounds completed so far (preserved across resumes via `??=`) |
| `__humanPrompt`   | The resolved clarification prompt, set before each interrupt                          |

### User-facing (read / written by consumer)

| Key                  | Direction                 | Description                                                                          |
| -------------------- | ------------------------- | ------------------------------------------------------------------------------------ |
| `humanClarification` | Written by caller         | Inject via `resumeFlow` edits — passed through to `generateStep` on the next attempt |
| `output`             | Written by `generateStep` | The generated output (used by the default `evaluateFn` and prompt)                   |
| `confidence`         | Written by `generateStep` | Numeric confidence (used by the default `evaluateFn`)                                |

## How It Works

```
startWith: __clarifyRounds ??= 0
  ↓
generateStep (user-provided)
  ↓
evaluateFn?
  false or rounds ≥ maxRounds → cleanup → done
  true  → __clarifyRounds++, store __humanPrompt, throw InterruptError
```

On resume, `resumeFlow(flow, saved, { humanClarification: "…" })` re-runs the preset from the top. The `??=` in the init step preserves `__clarifyRounds`, so the counter accumulates correctly across multiple resume cycles.

## Resume pattern

```typescript
// Catch and resume in a simple loop (e.g. CLI / test harness):
let current: any = initialState;
while (true) {
  try {
    await flow.run(current);
    break; // completed
  } catch (e) {
    if (!(e instanceof InterruptError)) throw e;
    const clarification = await askUser(e.savedShared.__humanPrompt);
    current = { ...e.savedShared, humanClarification: clarification };
  }
}
```

## Default `evaluateFn`

When `evaluateFn` is omitted the preset triggers clarification when either:

- `shared.confidence` is a number less than `0.7`, or
- `String(shared.output)` contains the substring `"unclear"`.

Supply your own `evaluateFn` for domain-specific quality checks.

## Return value

`clarifyLoop()` returns a `FlowBuilder<S, P>`. Compose it with plugins:

```typescript
const flow = clarifyLoop({ generateStep, evaluateFn })
  .withTiming()
  .withCostTracker();
```

## See Also

- [`approvalGate`](./approval-gate.md) — single yes/no/edit approval gate
- [`generateUntilValid`](./generate-until-valid.md) — automated retry without human input
- [Human-in-the-loop recipe](../../recipes/human-in-the-loop.md) — checkpoint + resume walkthrough
- [`humanNode` plugin](../../plugins/agent/human-node.md) — lower-level interrupt primitive
