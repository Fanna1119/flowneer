// ---------------------------------------------------------------------------
// Tests for new plugins: stream, withStructuredOutput, tools, agent, memory,
// withCallbacks, withTelemetry
// ---------------------------------------------------------------------------

import { describe, expect, test, mock } from "bun:test";
import { FlowBuilder, InterruptError } from "../Flowneer";
import type { StreamEvent } from "../Flowneer";

import { withStructuredOutput } from "../plugins/llm/withStructuredOutput";
import {
  withTools,
  ToolRegistry,
  getTools,
  executeTool,
  executeTools,
} from "../plugins/tools";
import type { Tool, ToolCall } from "../plugins/tools";
import { withReActLoop } from "../plugins/agent/withReActLoop";
import { withHumanNode, resumeFlow } from "../plugins/agent/withHumanNode";
import {
  supervisorCrew,
  sequentialCrew,
  hierarchicalCrew,
  roundRobinDebate,
} from "../plugins/agent/patterns";
import {
  BufferWindowMemory,
  SummaryMemory,
  KVMemory,
  withMemory,
} from "../plugins/memory";
import { withCallbacks } from "../plugins/observability/withCallbacks";
import { withTelemetry } from "../plugins/telemetry";
import { TelemetryDaemon } from "../plugins/telemetry/telemetry";
import { emit } from "../plugins/messaging";

FlowBuilder.use(withStructuredOutput);
FlowBuilder.use(withTools);
FlowBuilder.use(withReActLoop);
FlowBuilder.use(withHumanNode);
FlowBuilder.use(withCallbacks);
FlowBuilder.use(withTelemetry);
FlowBuilder.use(withMemory);

// ─────────────────────────────────────────────────────────────────────────────
// .stream()
// ─────────────────────────────────────────────────────────────────────────────

