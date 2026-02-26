# withAuditLog

Writes an immutable audit entry to a store after each step — both successful completions and errors. Each entry is a **deep clone** of `shared` at that point in time, making it suitable for compliance, debugging post-mortems, and replay analysis.

## Setup

```typescript
import { FlowBuilder } from "flowneer";
import { withAuditLog } from "flowneer/plugins/persistence";

FlowBuilder.use(withAuditLog);
```

## The `AuditLogStore` Interface

```typescript
interface AuditEntry<S = any> {
  stepIndex: number;
  type: string;
  timestamp: number; // Unix ms
  shared: S; // deep clone via JSON.parse/stringify
  error?: string; // present on failed steps
}

interface AuditLogStore<S = any> {
  append: (entry: AuditEntry<S>) => void | Promise<void>;
}
```

## Usage

```typescript
const log: AuditEntry<State>[] = [];
const store: AuditLogStore<State> = {
  append: (entry) => log.push(entry),
};

const flow = new FlowBuilder<State>()
  .withAuditLog(store)
  .startWith(stepA)
  .then(stepB)
  .then(stepC);

await flow.run(initialState);

// Every step, success or failure, is now in `log`
for (const entry of log) {
  console.log(
    `Step ${entry.stepIndex} (${entry.type}) at ${new Date(entry.timestamp).toISOString()}`,
  );
  if (entry.error) console.error("  Error:", entry.error);
}
```

## Differences vs `withCheckpoint`

|                          | `withCheckpoint` | `withAuditLog` |
| ------------------------ | ---------------- | -------------- |
| Captures errors          | ❌               | ✅             |
| Deep clone               | ✅ (your impl)   | ✅ (built-in)  |
| Designed for replay      | ✅               | ❌             |
| Designed for audit trail | ❌               | ✅             |

## Persistent Backend Example

```typescript
import Database from "better-sqlite3";

const db = new Database("audit.db");
db.exec(`CREATE TABLE IF NOT EXISTS audit (
  step_index INTEGER, type TEXT, timestamp INTEGER, shared TEXT, error TEXT
)`);

const sqliteStore: AuditLogStore = {
  append: ({ stepIndex, type, timestamp, shared, error }) => {
    db.prepare(`INSERT INTO audit VALUES (?, ?, ?, ?, ?)`).run(
      stepIndex,
      type,
      timestamp,
      JSON.stringify(shared),
      error ?? null,
    );
  },
};
```
