// ---------------------------------------------------------------------------
// parseTable — extract a markdown table from LLM output
// ---------------------------------------------------------------------------

/**
 * Parses a GitHub-Flavoured Markdown table into an array of objects.
 *
 * The first row is treated as the header; the separator row (`|---|---|`)
 * is skipped. Each subsequent row becomes an object keyed by header names.
 *
 * @example
 * const rows = parseMarkdownTable(`
 * | Name  | Age |
 * |-------|-----|
 * | Alice | 30  |
 * | Bob   | 25  |
 * `);
 * // [{ Name: "Alice", Age: "30" }, { Name: "Bob", Age: "25" }]
 */
export function parseMarkdownTable(text: string): Record<string, string>[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"));

  if (lines.length < 2) return [];

  const splitRow = (line: string): string[] =>
    line
      .split("|")
      .slice(1, -1) // drop empty leading/trailing from |col|col|
      .map((cell) => cell.trim());

  const headers = splitRow(lines[0]!);

  // Skip separator row(s) like |---|---|
  const dataStart = lines.findIndex((l, i) => i > 0 && !/^[|\s:-]+$/.test(l));
  if (dataStart < 0) return [];

  const rows: Record<string, string>[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const cells = splitRow(lines[i]!);
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]!] = cells[j] ?? "";
    }
    rows.push(obj);
  }

  return rows;
}
