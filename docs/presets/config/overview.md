# JsonFlowBuilder

Build and validate `FlowBuilder` instances from a plain JSON (or TypeScript object) configuration.
Useful for dynamic flows, low-code editors, database-driven pipelines, or any scenario where
the flow structure is determined at runtime rather than compile time.

## Setup

```typescript
import { JsonFlowBuilder } from "flowneer/presets/config";
```

`JsonFlowBuilder` is a standalone class — no `FlowBuilder.extend()` call needed.

---

## Quick start

```typescript
import { JsonFlowBuilder } from "flowneer/presets/config";

const config = {
  steps: [
    { type: "fn", fn: "fetchUser", label: "pii:user", retries: 2 },
    { type: "fn", fn: "saveResult", label: "save" },
  ],
};

const registry = {
  fetchUser: async (s) => {
    s.user = await db.get(s.userId);
  },
  saveResult: async (s) => {
    await db.save(s.result);
  },
};

const flow = JsonFlowBuilder.build(config, registry);
await flow.run(shared);
```

---

## `FlowConfig` — supported step types

All `FlowBuilder` step types are supported:

```typescript
type StepConfig =
  | {
      type: "fn";
      fn: string;
      label?: string;
      retries?: number;
      delaySec?: number;
      timeoutMs?: number;
    }
  | {
      type: "branch";
      router: string;
      branches: Record<string, string>;
      label?: string;
      retries?: number;
      delaySec?: number;
      timeoutMs?: number;
    }
  | { type: "loop"; condition: string; body: StepConfig[]; label?: string }
  | {
      type: "batch";
      items: string;
      processor: StepConfig[];
      key?: string;
      label?: string;
    }
  | {
      type: "parallel";
      fns: string[];
      label?: string;
      retries?: number;
      delaySec?: number;
      timeoutMs?: number;
    }
  | { type: "anchor"; name: string; maxVisits?: number };

interface FlowConfig {
  steps: StepConfig[];
}
```

All string values (`fn`, `router`, `condition`, `items`, `fns`, etc.) are registry keys — resolved to real functions at build time.

---

## API

### `JsonFlowBuilder.build<S>(config, registry, FlowClass?)`

Validates and compiles a `FlowConfig` into a runnable `FlowBuilder<S>`.

Calls `validate()` first. Throws `ConfigValidationError` if the config is invalid.

```typescript
const flow = JsonFlowBuilder.build<MyState>(config, registry);
await flow.run(shared);
```

