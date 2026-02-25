# v0.5.0

## Overview

v0.5.0 is the largest release to date, adding first-class AI agent primitives: tool calling, a ReAct loop, human-in-the-loop pause/resume, multi-agent factory patterns, memory management, structured output parsing, streaming, a DAG graph compiler, an eval harness, expanded lifecycle callbacks, and telemetry. All new capabilities are zero-dependency and ship as separate `flowneer/plugins/*` subpaths.

---

## New: `.stream()` — async generator interface

`.stream(shared, params?, options?)` runs the flow and yields `StreamEvent` values instead of awaiting a single promise. Use it to push incremental updates to a UI or SSE endpoint without any extra wiring.

```typescript
import { FlowBuilder } from "flowneer";

for await (const event of flow.stream(shared)) {
  if (event.type === "step:after") console.log("step done", event.meta.index);
  if (event.type === "chunk") process.stdout.write(event.chunk as string);
  if (event.type === "done") break;
}
```

**`StreamEvent<S>` union:**

| `type`        | Extra fields     | When emitted                            |
| ------------- | ---------------- | --------------------------------------- |
| `step:before` | `meta`           | Before each step                        |
| `step:after`  | `meta`, `shared` | After each step completes               |
| `chunk`       | `meta`, `chunk`  | When a step writes to `shared.__stream` |
| `error`       | `meta`, `error`  | When a step throws                      |
| `done`        | `shared`         | After the flow finishes                 |

Steps emit chunks by writing to `shared.__stream`:

```typescript
.then(async (s) => {
  for await (const token of llmStream()) {
    s.__stream = token;   // each assignment yields a "chunk" event
  }
})
```

---

## New plugin: `withStructuredOutput` — validated LLM output

Parses and validates a step's raw LLM output into a typed object. Structurally compatible with Zod schemas — no Zod dependency required.

```typescript
import { withStructuredOutput } from "flowneer/plugins/llm";
FlowBuilder.use(withStructuredOutput);

const flow = new FlowBuilder<State>()
  .withStructuredOutput({
    parse: (raw) => JSON.parse(raw),
    validator: myZodSchema, // or any object with .parse()
  })
  .startWith(callLlm);

// Result available at shared.__structuredOutput
// Errors available at shared.__validationError
```

---

## New plugin: `withTools` + `ToolRegistry` — tool calling

Registers a typed tool registry on `shared.__tools` for use in agent steps.

```typescript
import { withTools, ToolRegistry } from "flowneer/plugins/tools";
FlowBuilder.use(withTools);

const registry = new ToolRegistry([
  {
    name: "search",
    description: "Web search",
    params: {
      query: { type: "string", description: "Search query", required: true },
    },
    execute: async ({ query }) => webSearch(query),
  },
]);

const flow = new FlowBuilder<State>()
  .withTools(registry)
  .startWith(async (s) => {
    const results = await s.__tools.execute({
      name: "search",
      args: { query: s.question },
    });
    s.searchResults = results;
  });
```

Helper functions `getTools`, `executeTool`, and `executeTools` are also exported for use outside the plugin method.

---

## New plugin: `withReActLoop` — ReAct agent loop

Inserts a fully-wired think → tool-call → observe loop. Supply a `think` function that returns either `{ action: "finish" }` or `{ action: "tool", calls }`.

```typescript
import { withReActLoop } from "flowneer/plugins/agent";
FlowBuilder.use(withReActLoop);

const flow = new FlowBuilder<State>().withTools(registry).withReActLoop({
  maxIterations: 8,
  think: async (s) => {
    const response = await llm(s.messages);
    return response.toolCalls.length
      ? { action: "tool", calls: response.toolCalls }
      : { action: "finish", output: response.text };
  },
  onObservation: (results, s) => {
    s.messages.push({ role: "tool", content: JSON.stringify(results) });
  },
});

// s.__reactOutput  — final answer when action was "finish"
// s.__reactExhausted — true when maxIterations was reached
```

---

## New plugin: `withHumanNode` + `resumeFlow` — ergonomic human-in-the-loop

`.humanNode(options?)` inserts a pause point that throws an `InterruptError`. `resumeFlow` merges human edits into the saved state and re-runs the flow.

