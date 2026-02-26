# parseListOutput

Parses a bulleted, numbered, or newline-separated list from LLM output into a clean string array.

## Import

```typescript
import { parseListOutput } from "flowneer/plugins/output";
```

## Usage

```typescript
const items = parseListOutput("- apples\n- bananas\n- oranges");
// ["apples", "bananas", "oranges"]

const items2 = parseListOutput("1. First item\n2. Second item\n3. Third item");
// ["First item", "Second item", "Third item"]

const items3 = parseListOutput("• item one\n• item two");
// ["item one", "item two"]

const items4 = parseListOutput("alpha\nbeta\ngamma");
// ["alpha", "beta", "gamma"]
```

## Signature

```typescript
function parseListOutput(text: string): string[];
```

## Supported Formats

| Format           | Example               |
| ---------------- | --------------------- |
| Dash bullets     | `- item`              |
| Asterisk bullets | `* item`              |
| Bullet character | `• item`              |
| Numbered (dot)   | `1. item`             |
| Numbered (paren) | `1) item`             |
| Plain newlines   | `item` (one per line) |

Empty lines and whitespace-only entries are stripped from the result.

## In a Flow

```typescript
.then(async (s) => {
  const raw = await callLlm(
    `List 5 keywords for: "${s.topic}". One per line, no numbering.`
  );
  s.keywords = parseListOutput(raw);
  // s.keywords: ["AI", "machine learning", "deep learning", "NLP", "GPT"]
})
```
