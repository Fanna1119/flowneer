# withFlowAnalyzer

Two complementary tools for understanding what a flow does:

- **`analyzeFlow()`** — synchronous static walk; answers _"what paths are possible?"_
- **`withTrace()`** — installs runtime hooks; answers _"what path was actually taken?"_

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withFlowAnalyzer } from "flowneer/plugins/dev";

const AppFlow = FlowBuilder.extend([withFlowAnalyzer]);
```

---

## `analyzeFlow()` — static path map

Walks the compiled `steps[]` array and returns a `PathMap` describing all known
nodes, anchors, and structural paths. Nothing is executed.

```typescript
const flow = new AppFlow<State>()
  .anchor("refine", 5)
  .then(generateDraft, { label: "gen:draft" })
  .then(async (s) => (s.score < 0.9 ? "#refine" : undefined), {
    label: "check:score",
  })
  .then(publish, { label: "publish" });

const map = flow.analyzeFlow();

console.log(map.anchors); // ["refine"]
console.log(map.hasDynamicGotos); // true — fn steps may return goto strings
console.log(map.nodes.map((n) => n.label));
// ["refine", "gen:draft", "check:score", "publish"]
```

### `PathMap`

```typescript
interface PathMap {
  nodes: PathNode[];
  /** All anchor names declared in this flow (and nested sub-flows). */
  anchors: string[];
  /**
   * True whenever fn steps are present — they may return "#anchorName" at
   * runtime. Static analysis cannot resolve these edges without execution.
   */
  hasDynamicGotos: boolean;
}
```

### `PathNode`

```typescript
interface PathNode {
  id: string; // "fn_0", "branch_2", "anchor:refine", etc.
  type: "fn" | "branch" | "loop" | "batch" | "parallel" | "anchor";
  label?: string;
  branches?: Record<string, PathNode[]>; // branch arms
  body?: PathNode[]; // loop / batch inner steps
  parallel?: PathNode[][]; // parallel fan-out lanes
}
```

### Branch analysis

```typescript
const flow = new AppFlow<State>().branch(
  async (s) => (s.ok ? "pass" : "fail"),
  {
    pass: async (s) => {
      s.result = "ok";
    },
    fail: async (s) => {
      s.result = "failed";
    },
  },
);

const map = flow.analyzeFlow();
const branchNode = map.nodes.find((n) => n.type === "branch");
console.log(Object.keys(branchNode.branches));
// ["pass", "fail"]
```

---

## `withTrace()` — runtime execution trace

Installs `beforeStep`/`afterStep` hooks that record every visited step with its
type, label, and wall-clock duration.

```typescript
const flow = new AppFlow<State>()
  .then(fetchUser, { label: "fetch:user" })
  .then(enrichProfile, { label: "enrich:profile" })
  .then(saveResult, { label: "save" });

const trace = flow.withTrace();
await flow.run(shared);

const report = trace.getTrace();
console.log(report.pathSummary);
// ["fetch:user", "enrich:profile", "save"]

console.log(report.totalDurationMs);
// 347

trace.dispose(); // remove hooks when done
```

### `TraceHandle`

```typescript
interface TraceHandle {
  /** Returns a snapshot of the trace collected so far. Safe to call mid-run. */
  getTrace(): TraceReport;
  /** Removes the installed hooks. */
  dispose(): void;
}
```

### `TraceReport`

```typescript
interface TraceReport {
  events: TraceEvent[];
  totalDurationMs: number;
  /** Ordered list of visited step labels. Unlabelled steps are omitted. */
  pathSummary: string[];
}

interface TraceEvent {
  stepIndex: number;
  type: string;
  label?: string;
  durationMs: number;
}
```

### Compose with `withDryRun`

Trace the execution path without running any real logic:

```typescript
const flow = new AppFlow<State>()
  .withDryRun()
  .then(callExpensiveApi, { label: "api:call" })
  .then(processResult, { label: "process" });

const trace = flow.withTrace();
await flow.run(shared); // no real I/O

console.log(trace.getTrace().pathSummary);
// ["api:call", "process"]
trace.dispose();
```

### Dispose

`withTrace()` returns a `dispose()` function that removes the hooks. Always call
`dispose()` when the trace is no longer needed to avoid accumulating hooks across
multiple runs.

```typescript
const trace = flow.withTrace();
try {
  await flow.run(shared);
  console.log(trace.getTrace());
} finally {
  trace.dispose();
}
```

---

## Use Cases

- **Pre-deployment checks** — run `analyzeFlow()` at startup to verify anchor names are present and flow structure matches expectations.
- **Debugging** — `.withDryRun().withTrace()` shows the execution path without side effects in staging or test environments.
- **CI test assertions** — assert that a flow visited exactly the steps it should in a given scenario.
- **Performance profiling** — use `TraceEvent.durationMs` to find slow steps without a full telemetry stack.