```typescript
import { withHumanNode, resumeFlow } from "flowneer/plugins/agent";
FlowBuilder.use(withHumanNode);

const flow = new FlowBuilder<DraftState>()
  .startWith(generateDraft)
  .humanNode({ prompt: "Please review and approve the draft." })
  .then(publishDraft);

try {
  await flow.run(state);
} catch (e) {
  if (e instanceof InterruptError) {
    const feedback = await showReviewUI(e.savedShared.__humanPrompt);
    await resumeFlow(flow, e.savedShared, { feedback });
  }
}
```

Options: `prompt` (string or async function), `condition` (only interrupt when true), `promptKey` (default `__humanPrompt`).

---

## New: multi-agent factory patterns

Four factory functions that compose `FlowBuilder` instances into common multi-agent topologies. No extra registration needed — they return a `FlowBuilder`.

```typescript
import {
  supervisorCrew,
  sequentialCrew,
  hierarchicalCrew,
  roundRobinDebate,
} from "flowneer/plugins/agent";
```

| Factory            | Topology                                            |
| ------------------ | --------------------------------------------------- |
| `supervisorCrew`   | Supervisor → parallel workers → optional aggregator |
| `sequentialCrew`   | Strict pipeline through an array of step functions  |
| `hierarchicalCrew` | Manager → sequential teams → optional aggregator    |
| `roundRobinDebate` | Round-robin across agents for N rounds              |

```typescript
const crew = supervisorCrew<State>(
  (s) => {
    s.plan = makePlan();
  },
  [researchAgent, codeAgent, reviewAgent],
  {
    post: (s) => {
      s.report = compile(s);
    },
  },
);

await crew.run(state);
```

---

## New plugin: memory — conversation memory management

Three memory classes and a `withMemory` plugin. All implement the `Memory` interface (`add / get / clear / toContext`).

```typescript
import {
  BufferWindowMemory,
  SummaryMemory,
  KVMemory,
  withMemory,
} from "flowneer/plugins/memory";
FlowBuilder.use(withMemory);

const memory = new BufferWindowMemory({ maxMessages: 10 });

const flow = new FlowBuilder<State>()
  .withMemory(memory)
  .startWith(async (s) => {
    s.__memory.add({ role: "user", content: s.userInput });
    const context = s.__memory.toContext();
    s.response = await llm(context);
    s.__memory.add({ role: "assistant", content: s.response });
  });
```

| Class                | Behaviour                                                             |
| -------------------- | --------------------------------------------------------------------- |
| `BufferWindowMemory` | Sliding window — keeps the last `maxMessages` messages                |
| `SummaryMemory`      | Compresses oldest messages via a user-provided `summarize()` callback |
| `KVMemory`           | Key-value store with `toJSON` / `fromJSON` serialisation              |

---

## New: output parsers — `flowneer/plugins/output`

Four pure functions for extracting structured data from LLM text. No registration needed.

```typescript
import {
  parseJsonOutput,
  parseListOutput,
  parseMarkdownTable,
  parseRegexOutput,
} from "flowneer/plugins/output";

const data = parseJsonOutput(llmText); // raw JSON, fenced, or embedded
const items = parseListOutput(llmText); // dash, numbered, bullet, newline
const rows = parseMarkdownTable(llmText); // GFM table → Record<string,string>[]
const match = parseRegexOutput(llmText, /(\w+)/); // named or positional groups
```

All functions accept an optional `Validator<T>` as a last argument for runtime schema validation compatible with Zod.

---

## New plugin: `withCallbacks` — expanded lifecycle callbacks

Maps `StepMeta.label` prefixes to semantic LangChain-style callbacks.

```typescript
import { withCallbacks } from "flowneer/plugins/observability";
FlowBuilder.use(withCallbacks);

flow.withCallbacks({
  onLLMStart: (meta, s) => log("LLM starting", meta.index),
  onLLMEnd: (meta, s) => log("LLM done, tokens:", s.tokensUsed),
  onToolStart: (meta, s) => log("tool call:", s.__toolCall),
  onToolEnd: (meta, s) => log("tool result:", s.__toolResult),
  onAgentAction: (meta, s) => log("agent acting"),
  onAgentFinish: (meta, s) => log("agent finished"),
  onChainStart: (meta, s) => log("step start"),
  onChainEnd: (meta, s) => log("step end"),
  onError: (meta, err) => log("error:", err),
});
```

Label conventions: steps labelled `"llm:*"`, `"tool:*"`, or `"agent:*"` (via `NodeOptions.label` or a labelling plugin) route to the corresponding callbacks; all other steps route to `onChainStart` / `onChainEnd`.

