# parseRegexOutput

Extracts structured data from LLM text using regular expression capture groups. Supports both named groups and positional groups with explicit names.

## Import

```typescript
import { parseRegexOutput } from "flowneer/plugins/output";
```

## Usage

### Named groups (recommended)

```typescript
const result = parseRegexOutput(
  "Action: search Query: quantum computing",
  /Action:\s*(?<action>\w+)\s+Query:\s*(?<query>.+)/,
);
// { action: "search", query: "quantum computing" }
```

### Positional groups with names

```typescript
const result = parseRegexOutput(
  "SCORE: 8/10",
  "SCORE:\\s*(\\d+)/(\\d+)",
  ["score", "total"], // maps group 1 → "score", group 2 → "total"
);
// { score: "8", total: "10" }
```

### No match

```typescript
const result = parseRegexOutput("no match here", /Action:\s*(\w+)/);
// null
```

## Signature

```typescript
function parseRegexOutput(
  text: string,
  pattern: RegExp | string,
  groups?: string[],
): Record<string, string> | null;
```

## Parameters

| Parameter | Type               | Description                                                     |
| --------- | ------------------ | --------------------------------------------------------------- |
| `text`    | `string`           | LLM output to parse                                             |
| `pattern` | `RegExp \| string` | Pattern with capture groups                                     |
| `groups`  | `string[]`         | Names for positional captures (used when no named groups exist) |

Returns `null` if the pattern does not match.

All captured values are strings — apply `Number()`, `parseFloat()`, etc. as needed.

## Fallback Indexing

If neither named groups nor `groups` array is provided, positional captures are returned as `group_1`, `group_2`, etc.:

```typescript
parseRegexOutput("foo 42 bar", /(\w+)\s+(\d+)/);
// { group_1: "foo", group_2: "42" }
```

## In a Flow

```typescript
.then(async (s) => {
  s.__llmOutput = await callLlm(`Rate the sentiment (1-10): "${s.text}"`);
})
.then((s) => {
  const match = parseRegexOutput(s.__llmOutput!, /Score:\s*(?<score>\d+)/);
  s.score = match ? Number(match.score) : 5; // default 5 if no match
})
```
