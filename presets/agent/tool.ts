// ---------------------------------------------------------------------------
// tool — LangChain-style tool() factory
// ---------------------------------------------------------------------------
//
//   const getWeather = tool(
//     ({ city }) => `Sunny in ${city}!`,
//     {
//       name: "get_weather",
//       description: "Get the weather for a given city",
//       schema: z.object({ city: z.string() }),   // Zod or plain params
//     },
//   );
//
// ---------------------------------------------------------------------------

import type { Tool, ToolParam } from "../../plugins/tools";

// ─────────────────────────────────────────────────────────────────────────────
// Zod duck-type helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal structural interface that matches a Zod ZodObject.
 * We duck-type against `.shape` so this plugin has zero Zod dependency —
 * pass a real `z.object(...)` and it just works.
 */
export interface ZodLikeObject {
  shape: Record<
    string,
    {
      _def: { typeName: string; description?: string };
      isOptional?(): boolean;
    }
  >;
}

function zodTypeToParamType(typeName: string): ToolParam["type"] {
  switch (typeName) {
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodObject":
      return "object";
    case "ZodArray":
      return "array";
    default:
      return "string";
  }
}

function zodSchemaToParams(schema: ZodLikeObject): Record<string, ToolParam> {
  const params: Record<string, ToolParam> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    params[key] = {
      type: zodTypeToParamType(field._def.typeName),
      description: field._def.description ?? key,
      required: field.isOptional ? !field.isOptional() : true,
    };
  }
  return params;
}

// ─────────────────────────────────────────────────────────────────────────────
// tool() — LangChain-style tool factory
// ─────────────────────────────────────────────────────────────────────────────

/** Config when using a Zod-compatible schema. */
export interface ToolConfigSchema<TArgs> {
  name: string;
  description: string;
  schema: ZodLikeObject;
  execute?: (args: TArgs) => unknown | Promise<unknown>;
}

/** Config when using plain Flowneer ToolParam definitions. */
export interface ToolConfigParams<TArgs> {
  name: string;
  description: string;
  params: Record<string, ToolParam>;
  execute?: (args: TArgs) => unknown | Promise<unknown>;
}

export type ToolConfig<TArgs> =
  | ToolConfigSchema<TArgs>
  | ToolConfigParams<TArgs>;

function isSchemaConfig<TArgs>(
  cfg: ToolConfig<TArgs>,
): cfg is ToolConfigSchema<TArgs> {
  return "schema" in cfg && cfg.schema != null;
}

/**
 * Create a Flowneer `Tool` from an execute function + config.
 *
 * Mirrors LangChain's `tool()` factory. Accepts either:
 * - `schema: z.object(...)` — a Zod-compatible schema (duck-typed, no import needed)
 * - `params: Record<string, ToolParam>` — plain Flowneer param definitions
 *
 * @example
 * // With Zod schema:
 * const getWeather = tool(
 *   ({ city }) => `Always sunny in ${city}!`,
 *   {
 *     name: "get_weather",
 *     description: "Get the weather for a given city",
 *     schema: z.object({ city: z.string().describe("The city name") }),
 *   },
 * );
 *
 * // With plain params:
 * const getTime = tool(
 *   () => new Date().toISOString(),
 *   {
 *     name: "get_time",
 *     description: "Get the current UTC time",
 *     params: {},
 *   },
 * );
 */
export function tool<TArgs = Record<string, unknown>>(
  execute: (args: TArgs) => unknown | Promise<unknown>,
  config: ToolConfig<TArgs>,
): Tool<TArgs> {
  const params = isSchemaConfig(config)
    ? zodSchemaToParams(config.schema)
    : config.params;

  return {
    name: config.name,
    description: config.description,
    params,
    execute,
  };
}
