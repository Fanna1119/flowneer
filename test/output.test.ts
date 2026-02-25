// ---------------------------------------------------------------------------
// Tests for output parsers
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { parseJsonOutput } from "../plugins/output/parseJson";
import { parseListOutput } from "../plugins/output/parseList";
import { parseMarkdownTable } from "../plugins/output/parseTable";
import { parseRegexOutput } from "../plugins/output/parseRegex";

// ─────────────────────────────────────────────────────────────────────────────
// parseJsonOutput
// ─────────────────────────────────────────────────────────────────────────────

describe("parseJsonOutput", () => {
  test("parses a raw JSON string", () => {
    expect(parseJsonOutput('{"a":1}')).toEqual({ a: 1 });
  });

  test("parses a JSON array", () => {
    expect(parseJsonOutput("[1,2,3]")).toEqual([1, 2, 3]);
  });

  test("strips markdown json code fence", () => {
    const text = '```json\n{"x":42}\n```';
    expect(parseJsonOutput(text)).toEqual({ x: 42 });
  });

  test("strips plain code fence", () => {
    const text = '```\n{"y":7}\n```';
    expect(parseJsonOutput(text)).toEqual({ y: 7 });
  });

  test("extracts JSON object embedded in prose", () => {
    const text = 'The answer is {"score": 9} based on analysis.';
    expect(parseJsonOutput(text) as any).toEqual({ score: 9 });
  });

  test("extracts JSON array embedded in prose", () => {
    const text = "Items: [1,2,3] are valid.";
    expect(parseJsonOutput(text)).toEqual([1, 2, 3]);
  });

  test("throws when no valid JSON is found", () => {
    expect(() => parseJsonOutput("no json here at all")).toThrow();
  });

  test("runs validator when provided", () => {
    const validator = {
      parse: (x: unknown): { n: number } => {
        if (typeof (x as any)?.n !== "number") throw new Error("invalid");
        return x as { n: number };
      },
    };
    expect(parseJsonOutput('{"n":5}', validator)).toEqual({ n: 5 });
  });

  test("throws validator error when schema fails", () => {
    const validator = {
      parse: (x: unknown): { n: number } => {
        const obj = x as any;
        if (typeof obj?.n !== "number") throw new Error("bad schema");
        return obj;
      },
    };
    expect(() => parseJsonOutput('{"wrong":true}', validator)).toThrow(
      "bad schema",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseListOutput
// ─────────────────────────────────────────────────────────────────────────────

describe("parseListOutput", () => {
  test("parses dash-prefixed list", () => {
    expect(parseListOutput("- apple\n- banana\n- cherry")).toEqual([
      "apple",
      "banana",
      "cherry",
    ]);
  });

  test("parses asterisk-prefixed list", () => {
    expect(parseListOutput("* one\n* two")).toEqual(["one", "two"]);
  });

  test("parses bullet prefix (•)", () => {
    expect(parseListOutput("• first\n• second")).toEqual(["first", "second"]);
  });

  test("parses numbered list with period", () => {
    expect(parseListOutput("1. foo\n2. bar\n3. baz")).toEqual([
      "foo",
      "bar",
      "baz",
    ]);
  });

  test("parses numbered list with parenthesis", () => {
    expect(parseListOutput("1) a\n2) b")).toEqual(["a", "b"]);
  });

  test("parses plain newline-separated items", () => {
    expect(parseListOutput("alpha\nbeta\ngamma")).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  test("strips empty lines", () => {
    expect(parseListOutput("- a\n\n- b\n\n- c")).toEqual(["a", "b", "c"]);
  });

  test("returns empty array for blank string", () => {
    expect(parseListOutput("")).toEqual([]);
    expect(parseListOutput("   \n   ")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseMarkdownTable
// ─────────────────────────────────────────────────────────────────────────────

describe("parseMarkdownTable", () => {
  const table = `| Name  | Age |
|-------|-----|
| Alice | 30  |
| Bob   | 25  |`;

  test("parses a basic markdown table", () => {
    const rows = parseMarkdownTable(table);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ Name: "Alice", Age: "30" });
    expect(rows[1]).toEqual({ Name: "Bob", Age: "25" });
  });

  test("returns empty array when no table is found", () => {
    expect(parseMarkdownTable("no table here")).toEqual([]);
  });

  test("returns empty array for header-only table", () => {
    expect(parseMarkdownTable("| A | B |\n|---|---|")).toEqual([]);
  });

  test("handles extra whitespace in cells", () => {
    const t = `|  Name  |  Score  |\n|--------|----------|\n|  Eve   |   99    |`;
    const rows = parseMarkdownTable(t);
    expect(rows[0]).toEqual({ Name: "Eve", Score: "99" });
  });

  test("handles missing cells (fills with empty string)", () => {
    const t = `| A | B | C |\n|---|---|---|\n| 1 | 2 |`;
    const rows = parseMarkdownTable(t);
    expect(rows[0]!["C"]).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseRegexOutput
// ─────────────────────────────────────────────────────────────────────────────

describe("parseRegexOutput", () => {
  test("extracts named capture groups", () => {
    const result = parseRegexOutput(
      "Action: search Query: quantum",
      /Action:\s*(?<action>\w+)\s+Query:\s*(?<query>\w+)/,
    );
    expect(result).toEqual({ action: "search", query: "quantum" });
  });

  test("extracts positional groups with provided names", () => {
    const result = parseRegexOutput("SCORE: 8/10", "SCORE:\\s*(\\d+)/(\\d+)", [
      "score",
      "total",
    ]);
    expect(result).toEqual({ score: "8", total: "10" });
  });

  test("falls back to group_N naming for unnamed positional groups", () => {
    const result = parseRegexOutput("foo bar", "^(\\w+)\\s+(\\w+)$");
    expect(result).toEqual({ group_1: "foo", group_2: "bar" });
  });

  test("returns null when pattern does not match", () => {
    expect(parseRegexOutput("hello", /(\d+)/)).toBeNull();
  });

  test("accepts string pattern", () => {
    const result = parseRegexOutput("key=value", "key=(\\w+)", ["val"]);
    expect(result).toEqual({ val: "value" });
  });

  test("named groups with empty optional capture return empty string", () => {
    const result = parseRegexOutput(
      "Thought: reflect",
      /Thought:\s*(?<thought>[^\n]*)(?:\nAction:\s*(?<action>[^\n]*))?/,
    );
    expect(result!["thought"]).toBe("reflect");
  });
});
