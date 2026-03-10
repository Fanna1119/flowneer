# withRuntimeCompliance

Installs hook-based runtime compliance inspectors on a flow. Each inspector
examines shared state immediately before a step executes and can throw, warn,
or silently record violations.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withRuntimeCompliance } from "flowneer/plugins/compliance";

const AppFlow = FlowBuilder.extend([withRuntimeCompliance]);
```

## Usage

```typescript
import { withRuntimeCompliance, scanShared } from "flowneer/plugins/compliance";

const flow = new AppFlow<State>()
  .then(fetchUser, { label: "pii:fetchUser" })
  .then(callExternalApi, { label: "external:send" });

flow.withRuntimeCompliance([
  {
    // Only fires before steps matching this filter
    filter: (meta) => meta.label?.startsWith("external:") ?? false,
    check: (shared) => {
      const hits = scanShared(shared, ["user.email", "user.phone"]);
      return hits.length > 0
        ? `PII found before external call: ${hits.map((h) => h.path).join(", ")}`
        : null;
    },
    onViolation: "throw", // default
  },
]);

await flow.run(shared);
```

## `RuntimeInspector`

```typescript
interface RuntimeInspector<S> {
  /** If provided, only fires for steps matching this filter. Omit to fire for all steps. */
  filter?: StepFilter;
  /**
   * Called before the step body executes.
   * Return a non-null string to signal a violation.
   * Return null to pass.
   */
  check: (shared: S, meta: StepMeta) => string | null | Promise<string | null>;
  /** Defaults to "throw". */
  onViolation?: "throw" | "warn" | "record";
}
```

## Violation actions

| Action              | Behaviour                                                                      |
| ------------------- | ------------------------------------------------------------------------------ |
| `"throw"` (default) | Throws `ComplianceError` immediately, aborting the flow                        |
| `"warn"`            | Logs to `console.warn`, flow continues                                         |
| `"record"`          | Appends `{ message, meta }` to `shared.__complianceViolations`, flow continues |

### `"record"` mode — collecting violations

```typescript
interface State {
  __complianceViolations?: Array<{ message: string; meta: StepMeta }>;
}

const shared: State = {};
await flow.run(shared);

if (shared.__complianceViolations?.length) {
  console.error("Compliance issues found:", shared.__complianceViolations);
}
```

## `ComplianceError`

Thrown when `onViolation: "throw"` and the inspector returns a violation string.

```typescript
import { ComplianceError } from "flowneer/plugins/compliance";

try {
  await flow.run(shared);
} catch (err) {
  if (err instanceof ComplianceError) {
    console.error("Step:", err.meta.label, "—", err.message);
  }
}
```

## Default action

Set a flow-level default so individual inspectors can omit `onViolation`:

```typescript
flow.withRuntimeCompliance(inspectors, { defaultAction: "record" });
```

## PII helpers — `scanShared`

`scanShared` is a detection-agnostic helper that walks a shared object and returns
fields that match built-in PII patterns.

```typescript
import { scanShared } from "flowneer/plugins/compliance";

const hits = scanShared(shared);
// [{ path: "user.email", pattern: "email", value: "alice@example.com" }]

// Scope the scan to specific key paths
const scoped = scanShared(shared, ["user.email", "billing.phone"]);
```

Built-in patterns: `email`, `phone` (E.164 & NANP), `ssn`, `ipv4`, `creditCard`.

## State Keys

| Key                      | Direction            | Description                                            |
| ------------------------ | -------------------- | ------------------------------------------------------ |
| `__complianceViolations` | **Written** (plugin) | Populated only when any inspector uses `"record"` mode |

## Notes

- Inspectors are called in array order. All inspectors are checked even if an earlier one records a violation (for `"warn"/"record"` modes). For `"throw"`, the first violation aborts immediately.
- `filter` accepts any [`StepFilter`](/core/plugins#stepfilter): string array or predicate.
- Combine with [`withAuditFlow`](./audit-flow.md) for structural pre-flight checks before the flow runs.
