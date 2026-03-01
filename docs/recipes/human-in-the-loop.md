# Human-in-the-loop

Pause a flow mid-execution to ask a human for input or approval, then resume with their response. Useful for content moderation gates, approval workflows, or any pipeline where human judgment is required at a specific step.

**Plugins used:** `withHumanNode`, `resumeFlow` (agent), `withCheckpoint` (persistence)

---

## The code

### The flow

```typescript
import { FlowBuilder } from "flowneer";
import { withHumanNode, resumeFlow } from "flowneer/plugins/agent";
import { withCheckpoint } from "flowneer/plugins/persistence";
import { InterruptError } from "flowneer";

FlowBuilder.use(withHumanNode);
FlowBuilder.use(withCheckpoint);

// ─── State ───────────────────────────────────────────────────────────────────

interface ContentState {
  jobId: string;
  rawContent: string;
  humanFeedback?: string;
  approved?: boolean;
  finalContent: string;
  checkpointData?: unknown; // used by withCheckpoint
}

// ─── Simulated checkpoint store (use Redis / DB in production) ───────────────

const checkpointStore = new Map<string, unknown>();

// ─── Flow ────────────────────────────────────────────────────────────────────

const contentFlow = new FlowBuilder<ContentState>()
  .withCheckpoint({
    // Persist state so it survives the process restart between pause and resume
    save: async (id, data) => {
      checkpointStore.set(id, data);
    },
    load: async (id) => checkpointStore.get(id) ?? null,
    key: (s) => s.jobId,
  })

  // Step 1 — Generate content
  .startWith(async (s) => {
    // Replace with your LLM call
    s.rawContent = `Draft article about ${s.jobId}... [generated content here]`;
    console.log("Content generated. Awaiting human review.");
  })

  // Step 2 — Pause and ask a human for approval
  .withHumanNode({
    prompt: (s) =>
      `Please review the following content and reply with "approve", "reject", ` +
      `or "edit: <your revised version>":\n\n${s.rawContent}`,
    onResponse: (response, s) => {
      if (response.startsWith("edit: ")) {
        s.humanFeedback = response.slice(6);
        s.approved = true;
      } else {
        s.approved = response.toLowerCase() === "approve";
        s.humanFeedback = response;
      }
    },
    timeoutMs: 24 * 60 * 60 * 1000, // 24 hours
  })

  // Step 3 — Act on the review
  .then((s) => {
    if (!s.approved) {
      console.log("Content rejected. Stopping pipeline.");
      return;
    }
    s.finalContent = s.humanFeedback?.startsWith("edit:")
      ? s.humanFeedback
      : s.rawContent;
    console.log("Content approved! Publishing:", s.finalContent.slice(0, 80));
  });
```

### Starting the flow (initial run)

```typescript
async function startJob(jobId: string) {
  const state: ContentState = {
    jobId,
    rawContent: "",
    finalContent: "",
  };

  try {
    await contentFlow.run(state);
    console.log("Flow completed without interruption.");
  } catch (err) {
    if (err instanceof InterruptError) {
      // The humanNode paused execution — state is checkpointed.
      // Send the prompt to the reviewer (email, Slack, webhook, etc.)
      console.log("\n⏸  Flow paused — awaiting human review.");
      console.log("Prompt sent to reviewer:", err.prompt);
      console.log("Resume with: resumeJob('${jobId}', '<response>')");
    } else {
      throw err;
    }
  }
}
```

### Resuming the flow (after human responds)

```typescript
async function resumeJob(jobId: string, humanResponse: string) {
  // Load the checkpointed state from your store
  const savedState = checkpointStore.get(jobId) as ContentState | undefined;
  if (!savedState) throw new Error(`No checkpoint found for job ${jobId}`);

  // resumeFlow injects the human response and re-runs from the interrupt point
  await resumeFlow(contentFlow, savedState, humanResponse);
  console.log("Flow resumed and completed.");
}

// Simulate the round-trip
await startJob("article-42");
await resumeJob("article-42", "approve");
```

---

## How `withHumanNode` works

1. When the flow reaches `.withHumanNode()`, it throws an `InterruptError` containing the prompt string.
2. Your `catch` block receives the error and is responsible for delivering the prompt to a human (email, Slack message, HTTP webhook, etc.).
3. When the human responds, call `resumeFlow(flow, savedState, response)`. This injects the response via `onResponse`, then continues execution from the step immediately after the interrupt.
4. `withCheckpoint` persists state between the throw and the resume — essential when your process may restart in the meantime.

## Variation — sequential approval gates

Chain multiple approval steps for a multi-stage review pipeline:

```typescript
const publishFlow = new FlowBuilder<State>()
  .startWith(generateDraft)
  .withHumanNode({
    prompt: (s) => `Review draft:\n${s.draft}`,
    onResponse: setEditorFeedback,
  })
  .then(incorporateFeedback)
  .withHumanNode({
    prompt: (s) => `Legal review:\n${s.revised}`,
    onResponse: setLegalApproval,
  })
  .then(publishContent);
```

## Variation — Slack / webhook delivery

```typescript
catch (err) {
  if (err instanceof InterruptError) {
    await slack.chat.postMessage({
      channel: "#content-review",
      text: err.prompt,
      metadata: { jobId },
    });
  }
}
```

In your Slack event handler, call `resumeJob(jobId, slackResponse.text)`.

---

## See also

- [humanNode reference](../plugins/agent/human-node.md)
- [withCheckpoint](../plugins/persistence/checkpoint.md)
- [Anchors & Routing](../core/anchors-routing.md)