The optional third argument `FlowClass` controls which class is instantiated. Pass a
`FlowBuilder.extend([...plugins])` subclass to get plugin methods on the returned flow
(see [Using plugins](#using-plugins)).

### `JsonFlowBuilder.validate(config, registry)`

Validates structure and registry references without building. Returns **all** errors
found — does not short-circuit on the first error.

```typescript
const result = JsonFlowBuilder.validate(config, registry);
if (!result.valid) {
  for (const err of result.errors) {
    console.error(`${err.path}: ${err.message}`);
  }
}
```

`validate()` checks:

1. Structural shape of every step (correct `type`, required fields present)
2. All function references exist in the registry
3. Duplicate anchor names
4. Recursive validation of nested `body` and `processor` arrays

Custom types registered via `registerStepBuilder()` are accepted without an "unknown step type"
error. Built-in types still undergo full structural checks regardless.

### `JsonFlowBuilder.registerStepBuilder(type, builder)`

Register a config-level builder for a custom step type. Mirrors
`CoreFlowBuilder.registerStepType()` — the dispatch table follows the same pattern.

```typescript
import type { StepConfigBuilder } from "flowneer/presets/config";

const sleepBuilder: StepConfigBuilder = (step, flow) => {
  flow.then(async () => new Promise((r) => setTimeout(r, (step as any).ms)));
};

JsonFlowBuilder.registerStepBuilder("sleep", sleepBuilder);
```

The builder receives four arguments:

| Argument   | Type                            | Description                                                                   |
| ---------- | ------------------------------- | ----------------------------------------------------------------------------- |
| `step`     | `StepConfig & { type: string }` | Raw config object for this step                                               |
| `flow`     | `FlowBuilder`                   | The flow being assembled — call builder methods on it                         |
| `registry` | `FnRegistry`                    | Map of all registered functions                                               |
| `recurse`  | `ApplyFn`                       | Helper to compile nested sub-steps (for container step types like loop/batch) |

Use `recurse` when your custom step type contains nested `StepConfig[]` arrays:

```typescript
JsonFlowBuilder.registerStepBuilder(
  "retryLoop",
  (step: any, flow, registry, recurse) => {
    flow.loop(
      registry[step.condition],
      (inner) => recurse(step.body, inner, registry),
      { label: step.label },
    );
  },
);
```

`registerStepBuilder` is global — registered builders apply to all `JsonFlowBuilder.build()`
calls in the process.

---

## Using plugins

`build()` accepts an optional `FlowClass` constructor. Pass a subclass produced by
`FlowBuilder.extend([...plugins])` to get plugin methods on the returned flow:

```typescript
import { FlowBuilder } from "flowneer";
import { withTiming } from "flowneer/plugins/observability";
import { withRateLimit } from "flowneer/plugins/llm";
import { JsonFlowBuilder } from "flowneer/presets/config";

// Create your project's AppFlow once
const AppFlow = FlowBuilder.extend([withTiming, withRateLimit]);

// Pass it to every build() call
const flow = JsonFlowBuilder.build(config, registry, AppFlow);

// Plugin methods are available on the result
flow.withTiming().withRateLimit(10);
await flow.run(shared);
```

Config-driven flows get the same plugin surface as hand-written ones. A common pattern is
to define a single project-wide `AppFlow` and always pass it to `build()`:

```typescript
// appFlow.ts
export const AppFlow = FlowBuilder.extend([
  withTelemetry,
  withAuditLog,
  withCircuitBreaker,
]);

// usage
const flow = JsonFlowBuilder.build(config, registry, AppFlow);
```

### Using plugins for compliance auditing

```typescript
import {
  withAuditFlow,
  withRuntimeCompliance,
} from "flowneer/plugins/compliance";

const CA = FlowBuilder.extend([withAuditFlow, withRuntimeCompliance]);

const flow = JsonFlowBuilder.build(
  {
    steps: [
      { type: "fn", fn: "fetchUser", label: "pii:user" },
      { type: "fn", fn: "sendEmail", label: "external:send" },
    ],
  },
  registry,
  CA,
);

// Static taint analysis — no run needed
const report = flow.auditFlow([
  {
    source: ["pii:*"],
    sink: ["external:*"],
    message: "PII must not leave the system",
  },
]);
console.log(report.passed, report.violations);
```

---

## Examples

### Branch

```typescript
const config = {
  steps: [
    {
      type: "branch",
      router: "routeByScore",
      branches: {
        pass: "publishResult",
        retry: "refineResult",
        fail: "logFailure",
      },
    },
  ],
};
```

### Loop (condition-based)

```typescript
const config = {
  steps: [
    {
      type: "loop",
      condition: "notDone", // registry key — returns boolean
      body: [
        { type: "fn", fn: "generateDraft" },
        { type: "fn", fn: "scoreResult" },
      ],
      label: "refine-loop",
    },
  ],
};

const registry = {
  notDone: (s) => s.score < 0.9,
  generateDraft: async (s) => {
    /* ... */
  },
  scoreResult: async (s) => {
    /* ... */
  },
};
```

### Anchor + goto (jump-based loop)

Use `anchor` steps together with a step that returns `"#anchorName"` to implement
arbitrary goto-style loops with an optional cycle guard:

```typescript
const config = {
  steps: [
    { type: "anchor", name: "refine", maxVisits: 5 },
    { type: "fn", fn: "generateDraft" },
    { type: "fn", fn: "checkScore" }, // returns "#refine" or undefined
    { type: "fn", fn: "publish" },
  ],
};
```

### Batch

```typescript
const config = {
  steps: [
    {
      type: "batch",
      items: "getDocumentList",
      processor: [
        { type: "fn", fn: "summarizeDocument" },
        { type: "fn", fn: "embedDocument" },
      ],
      key: "__currentDoc", // defaults to "__batchItem" if omitted
    },
  ],
};
```

Each processor step receives the current item on `shared[key]`. The key is restored to
its previous value after the batch completes. Use distinct keys when batches are nested.

### Parallel

```typescript
const config = {
  steps: [
    {
      type: "parallel",
      fns: ["fetchProfile", "fetchOrders", "fetchPreferences"],
      label: "parallel:fetch",
    },
  ],
};
```

All functions run concurrently against the same shared state. Results are merged when all
fns complete. For conflict-safe merging use a reducer — this requires a hand-written
`parallel` step or a custom step builder.

---

## Validation errors

```typescript
export interface ValidationError {
  path: string; // dot-path to the problem, e.g. "$.steps[1].branches.fail"
  message: string; // human-readable description
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
```

### `ConfigValidationError`

Thrown by `build()` when validation fails. Contains the full error list.

```typescript
import { ConfigValidationError } from "flowneer/presets/config";

try {
  const flow = JsonFlowBuilder.build(config, registry);
} catch (err) {
  if (err instanceof ConfigValidationError) {
    console.error(err.message);
    // "FlowConfig validation failed:\n  $.steps[0].fn: \"missingFn\" not found in registry"
    console.error(err.errors); // Array<ValidationError>
  }
}
```

---

## Types

```typescript
/** Recursive applicator passed to nested step builders. */
export type ApplyFn = (
  steps: StepConfig[],
  flow: FlowBuilder<any, any>,
  registry: FnRegistry,
) => void;

/** A step config builder registered via registerStepBuilder(). */
export type StepConfigBuilder = (
  step: StepConfig & { type: string },
  flow: FlowBuilder<any, any>,
  registry: FnRegistry,
  recurse: ApplyFn,
) => void;
```

`CustomStepBuilder` is kept as an alias for `StepConfigBuilder` for backwards compatibility.

---

## Notes

- `build()` always produces a fresh flow instance — calling it twice with the same config produces two independent flows.
- The registry is **not** validated for unused entries — only referenced keys must exist.
- `registerStepBuilder()` is global — registered builders apply to all `build()` calls in the process. Built-in step types (`fn`, `branch`, `loop`, `batch`, `parallel`, `anchor`) can be overridden this way.
- `validate()` is called automatically inside `build()`. Call it separately when you want to surface errors without constructing a flow (e.g. in a config editor UI).