---

## New plugin: `withTelemetry` — structured span telemetry

Wraps the existing `TelemetryDaemon` as a plugin. Accepts any `TelemetryExporter` including the bundled `consoleExporter` and `otlpExporter`.

```typescript
import { withTelemetry, consoleExporter } from "flowneer/plugins/telemetry";
FlowBuilder.use(withTelemetry);

flow.withTelemetry({ exporter: consoleExporter });
// or pass an existing daemon:
flow.withTelemetry({ daemon: myDaemon });
```

---

## New: eval harness — `flowneer/plugins/eval`

Scoring functions and a `runEvalSuite` runner for offline evaluation of flows against a dataset.

```typescript
import {
  exactMatch,
  containsMatch,
  f1Score,
  retrievalPrecision,
  retrievalRecall,
  answerRelevance,
  runEvalSuite,
} from "flowneer/plugins/eval";

const { results, summary } = await runEvalSuite(dataset, myFlow, {
  accuracy: (item, s) => exactMatch(s.answer, item.expected),
  f1: (item, s) => f1Score(s.answer, item.expected),
});

console.log(summary.f1.mean); // average F1 across the dataset
```

Each dataset item runs in its own deep-cloned shared state — no bleed between items. Errors are captured per-item rather than aborting the suite.

---

## New plugin: `withGraph` — DAG graph compiler

Describes flows as a directed graph and compiles to a `FlowBuilder` chain. Handles topological ordering, conditional edges, and back-edges (cycles via conditional jumps).

```typescript
import { withGraph } from "flowneer/plugins/graph";
FlowBuilder.use(withGraph);

const flow = (new FlowBuilder<State>() as any)
  .withGraph()
  .addNode("fetch", (s) => {
    s.data = fetch(s.url);
  })
  .addNode("parse", (s) => {
    s.parsed = parse(s.data);
  })
  .addNode("validate", (s) => {
    s.valid = validate(s.parsed);
  })
  .addNode("retry", (s) => {
    s.url = nextUrl();
  })
  .addEdge("fetch", "parse")
  .addEdge("parse", "validate")
  .addEdge("validate", "retry", (s) => !s.valid) // conditional back-edge
  .addEdge("retry", "fetch")
  .compile();

await flow.run({ url: "https://..." });
```

`compile()` runs Kahn's topological sort on unconditional edges, classifies conditional edges as forward or back-edges, inserts `anchor` markers for back-edge targets, and emits the matching `FlowBuilder` chain. Throws on empty graphs, duplicate nodes, unknown edge targets, or unconditional cycles.

---

## New exports from `index.ts`

Two new types are exported from the main `flowneer` entry point:

- `Validator<T>` — structural interface compatible with Zod (`{ parse(x: unknown): T }`). Accepted by parsers and `withStructuredOutput`.
- `StreamEvent<S>` — tagged union of all events emitted by `.stream()`.

---

## New subpath exports

| Import path                  | Contents                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `flowneer/plugins/tools`     | `ToolRegistry`, `Tool`, `ToolCall`, `ToolResult`, `withTools`, `getTools`, `executeTool`, `executeTools`                   |
| `flowneer/plugins/agent`     | `withReActLoop`, `withHumanNode`, `resumeFlow`, `supervisorCrew`, `sequentialCrew`, `hierarchicalCrew`, `roundRobinDebate` |
| `flowneer/plugins/memory`    | `BufferWindowMemory`, `SummaryMemory`, `KVMemory`, `withMemory`, `Memory`, `MemoryMessage`                                 |
| `flowneer/plugins/output`    | `parseJsonOutput`, `parseListOutput`, `parseMarkdownTable`, `parseRegexOutput`                                             |
| `flowneer/plugins/eval`      | `exactMatch`, `containsMatch`, `f1Score`, `retrievalPrecision`, `retrievalRecall`, `answerRelevance`, `runEvalSuite`       |
| `flowneer/plugins/graph`     | `withGraph`                                                                                                                |
| `flowneer/plugins/telemetry` | `withTelemetry`, `TelemetryDaemon`, `consoleExporter`, `otlpExporter`                                                      |

Existing subpaths (`flowneer/plugins/llm`, `flowneer/plugins/observability`, etc.) are unchanged and backward-compatible. `withStructuredOutput` has been added to `flowneer/plugins/llm` and `withCallbacks` to `flowneer/plugins/observability`.