describe(".stream()", () => {
  test("yields step:before and step:after for each step", async () => {
    const events: StreamEvent[] = [];
    const flow = new FlowBuilder()
      .startWith(async () => {})
      .then(async () => {});

    for await (const e of flow.stream({})) events.push(e);

    const types = events.map((e) => e.type);
    expect(types).toContain("step:before");
    expect(types).toContain("step:after");
    expect(types).toContain("done");
    // 2 steps × (before + after) + done
    expect(types.filter((t) => t === "step:before").length).toBe(2);
    expect(types.filter((t) => t === "step:after").length).toBe(2);
  });

  test("yields chunk events from emit()", async () => {
    const chunks: unknown[] = [];
    const flow = new FlowBuilder<{ __stream?: any }>().startWith((s) => {
      emit(s, "hello");
      emit(s, "world");
    });

    for await (const e of flow.stream({})) {
      if (e.type === "chunk") chunks.push(e.data);
    }

    expect(chunks).toEqual(["hello", "world"]);
  });

  test("yields error event when a step throws", async () => {
    const flow = new FlowBuilder().startWith(() => {
      throw new Error("boom");
    });

    const events: StreamEvent[] = [];
    for await (const e of flow.stream({})) events.push(e);

    const err = events.find((e) => e.type === "error");
    expect(err).toBeDefined();
    // done is still yielded after error
    expect(events.at(-1)?.type).toBe("done");
  });

  test("done is always the last event", async () => {
    const flow = new FlowBuilder()
      .startWith(async () => {})
      .then(async () => {});

    const events: StreamEvent[] = [];
    for await (const e of flow.stream({})) events.push(e);

    expect(events.at(-1)?.type).toBe("done");
  });

  test("step:after carries current shared state", async () => {
    const s = { value: 0 };
    const flow = new FlowBuilder<typeof s>().startWith((s) => {
      s.value = 42;
    });

    const afterEvents: Extract<
      StreamEvent<typeof s>,
      { type: "step:after" }
    >[] = [];
    for await (const e of flow.stream(s)) {
      if (e.type === "step:after") afterEvents.push(e as any);
    }

    expect(afterEvents[0]?.shared.value).toBe(42);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withStructuredOutput
// ─────────────────────────────────────────────────────────────────────────────

describe("withStructuredOutput", () => {
  const numberValidator = {
    parse: (x: unknown): { n: number } => {
      if (typeof (x as any)?.n !== "number") throw new Error("invalid");
      return x as { n: number };
    },
  };

  test("parses and stores valid JSON output", async () => {
    const s: any = {};
    await (new FlowBuilder<any>() as any)
      .withStructuredOutput(numberValidator)
      .startWith((s: any) => {
        s.__llmOutput = '{"n":7}';
      })
      .run(s);

    expect(s.__structuredOutput).toEqual({ n: 7 });
  });

  test("uses custom outputKey and resultKey", async () => {
    const s: any = {};
    await (new FlowBuilder<any>() as any)
      .withStructuredOutput(numberValidator, {
        outputKey: "raw",
        resultKey: "parsed",
      })
      .startWith((s: any) => {
        s.raw = '{"n":3}';
      })
      .run(s);

    expect(s.parsed).toEqual({ n: 3 });
  });

  test("skips when outputKey is absent", async () => {
    const s: any = {};
    await (new FlowBuilder<any>() as any)
      .withStructuredOutput(numberValidator)
      .startWith(async () => {
        /* no __llmOutput */
      })
      .run(s);

    expect(s.__structuredOutput).toBeUndefined();
  });

  test("stores __validationError when validation fails", async () => {
    const s: any = {};
    await (new FlowBuilder<any>() as any)
      .withStructuredOutput(numberValidator)
      .startWith((s: any) => {
        s.__llmOutput = '{"wrong":true}';
      })
      .run(s);

    expect(s.__validationError).toBeDefined();
    expect(s.__validationError.message).toContain("invalid");
  });

  test("clears __validationError on subsequent success", async () => {
    const s: any = { __validationError: { message: "stale error" } };
    await (new FlowBuilder<any>() as any)
      .withStructuredOutput(numberValidator)
      .startWith((s: any) => {
        s.__llmOutput = '{"n":1}';
      })
      .run(s);

    expect(s.__validationError).toBeUndefined();
    expect(s.__structuredOutput).toEqual({ n: 1 });
  });

  test("custom parse function is applied before validator", async () => {
    const csvValidator = {
      parse: (x: unknown): string[] => {
        if (!Array.isArray(x)) throw new Error("expected array");
        return x as string[];
      },
    };
    const s: any = {};
    await (new FlowBuilder<any>() as any)
      .withStructuredOutput(csvValidator, {
        parse: (raw: string) => raw.split(",").map((v) => v.trim()),
      })
      .startWith((s: any) => {
        s.__llmOutput = "apple, banana, cherry";
      })
      .run(s);

    expect(s.__structuredOutput).toEqual(["apple", "banana", "cherry"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ToolRegistry
// ─────────────────────────────────────────────────────────────────────────────

const addTool: Tool = {
  name: "add",
  description: "Add two numbers",
  params: {
    a: { type: "number", description: "first" },
    b: { type: "number", description: "second" },
  },
  execute: ({ a, b }: { a: number; b: number }) => ({ result: a + b }),
};

const failTool: Tool = {
  name: "fail",
  description: "Always fails",
  params: {},
  execute: () => {
    throw new Error("tool error");
  },
};

describe("ToolRegistry", () => {
  test("has / get / names", () => {
    const reg = new ToolRegistry([addTool]);
    expect(reg.has("add")).toBe(true);
    expect(reg.has("unknown")).toBe(false);
    expect(reg.get("add")).toBe(addTool);
    expect(reg.names()).toEqual(["add"]);
  });

  test("definitions() returns correct schema shape", () => {
    const reg = new ToolRegistry([addTool]);
    const defs = reg.definitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]!.name).toBe("add");
    expect(defs[0]!.parameters.type).toBe("object");
    expect(Object.keys(defs[0]!.parameters.properties)).toEqual(["a", "b"]);
    expect(defs[0]!.parameters.required).toEqual(["a", "b"]);
  });

  test("execute runs the tool and returns result", async () => {
    const reg = new ToolRegistry([addTool]);
    const res = await reg.execute({ name: "add", args: { a: 3, b: 4 } });
    expect(res.result).toEqual({ result: 7 });
    expect(res.error).toBeUndefined();
  });

  test("execute returns error object for unknown tool", async () => {
    const reg = new ToolRegistry([addTool]);
    const res = await reg.execute({ name: "nope", args: {} });
    expect(res.error).toContain("unknown tool");
  });

  test("execute returns error object when tool throws", async () => {
    const reg = new ToolRegistry([failTool]);
    const res = await reg.execute({ name: "fail", args: {} });
    expect(res.error).toBe("tool error");
    expect(res.result).toBeUndefined();
  });

  test("executeAll runs multiple tools concurrently", async () => {
    const reg = new ToolRegistry([addTool]);
    const calls: ToolCall[] = [
      { name: "add", args: { a: 1, b: 2 } },
      { name: "add", args: { a: 10, b: 20 } },
    ];
    const results = await reg.executeAll(calls);
    expect(results).toHaveLength(2);
    expect((results[0]!.result as any).result).toBe(3);
    expect((results[1]!.result as any).result).toBe(30);
  });

  test("callId is preserved in result", async () => {
    const reg = new ToolRegistry([addTool]);
    const res = await reg.execute({
      id: "req-1",
      name: "add",
      args: { a: 0, b: 0 },
    });
    expect(res.callId).toBe("req-1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withTools + helpers
// ─────────────────────────────────────────────────────────────────────────────

describe("withTools", () => {
  test("attaches ToolRegistry to shared.__tools before first step", async () => {
    const s: any = {};
    await (new FlowBuilder<any>() as any)
      .withTools([addTool])
      .startWith((s: any) => {
        expect(s.__tools).toBeInstanceOf(ToolRegistry);
      })
      .run(s);
  });

  test("getTools helper returns the registry", async () => {
    const s: any = {};
    let found: ToolRegistry | undefined;
    await (new FlowBuilder<any>() as any)
      .withTools([addTool])
      .startWith((s: any) => {
        found = getTools(s);
      })
      .run(s);
    expect(found).toBeInstanceOf(ToolRegistry);
  });

  test("executeTool helper runs a tool from shared", async () => {
    const s: any = {};
    let res: any;
    await (new FlowBuilder<any>() as any)
      .withTools([addTool])
      .startWith(async (s: any) => {
        res = await executeTool(s, { name: "add", args: { a: 5, b: 5 } });
      })
      .run(s);
    expect((res.result as any).result).toBe(10);
  });

  test("executeTools helper runs multiple tools", async () => {
    const s: any = {};
    let results: any[];
    await (new FlowBuilder<any>() as any)
      .withTools([addTool])
      .startWith(async (s: any) => {
        results = await executeTools(s, [
          { name: "add", args: { a: 1, b: 1 } },
          { name: "add", args: { a: 2, b: 2 } },
        ]);
      })
      .run(s);
    expect((results![0].result as any).result).toBe(2);
    expect((results![1].result as any).result).toBe(4);
  });

  test("executeTool returns error when no registry is present", async () => {
    const s: any = {};
    const res = await executeTool(s, { name: "add", args: {} });
    expect(res.error).toContain("no tool registry");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withReActLoop
// ─────────────────────────────────────────────────────────────────────────────

describe("withReActLoop", () => {
  test("finishes immediately on first think -> finish", async () => {
    const s: any = {};
    await (new FlowBuilder<any>() as any)
      .withTools([addTool])
      .withReActLoop({
        think: () => ({ action: "finish", output: "done" }),
      })
      .run(s);

    expect(s.__reactOutput).toBe("done");
    expect(s.__reactExhausted).toBeUndefined();
  });

  test("executes tool calls and stores results", async () => {
    const s: any = {};
    let iterCount = 0;
    await (new FlowBuilder<any>() as any)
      .withTools([addTool])
      .withReActLoop({
        think: (s: any) => {
          iterCount++;
          if (s.__toolResults) {
            return { action: "finish", output: s.__toolResults[0].result };
          }
          return {
            action: "tool",
            calls: [{ name: "add", args: { a: 2, b: 3 } }],
          };
        },
      })
      .run(s);

    expect(iterCount).toBe(2);
    expect((s.__reactOutput as any).result).toBe(5);
  });

  test("sets __reactExhausted when maxIterations reached", async () => {
    const s: any = {};
    await (new FlowBuilder<any>() as any)
      .withTools([addTool])
      .withReActLoop({
        think: () => ({
          action: "tool" as const,
          calls: [{ name: "add", args: { a: 0, b: 0 } }],
        }),
        maxIterations: 2,
      })
      .run(s);

    expect(s.__reactExhausted).toBe(true);
  });

  test("calls onObservation after tool execution", async () => {
    const s: any = {};
    const observations: any[][] = [];
    let done = false;

    await (new FlowBuilder<any>() as any)
      .withTools([addTool])
      .withReActLoop({
        think: (s: any) => {
          if (done) return { action: "finish" };
          done = true;
          return {
            action: "tool",
            calls: [{ name: "add", args: { a: 1, b: 1 } }],
          };
        },
        onObservation: (results: any[]) => {
          observations.push(results);
        },
      })
      .run(s);

    expect(observations).toHaveLength(1);
    expect((observations[0]![0].result as any).result).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withHumanNode + resumeFlow
// ─────────────────────────────────────────────────────────────────────────────

describe("withHumanNode", () => {
  test("throws InterruptError with savedShared", async () => {
    const s = { value: 1 };
    let caught: InterruptError | undefined;
    try {
      await (new FlowBuilder<typeof s>() as any)
        .startWith(async () => {})
        .humanNode()
        .run(s);
    } catch (e) {
      if (e instanceof InterruptError) caught = e;
    }
    expect(caught).toBeInstanceOf(InterruptError);
    expect((caught!.savedShared as any).value).toBe(1);
  });

  test("stores prompt on shared", async () => {
    const s: any = {};
    let caught: InterruptError | undefined;
    try {
      await (new FlowBuilder<any>() as any)
        .startWith(async () => {})
        .humanNode({ prompt: "Please review this." })
        .run(s);
    } catch (e) {
      if (e instanceof InterruptError) caught = e;
    }
    expect(caught).toBeInstanceOf(InterruptError);
    expect((caught!.savedShared as any).__humanPrompt).toBe(
      "Please review this.",
    );
  });

  test("skips interrupt when condition returns false", async () => {
    const s = { interrupt: false };
    // Should not throw
    await (new FlowBuilder<typeof s>() as any)
      .startWith(async () => {})
      .humanNode({ condition: (s: any) => s.interrupt })
      .run(s);
  });

  test("interrupts when condition returns true", async () => {
    const s = { interrupt: true };
    await expect(
      (new FlowBuilder<typeof s>() as any)
        .startWith(async () => {})
        .humanNode({ condition: (s: any) => s.interrupt })
        .run(s),
    ).rejects.toBeInstanceOf(InterruptError);
  });

  test("resumeFlow merges edits and re-runs the flow", async () => {
    const s: any = { step: 0 };
    let capturedState: any;

    const flow = (new FlowBuilder<any>() as any).startWith((shared: any) => {
      capturedState = { ...shared };
      shared.step = 1;
    });

    await resumeFlow(flow, s, { extra: "data" });

    expect(capturedState).toBeDefined();
    expect(capturedState.extra).toBe("data");
    expect(capturedState.step).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-agent patterns
// ─────────────────────────────────────────────────────────────────────────────

describe("supervisorCrew", () => {
  test("supervisor runs, then workers in parallel, then post", async () => {
    const order: string[] = [];
    const s: any = {};

    const flow = supervisorCrew<any>(
      (s) => {
        s.supervised = true;
        order.push("supervisor");
      },
      [
        (s) => {
          s.w1 = true;
          order.push("w1");
        },
        (s) => {
          s.w2 = true;
          order.push("w2");
        },
      ],
      {
        post: (s) => {
          s.aggregated = true;
          order.push("post");
        },
      },
    );

    await flow.run(s);

    expect(s.supervised).toBe(true);
    expect(s.w1).toBe(true);
    expect(s.w2).toBe(true);
    expect(s.aggregated).toBe(true);
    expect(order[0]).toBe("supervisor");
    expect(order[order.length - 1]).toBe("post");
  });
});

describe("sequentialCrew", () => {
  test("runs all steps in order", async () => {
    const order: number[] = [];
    const s: any = {};

    const flow = sequentialCrew<any>([
      () => {
        order.push(1);
      },
      () => {
        order.push(2);
      },
      () => {
        order.push(3);
      },
    ]);

    await flow.run(s);
    expect(order).toEqual([1, 2, 3]);
  });
});

describe("hierarchicalCrew", () => {
  test("manager runs, then each team, then aggregate", async () => {
    const order: string[] = [];
    const s: any = {};

    const team1 = new FlowBuilder<any>().startWith(() => {
      order.push("team1");
    });
    const team2 = new FlowBuilder<any>().startWith(() => {
      order.push("team2");
    });

    const flow = hierarchicalCrew<any>(
      () => {
        order.push("manager");
      },
      [team1, team2],
      () => {
        order.push("aggregate");
      },
    );

    await flow.run(s);
    expect(order).toEqual(["manager", "team1", "team2", "aggregate"]);
  });
});

describe("roundRobinDebate", () => {
  test("runs each agent per round for N rounds", async () => {
    const log: string[] = [];
    const s: any = {};

    const flow = roundRobinDebate<any>(
      [
        () => {
          log.push("A");
        },
        () => {
          log.push("B");
        },
      ],
      3,
    );

    await flow.run(s);

    // 3 rounds × 2 agents = 6 entries, repeating A B A B A B
    expect(log).toEqual(["A", "B", "A", "B", "A", "B"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Memory
// ─────────────────────────────────────────────────────────────────────────────

describe("BufferWindowMemory", () => {
  test("stores and retrieves messages", () => {
    const m = new BufferWindowMemory({ maxMessages: 5 });
    m.add({ role: "user", content: "hello" });
    m.add({ role: "assistant", content: "hi" });
    expect(m.get()).toHaveLength(2);
    expect(m.get()[0]!.content).toBe("hello");
  });

  test("prunes to maxMessages", () => {
    const m = new BufferWindowMemory({ maxMessages: 2 });
    m.add({ role: "user", content: "1" });
    m.add({ role: "user", content: "2" });
    m.add({ role: "user", content: "3" });
    const msgs = m.get();
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.content).toBe("2");
    expect(msgs[1]!.content).toBe("3");
  });

  test("clear empties the buffer", () => {
    const m = new BufferWindowMemory();
    m.add({ role: "user", content: "x" });
    m.clear();
    expect(m.get()).toHaveLength(0);
  });

  test("toContext serialises messages", () => {
    const m = new BufferWindowMemory();
    m.add({ role: "user", content: "hello" });
    m.add({ role: "assistant", content: "world" });
    const ctx = m.toContext();
    expect(ctx).toContain("user: hello");
    expect(ctx).toContain("assistant: world");
  });

  test("defaults to maxMessages=20", () => {
    const m = new BufferWindowMemory();
    for (let i = 0; i < 25; i++) m.add({ role: "user", content: `${i}` });
    expect(m.get()).toHaveLength(20);
  });
});

describe("SummaryMemory", () => {
  test("keeps messages under maxMessages without summarising", async () => {
    const m = new SummaryMemory({
      maxMessages: 10,
      summarize: async () => "summary",
    });
    await m.add({ role: "user", content: "a" });
    await m.add({ role: "user", content: "b" });
    expect(m.get()).toHaveLength(2);
  });

  test("calls summarize when buffer is exceeded", async () => {
    let called = false;
    const m = new SummaryMemory({
      maxMessages: 2,
      summarize: async () => {
        called = true;
        return "compressed";
      },
    });
    await m.add({ role: "user", content: "1" });
    await m.add({ role: "user", content: "2" });
    await m.add({ role: "user", content: "3" });
    expect(called).toBe(true);
  });

  test("get includes running summary as system message", async () => {
    const m = new SummaryMemory({
      maxMessages: 2,
      summarize: async () => "the summary",
    });
    await m.add({ role: "user", content: "1" });
    await m.add({ role: "user", content: "2" });
    await m.add({ role: "user", content: "3" });
    const msgs = m.get();
    const summaryMsg = msgs.find((msg) => msg.content.includes("the summary"));
    expect(summaryMsg).toBeDefined();
  });

  test("clear resets summary and messages", async () => {
    const m = new SummaryMemory({
      maxMessages: 2,
      summarize: async () => "old summary",
    });
    await m.add({ role: "user", content: "1" });
    await m.add({ role: "user", content: "2" });
    await m.add({ role: "user", content: "3" });
    m.clear();
    expect(m.get()).toHaveLength(0);
    expect(m.toContext()).toBe("");
  });
});

describe("KVMemory", () => {
  test("set / getValue / delete / keys", () => {
    const m = new KVMemory();
    m.set("name", "Alice");
    m.set("age", "30");
    expect(m.getValue("name")).toBe("Alice");
    expect(m.keys()).toEqual(["name", "age"]);
    expect(m.delete("name")).toBe(true);
    expect(m.getValue("name")).toBeUndefined();
    expect(m.delete("missing")).toBe(false);
  });

  test("size reflects number of entries", () => {
    const m = new KVMemory();
    m.set("a", "1");
    m.set("b", "2");
    expect(m.size).toBe(2);
  });

  test("toContext returns key-value lines", () => {
    const m = new KVMemory();
    m.set("color", "blue");
    const ctx = m.toContext();
    expect(ctx).toContain("color: blue");
  });

  test("toContext is empty when store is empty", () => {
    const m = new KVMemory();
    expect(m.toContext()).toBe("");
  });

  test("toJSON / fromJSON round-trips", () => {
    const m = new KVMemory();
    m.set("x", "1");
    m.set("y", "2");
    const json = m.toJSON();
    const m2 = KVMemory.fromJSON(json);
    expect(m2.getValue("x")).toBe("1");
    expect(m2.getValue("y")).toBe("2");
  });

  test("Memory interface: add stores as msg_N, get, clear", () => {
    const m = new KVMemory();
    m.add({ role: "user", content: "hello" });
    const msgs = m.get();
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0]!.content).toContain("hello");
    m.clear();
    expect(m.size).toBe(0);
  });
});

describe("withMemory", () => {
  test("attaches memory instance to shared.__memory", async () => {
    const s: any = {};
    const memory = new BufferWindowMemory();
    await (new FlowBuilder<any>() as any)
      .withMemory(memory)
      .startWith((s: any) => {
        expect(s.__memory).toBe(memory);
      })
      .run(s);
  });

  test("memory is accessible throughout flow steps", async () => {
    const s: any = {};
    const memory = new BufferWindowMemory();
    await (new FlowBuilder<any>() as any)
      .withMemory(memory)
      .startWith((s: any) => {
        s.__memory.add({ role: "user", content: "step1" });
      })
      .then((s: any) => {
        s.__memory.add({ role: "assistant", content: "step2" });
      })
      .run(s);

    expect(memory.get()).toHaveLength(2);
    expect(memory.get()[0]!.content).toBe("step1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withCallbacks
// ─────────────────────────────────────────────────────────────────────────────

describe("withCallbacks", () => {
  test("onChainStart / onChainEnd fire for unlabeled steps", async () => {
    const events: string[] = [];
    const s: any = {};
    await (new FlowBuilder<any>() as any)
      .withCallbacks({
        onChainStart: () => events.push("chainStart"),
        onChainEnd: () => events.push("chainEnd"),
      })
      .startWith(async () => {})
      .run(s);
    expect(events).toContain("chainStart");
    expect(events).toContain("chainEnd");
  });

  test("onLLMStart / onLLMEnd fire for steps with label 'llm:*'", async () => {
    const events: string[] = [];
    const s: any = {};

    // We insert a hook to set a label via a custom plugin
    const labelPlugin = {
      withLabel(this: any, label: string) {
        this._setHooks({
          beforeStep: (meta: any) => {
            meta.label = label;
          },
        });
        return this;
      },
    };
    FlowBuilder.use(labelPlugin);

    await (new FlowBuilder<any>() as any)
      .withLabel("llm:chat")
      .withCallbacks({
        onLLMStart: () => events.push("llmStart"),
        onLLMEnd: () => events.push("llmEnd"),
        onChainStart: () => events.push("chainStart"),
      })
      .startWith(async () => {})
      .run(s);

    expect(events).toContain("llmStart");
    expect(events).toContain("llmEnd");
  });

  test("onError fires when a step throws", async () => {
    const errors: unknown[] = [];

    await (new FlowBuilder<any>() as any)
      .withCallbacks({ onError: (_: any, err: unknown) => errors.push(err) })
      .startWith(() => {
        throw new Error("oops");
      })
      .run({})
      .catch(() => {});

    expect(errors.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// withTelemetry
// ─────────────────────────────────────────────────────────────────────────────

describe("withTelemetry", () => {
  test("records spans for each step via custom exporter", async () => {
    const spans: any[] = [];
    const exporter = {
      export: (s: any[]) => {
        spans.push(...s);
      },
    };
    const daemon = new TelemetryDaemon({ exporter, flushIntervalMs: 60_000 });

    await (new FlowBuilder<any>() as any)
      .withTelemetry({ daemon })
      .startWith(async () => {})
      .then(async () => {})
      .run({});

    // afterFlow triggers flush; spans should be recorded
    expect(spans.length).toBeGreaterThanOrEqual(2);
    expect(spans[0]).toHaveProperty("name");
    expect(spans[0]).toHaveProperty("durationMs");
    expect(spans[0]).toHaveProperty("status");
  });

  test("span status is 'error' when step throws", async () => {
    const spans: any[] = [];
    const exporter = {
      export: (s: any[]) => {
        spans.push(...s);
      },
    };
    const daemon = new TelemetryDaemon({ exporter, flushIntervalMs: 60_000 });

    await (new FlowBuilder<any>() as any)
      .withTelemetry({ daemon })
      .startWith(() => {
        throw new Error("fail");
      })
      .run({})
      .catch(() => {});

    expect(spans.some((s: any) => s.status === "error")).toBe(true);
  });

  test("accepts an existing daemon via options.daemon", async () => {
    const spans: any[] = [];
    const exporter = {
      export: (s: any[]) => {
        spans.push(...s);
      },
    };
    const sharedDaemon = new TelemetryDaemon({
      exporter,
      flushIntervalMs: 60_000,
    });

    // Two flows share same daemon
    const flow1 = (new FlowBuilder<any>() as any)
      .withTelemetry({ daemon: sharedDaemon })
      .startWith(async () => {});
    const flow2 = (new FlowBuilder<any>() as any)
      .withTelemetry({ daemon: sharedDaemon })
      .startWith(async () => {});

    await flow1.run({});
    await flow2.run({});

    expect(spans.length).toBeGreaterThanOrEqual(2);
  });
});
