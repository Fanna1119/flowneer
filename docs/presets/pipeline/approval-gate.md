# approvalGate

Insert a conditional or always-on human approval / review gate into a flow. On the first run the gate pauses execution, stores a prompt on shared state, and throws an `InterruptError`. When the human responds the caller resumes the flow with the response injected into shared state, and the gate processes the outcome — setting `approved`, `humanEdit`, or `humanFeedback` accordingly.

## Import

```typescript
import { approvalGate } from "flowneer/presets/pipeline";
```

## Usage

```typescript
import { FlowBuilder, InterruptError } from "flowneer";
import { resumeFlow } from "flowneer/plugins/agent";
import { approvalGate } from "flowneer/presets/pipeline";

interface DraftState {
  draft: string;
  approved?: boolean;
  humanEdit?: string;
  humanFeedback?: string;
  __humanPrompt?: string;
}

const flow = new FlowBuilder<DraftState>()
  .startWith(async (s) => {
    s.draft = await generateDraft(s.topic);
  })
  .add(
    approvalGate({
      prompt: (s) => `Please review the following draft:\n\n${s.draft}`,
      onReject: (s, feedback) => {
        console.log("Rejected:", feedback);
        // throw to stop, or set state to trigger a revision anchor
      },
    }),
  )
  .then((s) => {
    if (!s.approved) return;
    const content = s.humanEdit ?? s.draft;
    console.log("Publishing:", content);
  });

// ─── First run ────────────────────────────────────────────────────

try {
  await flow.run(state);
} catch (e) {
  if (e instanceof InterruptError) {
    // Deliver the prompt to a human (email, Slack, UI, etc.)
    console.log("Awaiting review:", e.savedShared.__humanPrompt);

    // Later, when the human responds:
    await resumeFlow(flow, e.savedShared, {
      __approvalResponse: "approve", // or "edit: revised text", or "reject"
    });
  }
}
```

## Options

| Option        | Type                                            | Default                                          | Description                                                                                                |
| ------------- | ----------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `prompt`      | `string \| (s, p) => string \| Promise<string>` | `Approve this output?\n\n<JSON of s.output>`     | Prompt message stored on `shared.__humanPrompt` before interrupting                                        |
| `condition`   | `(s, p) => boolean \| Promise<boolean>`         | Always interrupt                                 | When provided, the gate only activates when this returns `true`                                            |
| `onReject`    | `(s, feedback?) => void \| Promise<void>`       | `() => { throw new Error("Rejected by human") }` | Called when the response is not `"approve"`, `"yes"`, or `"edit: …"`. Throw to halt, or mutate to redirect |
| `responseKey` | `string`                                        | `"__approvalResponse"`                           | Key on `shared` where the human's response is injected during `resumeFlow`                                 |

## State keys

### Internal (cleaned up after resume)

| Key                  | Description                                            |
| -------------------- | ------------------------------------------------------ |
| `__humanPrompt`      | The resolved prompt string, set before interrupting    |
| `__approvalResponse` | The human's response, injected by the caller on resume |

### Written by the gate on resume

| Key             | Description                                           | Condition                                 |
| --------------- | ----------------------------------------------------- | ----------------------------------------- |
| `approved`      | `true` when approved or edited, `false` when rejected | Always set on resume                      |
| `humanEdit`     | The revised text (everything after `"edit: "`)        | Only when response starts with `"edit: "` |
| `humanFeedback` | The raw rejection string                              | Only on rejection                         |

## Response format

The human's response (value of `shared[responseKey]`) is parsed as follows:

| Response                          | Outcome                                                           |
| --------------------------------- | ----------------------------------------------------------------- |
| `"approve"` or `"yes"` (any case) | `approved = true`                                                 |
| `"edit: <text>"`                  | `humanEdit = "<text>"`, `approved = true`                         |
| Anything else                     | `approved = false`, `humanFeedback = <text>`, `onReject()` called |

## Resume pattern

```typescript
// After catching InterruptError:
await resumeFlow(flow, e.savedShared, {
  __approvalResponse: "edit: revised version of the content",
});
// → s.approved = true, s.humanEdit = "revised version of the content"
```

`resumeFlow` merges the second argument (your partial edits) into the saved state and re-runs the flow from the beginning. The gate step detects `__approvalResponse` is set, processes it, and falls through to the next step.

## Conditional gate

Only activate the gate when confidence is low:

```typescript
.add(
  approvalGate({
    condition: (s) => s.confidence < 0.8,
    prompt: (s) => `Low-confidence output (${s.confidence}). Approve?\n\n${s.output}`,
  }),
)
```

When `condition` returns `false` the gate step is a no-op — the flow continues as if it were not there.

## Return value

`approvalGate()` returns a `FlowBuilder<S, P>` with a single step. Compose it with plugins:

```typescript
const gate = approvalGate({ prompt: reviewPrompt })
  .withTiming()
  .withCheckpoint({ save, load, key: (s) => s.jobId });
```

Or splice it mid-flow via `.add()`:

```typescript
const pipeline = new FlowBuilder<State>()
  .startWith(generate)
  .add(approvalGate({ prompt: reviewPrompt }))
  .then(publish);
```

## See Also

- [`clarifyLoop`](./clarify-loop.md) — looped clarification: generate → ask when unclear → retry
- [Human-in-the-loop recipe](../../recipes/human-in-the-loop.md) — full checkpoint + resume walkthrough
- [`humanNode` plugin](../../plugins/agent/human-node.md) — lower-level interrupt primitive
- [`resumeFlow`](../../plugins/agent/human-node.md#resumeflowflow-saved-edits-fromstep) — resume helper API
