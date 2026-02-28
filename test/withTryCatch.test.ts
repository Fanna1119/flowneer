// ---------------------------------------------------------------------------
// Tests for plugins/resilience/withTryCatch
// ---------------------------------------------------------------------------

import { describe, expect, test } from "bun:test";
import { FlowBuilder, FlowError, fragment } from "../Flowneer";
import { withTryCatch } from "../plugins/resilience/withTryCatch";

FlowBuilder.use(withTryCatch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFlow<S extends object>() {
  return new FlowBuilder<S>();
}

// ---------------------------------------------------------------------------
// Happy path — no error
// ---------------------------------------------------------------------------

describe("withTryCatch — happy path", () => {
  test("try runs and flow continues normally", async () => {
    const s: { order: string[] } = { order: [] };

    await makeFlow<typeof s>()
      .try(
        fragment<typeof s>()
          .then((x) => {
            x.order.push("try1");
          })
          .then((x) => {
            x.order.push("try2");
          }),
      )
      .then((x) => {
        x.order.push("after");
      })
      .run(s);

    expect(s.order).toEqual(["try1", "try2", "after"]);
  });

  test("catch fragment does NOT run when try succeeds", async () => {
    const s: { caught: boolean } = { caught: false };

    await makeFlow<typeof s>()
      .try(fragment<typeof s>().then(() => {}))
      .catch(
        fragment<typeof s>().then((x) => {
          x.caught = true;
        }),
      )
      .run(s);

    expect(s.caught).toBe(false);
  });

  test("finally always runs even when try succeeds", async () => {
    const s: { order: string[] } = { order: [] };

    await makeFlow<typeof s>()
      .try(
        fragment<typeof s>().then((x) => {
          x.order.push("try");
        }),
      )
      .finally(
        fragment<typeof s>().then((x) => {
          x.order.push("finally");
        }),
      )
      .then((x) => {
        x.order.push("after");
      })
      .run(s);

    expect(s.order).toEqual(["try", "finally", "after"]);
  });

  test("try + catch + finally — only try and finally run on success", async () => {
    const s: { order: string[] } = { order: [] };

    await makeFlow<typeof s>()
      .try(
        fragment<typeof s>().then((x) => {
          x.order.push("try");
        }),
      )
      .catch(
        fragment<typeof s>().then((x) => {
          x.order.push("catch");
        }),
      )
      .finally(
        fragment<typeof s>().then((x) => {
          x.order.push("finally");
        }),
      )
      .run(s);

    expect(s.order).toEqual(["try", "finally"]);
  });
});

// ---------------------------------------------------------------------------
// Error handling — catch receives error
// ---------------------------------------------------------------------------

describe("withTryCatch — error handling", () => {
  test("catch fragment runs when try throws", async () => {
    const s: { caught: boolean } = { caught: false };

    await makeFlow<typeof s>()
      .try(
        fragment<typeof s>().then(() => {
          throw new Error("boom");
        }),
      )
      .catch(
        fragment<typeof s>().then((x) => {
          x.caught = true;
        }),
      )
      .run(s);

    expect(s.caught).toBe(true);
  });

  test("shared.__tryError is set inside catch fragment", async () => {
    const s: { errMsg?: string } = {};

    await makeFlow<typeof s>()
      .try(
        fragment<typeof s>().then(() => {
          throw new Error("original error");
        }),
      )
      .catch(
        fragment<typeof s>().then((x: any) => {
          x.errMsg =
            x.__tryError instanceof Error
              ? x.__tryError.message
              : String(x.__tryError);
        }),
      )
      .run(s);

    // __tryError is the original cause, not a FlowError wrapper
    expect(s.errMsg).toBe("original error");
  });

  test("shared.__tryError is deleted after catch fragment completes", async () => {
    const s: any = {};

    await makeFlow<typeof s>()
      .try(
        fragment<typeof s>().then(() => {
          throw new Error("x");
        }),
      )
      .catch(fragment<typeof s>().then(() => {}))
      .run(s);

    expect("__tryError" in s).toBe(false);
  });

  test("error propagates when no catch fragment is registered", async () => {
    const s: any = {};

    await expect(
      makeFlow<typeof s>()
        .try(
          fragment<typeof s>().then(() => {
            throw new Error("unhandled");
          }),
        )
        .run(s),
    ).rejects.toThrow("unhandled");
  });

  test("finally runs even when try throws (with catch)", async () => {
    const s: { order: string[] } = { order: [] };

    await makeFlow<typeof s>()
      .try(
        fragment<typeof s>().then(() => {
          throw new Error("fail");
        }),
      )
      .catch(
        fragment<typeof s>().then((x) => {
          x.order.push("catch");
        }),
      )
      .finally(
        fragment<typeof s>().then((x) => {
          x.order.push("finally");
        }),
      )
      .run(s);

    expect(s.order).toEqual(["catch", "finally"]);
  });

  test("finally runs even when try throws (no catch — error still bubbles after finally)", async () => {
    const s: { finallyRan: boolean } = { finallyRan: false };

    await expect(
      makeFlow<typeof s>()
        .try(
          fragment<typeof s>().then(() => {
            throw new Error("boom");
          }),
        )
        .finally(
          fragment<typeof s>().then((x) => {
            x.finallyRan = true;
          }),
        )
        .run(s),
    ).rejects.toThrow("boom");

    expect(s.finallyRan).toBe(true);
  });

  test("error from catch propagates after finally runs", async () => {
    const s: { finallyRan: boolean } = { finallyRan: false };

    await expect(
      makeFlow<typeof s>()
        .try(
          fragment<typeof s>().then(() => {
            throw new Error("try-err");
          }),
        )
        .catch(
          fragment<typeof s>().then(() => {
            throw new Error("catch-err");
          }),
        )
        .finally(
          fragment<typeof s>().then((x) => {
            x.finallyRan = true;
          }),
        )
        .run(s),
    ).rejects.toThrow("catch-err");

    expect(s.finallyRan).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Anchor routing inside catch / finally
// ---------------------------------------------------------------------------

describe("withTryCatch — anchors inside fragments", () => {
  test("anchor routing works inside catch fragment", async () => {
    const s: { order: string[] } = { order: [] };

    await makeFlow<typeof s>()
      .try(
        fragment<typeof s>().then(() => {
          throw new Error("fail");
        }),
      )
      .catch(
        fragment<typeof s>()
          .then((x) => {
            x.order.push("before-anchor");
            return "#recover";
          })
          .then((x) => {
            x.order.push("skipped");
          })
          .anchor("recover")
          .then((x) => {
            x.order.push("after-anchor");
          }),
      )
      .run(s);

    expect(s.order).toEqual(["before-anchor", "after-anchor"]);
  });
});

// ---------------------------------------------------------------------------
// Multiple and sequential try blocks
// ---------------------------------------------------------------------------

describe("withTryCatch — multiple blocks", () => {
  test("two independent try blocks in one flow both execute", async () => {
    const s: { order: string[] } = { order: [] };

    await makeFlow<typeof s>()
      .try(
        fragment<typeof s>().then((x) => {
          x.order.push("try1");
        }),
      )
      .catch(
        fragment<typeof s>().then((x) => {
          x.order.push("catch1");
        }),
      )
      .try(
        fragment<typeof s>().then((x) => {
          x.order.push("try2");
        }),
      )
      .catch(
        fragment<typeof s>().then((x) => {
          x.order.push("catch2");
        }),
      )
      .run(s);

    expect(s.order).toEqual(["try1", "try2"]);
  });

  test("second try block is independent of first", async () => {
    const s: { order: string[] } = { order: [] };

    await makeFlow<typeof s>()
      .try(
        fragment<typeof s>().then(() => {
          throw new Error("first");
        }),
      )
      .catch(
        fragment<typeof s>().then((x) => {
          x.order.push("catch1");
        }),
      )
      .try(
        fragment<typeof s>().then(() => {
          throw new Error("second");
        }),
      )
      .catch(
        fragment<typeof s>().then((x) => {
          x.order.push("catch2");
        }),
      )
      .run(s);

    expect(s.order).toEqual(["catch1", "catch2"]);
  });
});

// ---------------------------------------------------------------------------
// FlowError wrapping
// ---------------------------------------------------------------------------

describe("withTryCatch — FlowError from inner steps", () => {
  test("FlowError thrown inside try is caught normally", async () => {
    const s: { caught: boolean } = { caught: false };

    const badFlow = new FlowBuilder().startWith(() => {
      throw new Error("inner");
    });

    await makeFlow<typeof s>()
      .try(
        fragment<typeof s>().then(async () => {
          await badFlow.run({});
        }),
      )
      .catch(
        fragment<typeof s>().then((x) => {
          x.caught = true;
        }),
      )
      .run(s);

    expect(s.caught).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Misuse — developer errors
// ---------------------------------------------------------------------------

describe("withTryCatch — misuse errors", () => {
  test(".catch() without prior .try() throws synchronously", () => {
    expect(() => {
      (new FlowBuilder() as any).catch(fragment());
    }).toThrow(".catch() must be called immediately after .try()");
  });

  test(".finally() without prior .try() throws synchronously", () => {
    expect(() => {
      (new FlowBuilder() as any).finally(fragment());
    }).toThrow(".finally() must be called after .try()");
  });
});
