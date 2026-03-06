// ---------------------------------------------------------------------------
// Flowneer — built-in PII detector helpers
// ---------------------------------------------------------------------------
//
// Pure functions — no coupling to the compliance plugin interfaces.
// Consume these inside RuntimeInspector.check() or pass to scanShared().
//
// ---------------------------------------------------------------------------

/** A field whose value matched a PII pattern. */
export interface PiiMatch {
  path: string;
  pattern: string;
  value: string;
}

// ---------------------------------------------------------------------------
// Built-in patterns
// ---------------------------------------------------------------------------

const PATTERNS: Record<string, RegExp> = {
  email: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/,
  phone: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/,
  ipv4: /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
  creditCard: /\b(?:\d[ -]?){13,16}\b/,
};

// ---------------------------------------------------------------------------
// scanShared — walk a shared object and return matching fields
// ---------------------------------------------------------------------------

/**
 * Walk `obj` and return every field whose string value matches a built-in PII
 * pattern. Pass `paths` to restrict the scan to specific dot-separated key
 * paths (e.g. `["user.email", "profile.phone"]`).
 *
 * Only string values are tested — nested objects are recursed into automatically
 * unless `paths` scopes the search.
 *
 * @example
 * const hits = scanShared(shared);
 * if (hits.length > 0) return `PII detected: ${hits.map(h => h.path).join(", ")}`;
 */
export function scanShared(obj: unknown, paths?: string[]): PiiMatch[] {
  if (paths) {
    const matches: PiiMatch[] = [];
    for (const p of paths) {
      const value = getPath(obj, p);
      if (typeof value === "string") {
        for (const [name, re] of Object.entries(PATTERNS)) {
          if (re.test(value)) matches.push({ path: p, pattern: name, value });
        }
      }
    }
    return matches;
  }

  return walkObj(obj, "");
}

function walkObj(obj: unknown, prefix: string): PiiMatch[] {
  if (obj === null || typeof obj !== "object") {
    if (typeof obj === "string") {
      return testPatterns(obj, prefix || "value");
    }
    return [];
  }
  const matches: PiiMatch[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      matches.push(...testPatterns(v, path));
    } else if (v && typeof v === "object") {
      matches.push(...walkObj(v, path));
    }
  }
  return matches;
}

function testPatterns(value: string, path: string): PiiMatch[] {
  const matches: PiiMatch[] = [];
  for (const [name, re] of Object.entries(PATTERNS)) {
    if (re.test(value)) matches.push({ path, pattern: name, value });
  }
  return matches;
}

function getPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}
