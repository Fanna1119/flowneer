# humanNode & resumeFlow

Insert a human-in-the-loop pause point into a flow. When the step executes it throws an `InterruptError` carrying a deep snapshot of the current state. A `resumeFlow` helper makes resuming ergonomic.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withHumanNode } from "flowneer/plugins/agent";

FlowBuilder.use(withHumanNode);
```

## Usage

```typescript
import { InterruptError } from "flowneer";
import { withHumanNode, resumeFlow } from "flowneer/plugins/agent";

interface State {
  draft: string;
  approved: boolean;
  feedback: string;
  __humanPrompt?: string;
}

const flow = new FlowBuilder<State>()
  .startWith(async (s) => {
    s.draft = await generateDraft(s.topic);
  })
  .humanNode({
    prompt: "Please review the draft and provide feedback.",
  })
  .then(async (s) => {
    if (!s.approved) {
      s.draft = await reviseDraft(s.draft, s.feedback);
    }
  });

// --- Runner ---
const shared: State = { draft: "", approved: false, feedback: "" };

try {
  await flow.run(shared);
} catch (e) {
  if (e instanceof InterruptError) {
    const saved = e.savedShared as State;
    console.log("Prompt:", saved.__humanPrompt);
    console.log("Draft:", saved.draft);

    // Get human input...
    const feedback = await getHumanInput();
    const approved = await getApproval();

    // Resume from step 2 (skip steps 0 and 1 which already ran)
    await resumeFlow(flow, saved, { feedback, approved }, 2);
  }
}
```

## `.humanNode(options?)`

| Option      | Type                                            | Default           | Description                                  |
| ----------- | ----------------------------------------------- | ----------------- | -------------------------------------------- |
| `promptKey` | `string`                                        | `"__humanPrompt"` | Key on `shared` where the prompt is stored   |
| `prompt`    | `string \| (s, p) => string \| Promise<string>` | —                 | Prompt message to store before interrupting  |
| `condition` | `(s, p) => boolean \| Promise<boolean>`         | Always interrupt  | Only interrupt when condition returns `true` |

## `resumeFlow(flow, saved, edits?, fromStep?)`

Helper that merges `edits` into `savedShared`, optionally applies `withReplay(fromStep)` to skip already-completed steps, and calls `flow.run(merged)`.

```typescript
import { resumeFlow } from "flowneer/plugins/agent";

await resumeFlow(
  flow,
  e.savedShared as State,
  { feedback: "Looks good", approved: true },
  resumeFromStep, // skip steps 0..resumeFromStep-1
);
```

| Parameter  | Type          | Description                                             |
| ---------- | ------------- | ------------------------------------------------------- |
| `flow`     | `FlowBuilder` | The same instance that was interrupted                  |
| `saved`    | `S`           | `e.savedShared` from the `InterruptError`               |
| `edits`    | `Partial<S>`  | Human input / corrections to merge                      |
| `fromStep` | `number`      | If provided, skips steps 0..fromStep-1 via `withReplay` |

## Conditional Interrupts

Only pause when the draft needs review:

```typescript
.humanNode({
  prompt: (s) => `Review this draft:\n\n${s.draft}`,
  condition: (s) => s.draft.includes("TODO") || s.confidence < 0.8,
})
```

## See Also

- [`interruptIf`](../observability/interrupts.md) — lower-level interrupt primitive
- [`withReplay`](../persistence/replay.md) — skip completed steps on resume
