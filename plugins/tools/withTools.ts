// ---------------------------------------------------------------------------
// withTools — reusable tool-calling infrastructure extracted from clawneer
// ---------------------------------------------------------------------------

import type { FlowBuilder, FlowneerPlugin } from "../../Flowneer";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** Describes a single parameter for a tool. */
export interface ToolParam {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
}

/** A tool definition. `TArgs` is the input shape, `TResult` the return shape. */
export interface Tool<TArgs = any, TResult = any> {
  name: string;
  description: string;
  params: Record<string, ToolParam>;
  execute: (args: TArgs) => TResult | Promise<TResult>;
}

/** A pending tool invocation (e.g. from an LLM response). */
export interface ToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

/** Result of executing a single tool call. */
export interface ToolResult {
  callId?: string;
  name: string;
  result?: unknown;
  error?: string;
}

/**
 * Registry holding a set of tools.
 *
 * Attached to `shared.__tools` by `.withTools()`.
 * Steps can import the helper functions below to interact with it.
 */
export class ToolRegistry {
  private _tools = new Map<string, Tool>();

  constructor(tools: Tool[]) {
    for (const t of tools) this._tools.set(t.name, t);
  }

  /** Get a registered tool by name. */
  get(name: string): Tool | undefined {
    return this._tools.get(name);
  }

  /** Check if a tool is registered. */
  has(name: string): boolean {
    return this._tools.has(name);
  }

  /** List all registered tool names. */
  names(): string[] {
    return [...this._tools.keys()];
  }

  /** Return tool definitions as plain objects (suitable for LLM schemas). */
  definitions(): Array<{
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  }> {
    return [...this._tools.values()].map((t) => {
      const required = Object.entries(t.params)
        .filter(([, p]) => p.required !== false)
        .map(([k]) => k);
      return {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object" as const,
          properties: Object.fromEntries(
            Object.entries(t.params).map(([k, p]) => [
              k,
              { type: p.type, description: p.description },
            ]),
          ),
          required,
        },
      };
    });
  }

  /**
   * Execute a single tool call. Returns a `ToolResult`.
   * Catches tool errors and returns them as `{ error }` rather than throwing.
   */
  async execute(call: ToolCall): Promise<ToolResult> {
    const tool = this._tools.get(call.name);
    if (!tool) {
      return {
        callId: call.id,
        name: call.name,
        error: `unknown tool: ${call.name}`,
      };
    }
    try {
      const result = await tool.execute(call.args);
      return { callId: call.id, name: call.name, result };
    } catch (err) {
      return {
        callId: call.id,
        name: call.name,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Execute multiple tool calls concurrently.
   * Returns results in the same order as the input calls.
   */
  async executeAll(calls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(calls.map((c) => this.execute(c)));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers for use inside step functions
// ─────────────────────────────────────────────────────────────────────────────

/** Get the `ToolRegistry` from shared state. */
export function getTools(shared: {
  __tools?: ToolRegistry;
}): ToolRegistry | undefined {
  return shared.__tools;
}

/** Execute a single tool call via the shared registry. */
export async function executeTool(
  shared: { __tools?: ToolRegistry },
  call: ToolCall,
): Promise<ToolResult> {
  const reg = shared.__tools;
  if (!reg) {
    return {
      callId: call.id,
      name: call.name,
      error: "no tool registry — did you call .withTools()?",
    };
  }
  return reg.execute(call);
}

/** Execute multiple tool calls via the shared registry. */
export async function executeTools(
  shared: { __tools?: ToolRegistry },
  calls: ToolCall[],
): Promise<ToolResult[]> {
  const reg = shared.__tools;
  if (!reg) {
    return calls.map((c) => ({
      callId: c.id,
      name: c.name,
      error: "no tool registry — did you call .withTools()?",
    }));
  }
  return reg.executeAll(calls);
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin
// ─────────────────────────────────────────────────────────────────────────────

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Registers tools on this flow. The `ToolRegistry` is attached to
     * `shared.__tools` before the first step so it's available everywhere.
     *
     * @example
     * const flow = new FlowBuilder<MyState>()
     *   .withTools([calculatorTool, searchTool])
     *   .startWith(async (s) => {
     *     const reg = s.__tools!;
     *     const result = await reg.execute({ name: "calculator", args: { expression: "2+2" } });
     *   });
     */
    withTools(tools: Tool[]): this;
  }
}

export const withTools: FlowneerPlugin = {
  withTools(this: FlowBuilder<any, any>, tools: Tool[]) {
    const registry = new ToolRegistry(tools);
    (this as any)._setHooks({
      beforeFlow: (shared: any) => {
        shared.__tools = registry;
      },
    });
    return this;
  },
};
