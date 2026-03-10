# withAuditFlow

Statically audits a flow for taint violations — checks that no "sink" step
(e.g. an outbound HTTP call) can be reached after a "source" step (e.g. a PII-fetching step),
without executing the flow at all.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withAuditFlow } from "flowneer/plugins/compliance";

const AppFlow = FlowBuilder.extend([withAuditFlow]);
```

## Usage

```typescript
import { withAuditFlow } from "flowneer/plugins/compliance";
import type { TaintRule } from "flowneer/plugins/compliance";

const flow = new AppFlow<State>()
  .then(fetchUser, { label: "pii:fetchUser" })
  .then(enrichProfile, { label: "pii:enrich" })
  .then(callAnalytics, { label: "external:analytics" })
  .then(saveResult);

const rules: TaintRule[] = [
  {
    source: ["pii:*"],
    sink: (meta) => meta.label?.startsWith("external:") ?? false,
    message: "PII must not reach external endpoints",
    onViolation: "throw",
  },
];

const report = flow.auditFlow(rules);

if (!report.passed) {
  for (const v of report.violations) {
    console.error(
      `Rule violation: step "${v.source.label}" (index ${v.source.index}) ` +
        `can reach sink "${v.sink.label}" (index ${v.sink.index})`,
    );
  }
}
```

## `TaintRule`

```typescript
interface TaintRule {
  /** Steps that produce sensitive data. Matched via StepFilter. */
  source: StepFilter;
  /** Steps that send data outbound. Matched via StepFilter. */
  sink: StepFilter;
  /** Human-readable description, included in violation messages. */
  message?: string;
  /** What to do at runtime via withRuntimeCompliance. Defaults to "throw". */
  onViolation?: "throw" | "warn" | "record";
}
```

## `ComplianceReport`

```typescript
interface ComplianceReport {
  passed: boolean;
  violations: ComplianceViolation[];
}

interface ComplianceViolation {
  rule: TaintRule;
  source: { index: number; label?: string };
  sink: { index: number; label?: string };
}
```

## `StepFilter` patterns

`source` and `sink` accept any [`StepFilter`](/core/plugins#stepfilter): a string array (exact labels or glob patterns) or a predicate function.

```typescript
// Exact labels
{ source: ["fetchUser"], sink: ["sendToAnalytics"] }

// Glob — matches "pii:user", "pii:address", etc.
{ source: ["pii:*"], sink: ["external:*"] }

// Predicate
{
  source: (meta) => meta.label?.startsWith("pii:") ?? false,
  sink:   (meta) => meta.label?.startsWith("external:") ?? false,
}
```

Steps without a label are never matched by string patterns.

## How It Works

`auditFlow()` walks the compiled `steps[]` array recursively (including nested
`.loop()` bodies and `.batch()` processors). For each rule it collects all source
and sink positions, then flags any sink that appears at a higher index than a source.

Nothing is executed — the analysis is purely structural and synchronous.

## Notes

- The analysis is **conservative by design**: it reports any structural path from source to sink regardless of runtime conditions. A sink that could only be reached when a branch is false is still reported.
- For runtime enforcement (checking actual shared state values), use [`withRuntimeCompliance`](./runtime-compliance.md).
- Combine both for defence-in-depth: `auditFlow()` at startup to catch structural issues, `withRuntimeCompliance` during execution to catch data-level issues.
