# parseMarkdownTable

Parses a GitHub-Flavored Markdown table from LLM output into an array of objects, one per data row.

## Import

```typescript
import { parseMarkdownTable } from "flowneer/plugins/output";
```

## Usage

```typescript
const rows = parseMarkdownTable(`
| Name  | Age | Role       |
|-------|-----|------------|
| Alice | 30  | Engineer   |
| Bob   | 25  | Designer   |
| Carol | 35  | Manager    |
`);

// [
//   { Name: "Alice", Age: "30", Role: "Engineer" },
//   { Name: "Bob",   Age: "25", Role: "Designer" },
//   { Name: "Carol", Age: "35", Role: "Manager"  },
// ]
```

## Signature

```typescript
function parseMarkdownTable(text: string): Record<string, string>[];
```

Returns an empty array `[]` if the text contains no valid table.

## Notes

- The first row is treated as the header.
- The separator row (`|---|---|`) is automatically skipped.
- Cell values are trimmed of whitespace.
- All values are strings — apply type conversions (`Number()`, etc.) as needed.
- Partial rows (fewer cells than headers) are handled gracefully with empty string defaults.

## In a Flow

```typescript
.then(async (s) => {
  s.__llmOutput = await callLlm(
    `Compare these products in a markdown table with columns: Name, Price, Rating:\n${s.products}`
  );
})
.then((s) => {
  const rows = parseMarkdownTable(s.__llmOutput!);
  s.comparison = rows.map((r) => ({
    name:   r.Name,
    price:  Number(r.Price.replace(/[^0-9.]/g, "")),
    rating: Number(r.Rating),
  }));
})
```
