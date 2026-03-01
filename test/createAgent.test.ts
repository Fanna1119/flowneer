// ---------------------------------------------------------------------------
// Tests for plugins/agent/createAgent — tool() factory + createAgent()
// ---------------------------------------------------------------------------

import { describe, expect, test, mock } from "bun:test";
import { tool, createAgent } from "../plugins/agent/createAgent";
import type {
  AgentState,
  LlmAdapter,
  LlmResponse,
  ChatMessage,
} from "../plugins/agent/createAgent";
import type { ToolCall } from "../plugins/tools";

// ─────────────────────────────────────────────────────────────────────────────
// tool() — factory
// ─────────────────────────────────────────────────────────────────────────────

describe("tool()", () => {
  test("creates a tool with plain params", () => {
    const t = tool(() => "result", {
      name: "my_tool",
      description: "A test tool",
      params: {
        x: { type: "string", description: "X arg" },
      },
    });

    expect(t.name).toBe("my_tool");
    expect(t.description).toBe("A test tool");
    expect(t.params.x).toEqual({ type: "string", description: "X arg" });
  });

  test("creates a tool with no params", () => {
    const t = tool(() => 42, {
      name: "no_params",
      description: "No params",
      params: {},
    });
    expect(Object.keys(t.params)).toHaveLength(0);
  });

  test("execute function is preserved", async () => {
    const t = tool(({ city }: { city: string }) => `sunny in ${city}`, {
      name: "weather",
      description: "Weather",
      params: { city: { type: "string", description: "City" } },
    });
    const result = await t.execute({ city: "Paris" });
    expect(result).toBe("sunny in Paris");
  });

  test("async execute is supported", async () => {
    const t = tool(async ({ n }: { n: number }) => n * 2, {
      name: "double",
      description: "Doubles a number",
      params: { n: { type: "number", description: "Input" } },
    });
    expect(await t.execute({ n: 5 })).toBe(10);
  });

  // ── Zod-schema variant ────────────────────────────────────────────────────

  test("creates a tool from a Zod-like schema (string field)", () => {
    const schema = {
      shape: {
        city: {
          _def: { typeName: "ZodString", description: "The city" },
          isOptional: () => false,
        },
      },
    };
    const t = tool(({ city }: { city: string }) => city, {
      name: "zod_tool",
      description: "Uses Zod schema",
      schema,
    });

    expect(t.params.city?.type).toBe("string");
    expect(t.params.city?.description).toBe("The city");
    expect(t.params.city?.required).toBe(true);
  });

  test("maps Zod types correctly — number, boolean, object, array", () => {
    const schema = {
      shape: {
        n: {
          _def: { typeName: "ZodNumber", description: "num" },
          isOptional: () => false,
        },
        b: {
          _def: { typeName: "ZodBoolean", description: "bool" },
          isOptional: () => false,
        },
        o: {
          _def: { typeName: "ZodObject", description: "obj" },
          isOptional: () => false,
        },
        a: {
          _def: { typeName: "ZodArray", description: "arr" },
          isOptional: () => false,
        },
        u: {
          _def: { typeName: "ZodUnknown", description: "unk" },
          isOptional: () => false,
        },
      },
    };
    const t = tool(() => null, { name: "types", description: "", schema });

    expect(t.params.n?.type).toBe("number");
    expect(t.params.b?.type).toBe("boolean");
    expect(t.params.o?.type).toBe("object");
    expect(t.params.a?.type).toBe("array");
    expect(t.params.u?.type).toBe("string"); // fallthrough default
  });

  test("marks optional Zod fields as required:false", () => {
    const schema = {
      shape: {
        opt: {
          _def: { typeName: "ZodString", description: "opt" },
          isOptional: () => true,
        },
        req: {
          _def: { typeName: "ZodString", description: "req" },
          isOptional: () => false,
        },
      },
    };
    const t = tool(() => null, { name: "opt_test", description: "", schema });

    expect(t.params.opt?.required).toBe(false);
    expect(t.params.req?.required).toBe(true);
  });

  test("falls back to key name when description is missing", () => {
    const schema = {
      shape: {
        x: { _def: { typeName: "ZodString" }, isOptional: () => false },
      },
    };
    const t = tool(() => null, { name: "t", description: "", schema });
    expect(t.params.x?.description).toBe("x");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createAgent() — flow structure
// ─────────────────────────────────────────────────────────────────────────────

describe("createAgent()", () => {
  // Minimal adapter that returns a canned final answer immediately.
  function finishAdapter(text: string): LlmAdapter {
    return async () => ({ text });
  }

  test("returns a FlowBuilder (has .run())", () => {
    const agent = createAgent({
      tools: [],
      callLlm: finishAdapter("hello"),
    });
    expect(typeof agent.run).toBe("function");
  });

  test("sets output after a no-tool run", async () => {
    const agent = createAgent({
      tools: [],
      callLlm: finishAdapter("The answer is 42"),
    });
    const state: AgentState = { input: "What is the answer?", messages: [] };
    await agent.run(state);
    expect(state.output).toBe("The answer is 42");
  });

  test("seeds messages with system + user", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const adapter: LlmAdapter = async (msgs) => {
      capturedMessages.push([...msgs]);
      return { text: "done" };
    };

    const agent = createAgent({
      tools: [],
      callLlm: adapter,
      systemPrompt: "You are a bot.",
    });
    const state: AgentState = { input: "Hello", messages: [] };
    await agent.run(state);

    expect(capturedMessages[0]).toHaveLength(2);
    expect(capturedMessages[0]![0]).toMatchObject({
      role: "system",
      content: "You are a bot.",
    });
    expect(capturedMessages[0]![1]).toMatchObject({
      role: "user",
      content: "Hello",
    });
  });

  test("uses state.systemPrompt if not passed to createAgent", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const adapter: LlmAdapter = async (msgs) => {
      capturedMessages.push([...msgs]);
      return { text: "done" };
    };

    const agent = createAgent({ tools: [], callLlm: adapter });
    const state: AgentState = {
      input: "Hi",
      messages: [],
      systemPrompt: "From state",
    };
    await agent.run(state);
    expect(capturedMessages[0]![0]).toMatchObject({
      role: "system",
      content: "From state",
    });
  });

  test("omits system message when no systemPrompt provided", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const adapter: LlmAdapter = async (msgs) => {
      capturedMessages.push([...msgs]);
      return { text: "done" };
    };

    const agent = createAgent({ tools: [], callLlm: adapter });
    await agent.run({ input: "Hi", messages: [] });

    expect(capturedMessages[0]).toHaveLength(1);
    expect(capturedMessages[0]![0]!.role).toBe("user");
  });

  test("forwards tool definitions to LLM adapter", async () => {
    const capturedToolDefs: unknown[] = [];
    const adapter: LlmAdapter = async (_, defs) => {
      capturedToolDefs.push(...defs);
      return { text: "done" };
    };

    const myTool = tool(() => "ok", {
      name: "my_tool",
      description: "Does something",
      params: { x: { type: "string", description: "x" } },
    });

    const agent = createAgent({ tools: [myTool], callLlm: adapter });
    await agent.run({ input: "Go", messages: [] });

    expect(capturedToolDefs).toHaveLength(1);
    expect((capturedToolDefs[0] as any).name).toBe("my_tool");
    expect((capturedToolDefs[0] as any).parameters.properties).toHaveProperty(
      "x",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createAgent() — tool calling loop
// ─────────────────────────────────────────────────────────────────────────────

describe("createAgent() tool loop", () => {
  test("calls a tool and appends result to messages before next think", async () => {
    const calls: ToolCall[] = [];
    let turn = 0;

    const adapter: LlmAdapter = async (msgs) => {
      turn++;
      if (turn === 1) {
        // First turn: request tool call
        return {
          toolCalls: [{ id: "c1", name: "echo", args: { value: "hi" } }],
        };
      }
      // Second turn: finish — check that tool result is in messages
      const toolMsg = msgs.find((m) => m.role === "tool");
      expect(toolMsg).toBeDefined();
      expect(toolMsg!.content).toContain("hi");
      return { text: "all done" };
    };

    const echoTool = tool(({ value }: { value: string }) => value, {
      name: "echo",
      description: "Echoes a value",
      params: { value: { type: "string", description: "value" } },
    });

    const agent = createAgent({ tools: [echoTool], callLlm: adapter });
    const state: AgentState = { input: "echo hi", messages: [] };
    await agent.run(state);

    expect(state.output).toBe("all done");
    expect(turn).toBe(2);
  });

  test("executes multiple tool calls in one turn", async () => {
    let turn = 0;
    const adapter: LlmAdapter = async (msgs) => {
      turn++;
      if (turn === 1) {
        return {
          toolCalls: [
            { id: "a", name: "add", args: { a: 1, b: 2 } },
            { id: "b", name: "add", args: { a: 3, b: 4 } },
          ],
        };
      }
      const toolMsgs = msgs.filter((m) => m.role === "tool");
      expect(toolMsgs).toHaveLength(2);
      return { text: "sums computed" };
    };

    const addTool = tool(({ a, b }: { a: number; b: number }) => a + b, {
      name: "add",
      description: "Adds two numbers",
      params: {
        a: { type: "number", description: "a" },
        b: { type: "number", description: "b" },
      },
    });

    const agent = createAgent({ tools: [addTool], callLlm: adapter });
    const state: AgentState = { input: "add numbers", messages: [] };
    await agent.run(state);

    expect(state.output).toBe("sums computed");
  });

  test("tool errors surface in messages as 'Error: ...'", async () => {
    let turn = 0;
    let observedToolMsg: ChatMessage | undefined;

    const adapter: LlmAdapter = async (msgs) => {
      turn++;
      if (turn === 1) {
        return { toolCalls: [{ id: "x", name: "boom", args: {} }] };
      }
      observedToolMsg = msgs.find((m) => m.role === "tool");
      return { text: "handled" };
    };

    const boomTool = tool(
      () => {
        throw new Error("kaboom");
      },
      {
        name: "boom",
        description: "Always throws",
        params: {},
      },
    );

    const agent = createAgent({ tools: [boomTool], callLlm: adapter });
    await agent.run({ input: "go", messages: [] });

    expect(observedToolMsg?.content).toMatch(/Error: kaboom/);
  });

  test("unknown tool returns error result — does not throw", async () => {
    let turn = 0;
    const adapter: LlmAdapter = async (msgs) => {
      turn++;
      if (turn === 1) {
        return { toolCalls: [{ id: "y", name: "ghost_tool", args: {} }] };
      }
      const toolMsg = msgs.find((m) => m.role === "tool");
      expect(toolMsg?.content).toMatch(/unknown tool/);
      return { text: "recovered" };
    };

    const agent = createAgent({ tools: [], callLlm: adapter });
    const state: AgentState = { input: "call ghost", messages: [] };
    await agent.run(state);
    expect(state.output).toBe("recovered");
  });

  test("stops after maxIterations and sets __reactExhausted", async () => {
    const adapter: LlmAdapter = async () => ({
      // Always requests another tool call — never finishes
      toolCalls: [{ id: "t", name: "noop", args: {} }],
    });

    const noopTool = tool(() => "ok", {
      name: "noop",
      description: "Does nothing",
      params: {},
    });

    const agent = createAgent({
      tools: [noopTool],
      callLlm: adapter,
      maxIterations: 3,
    });
    const state: AgentState = { input: "loop forever", messages: [] };
    await agent.run(state);

    expect(state.__reactExhausted).toBe(true);
  });

  test("assistant tool-call turn is appended to messages", async () => {
    let turn = 0;
    let msgsOnSecondTurn: ChatMessage[] = [];

    const adapter: LlmAdapter = async (msgs) => {
      turn++;
      if (turn === 1) {
        return { toolCalls: [{ id: "id1", name: "ping", args: {} }] };
      }
      msgsOnSecondTurn = [...msgs];
      return { text: "pong" };
    };

    const pingTool = tool(() => "pong", {
      name: "ping",
      description: "Ping",
      params: {},
    });

    const agent = createAgent({ tools: [pingTool], callLlm: adapter });
    await agent.run({ input: "ping", messages: [] });

    // messages should include: system-less user, assistant (with tool_calls), tool result
    const assistantMsg = msgsOnSecondTurn.find(
      (m) => m.role === "assistant" && m.tool_calls,
    );
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.tool_calls![0]!.function.name).toBe("ping");
  });

  test("agent is reusable — second run starts fresh", async () => {
    const adapter = finishAdapter("fresh");
    const agent = createAgent({ tools: [], callLlm: adapter });

    const s1: AgentState = { input: "run 1", messages: [] };
    const s2: AgentState = { input: "run 2", messages: [] };
    await agent.run(s1);
    await agent.run(s2);

    expect(s1.output).toBe("fresh");
    expect(s2.output).toBe("fresh");
    // Each run seeds its own fresh message list
    expect(s1.messages).not.toBe(s2.messages);
  });

  // Helper reused in last test
  function finishAdapter(text: string): LlmAdapter {
    return async () => ({ text });
  }
});
