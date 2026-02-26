# KVMemory

A key-value store for episodic or entity-level memory. Unlike `BufferWindowMemory` (which records a message log), `KVMemory` stores discrete named facts — user preferences, extracted entities, episodic knowledge — that persist across turns and can be serialised.

## Usage

```typescript
import { KVMemory } from "flowneer/plugins/memory";

const kv = new KVMemory();

kv.set("user.name", "Alice");
kv.set("user.preference", "concise answers");
kv.set("last.topic", "machine learning");

console.log(kv.getValue("user.name")); // "Alice"
console.log(kv.keys()); // ["user.name", "user.preference", "last.topic"]
console.log(kv.size); // 3

console.log(kv.toContext());
// "- user.name: Alice\n- user.preference: concise answers\n- last.topic: machine learning"

kv.delete("last.topic");
```

## Methods

| Method              | Signature                      | Description                                                  |
| ------------------- | ------------------------------ | ------------------------------------------------------------ |
| `set`               | `(key, value: string) => void` | Store or overwrite a key-value pair                          |
| `getValue`          | `(key) => string \| undefined` | Retrieve a value by key                                      |
| `delete`            | `(key) => boolean`             | Delete a key; returns `true` if it existed                   |
| `keys`              | `() => string[]`               | List all stored keys                                         |
| `size`              | `number` (getter)              | Number of entries                                            |
| `add`               | `(msg: MemoryMessage) => void` | Memory interface compat — stores as `msg_N: content`         |
| `get`               | `() => MemoryMessage[]`        | Memory interface compat — returns entries as system messages |
| `clear`             | `() => void`                   | Remove all entries                                           |
| `toContext`         | `() => string`                 | Bullet-style `"- key: value"` string                         |
| `toJSON`            | `() => string`                 | Serialise entire store to JSON                               |
| `KVMemory.fromJSON` | `(json: string) => KVMemory`   | Restore from JSON                                            |

## Persistence Pattern

Because `toJSON` / `fromJSON` are synchronous, KVMemory is easy to persist between sessions:

```typescript
import fs from "fs";
import { KVMemory } from "flowneer/plugins/memory";

// Restore from disk
const raw = fs.existsSync("memory.json")
  ? fs.readFileSync("memory.json", "utf8")
  : "{}";
const kv = KVMemory.fromJSON(raw);

// … run flow …

// Save back
fs.writeFileSync("memory.json", kv.toJSON());
```

## With `withMemory`

```typescript
import { FlowBuilder } from "flowneer";
import { withMemory, KVMemory } from "flowneer/plugins/memory";

FlowBuilder.use(withMemory);

const kv = new KVMemory();
const flow = new FlowBuilder<State>().withMemory(kv).startWith(async (s) => {
  (s.__memory as KVMemory).set("last.intent", s.intent);
  const ctx = await s.__memory!.toContext();
  s.response = await callLlm(buildPrompt(ctx, s.userInput));
});
```
