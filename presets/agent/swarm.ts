// ---------------------------------------------------------------------------
// swarm — decentralized peer-to-peer multi-agent handoff preset
// ---------------------------------------------------------------------------

import { FlowBuilder } from "../../Flowneer";
import type { NodeFn } from "../../Flowneer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single message in the swarm conversation history.
 * Agents write to `shared.messages` using this shape.
 */
export interface SwarmMessage {
  role: "user" | "assistant";
  content: string;
  /** Name of the agent that produced this message */
  agent?: string;
}

/**
 * Fields that `swarm()` reads and writes on shared state.
 * Extend this with your own application fields via intersection:
 *
 * ```typescript
 * type MyState = SwarmState & { topic: string; result?: string };
 * ```
 */
export interface SwarmState {
  /** Name of the agent currently handling the request.
   *  Defaults to `options.defaultAgent` on the first `.run()` call. */
  currentAgent?: string;
  /** Conversation history — manage this inside your agent fns. */
  messages?: SwarmMessage[];
  /** Number of handoffs that have occurred in the current `.run()` call. */
  turnCount?: number;
  /** @internal — loop exit sentinel; removed after each `.run()` */
  __swarmDone?: boolean;
  /** @internal — set by `handoffTo()`; consumed by the handoff checker */
  __swarmHandoff?: { target: string; reason?: string };
}

/**
 * A single agent in the swarm.
 * Each agent is a `NodeFn` paired with a name and description.
 */
export interface SwarmAgent<
  S = any,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Unique name used in `handoffTo()` calls and `SwarmState.currentAgent`. */
  name: string;
  /** Human-readable description (can be provided to an LLM for routing). */
  description: string;
  /** The agent's step function — same signature as any Flowneer `NodeFn`. */
  fn: NodeFn<S, P>;
}

/**
 * Options for `swarm()`.
 */
export interface SwarmOptions<S = any> {
  /**
   * Name of the agent that handles the first turn.
   * Must appear in the `agents` array.
   */
  defaultAgent: string;
  /**
   * Maximum number of handoffs per `.run()` call before the flow stops.
   * Counts hops (not total agents); the original agent's first run is free.
   * Defaults to `5`.
   */
  maxHandoffs?: number;
  /**
   * Called each time a handoff is accepted.
   * `from` is the agent that handed off, `to` is the new agent.
   */
  onHandoff?: (
    from: string,
    to: string,
    reason: string | undefined,
    shared: S,
  ) => void | Promise<void>;
  /**
   * Called when `maxHandoffs` is exceeded instead of completing the handoff.
   * The turn ends after this callback returns.
   */
  onMaxHandoffs?: (shared: S) => void | Promise<void>;
  /**
   * Optional LLM router that selects the starting agent on each `.run()` call.
   * Runs once after state initialisation, before the handoff loop begins.
   */
  router?: SwarmRouter<S>;
}

// ---------------------------------------------------------------------------
// RouterContext / SwarmRouter
// ---------------------------------------------------------------------------

/**
 * Context object passed to a {@link SwarmRouter} prompt function.
 */
export interface RouterContext<S = any> {
  /** Full conversation history at the time of routing. */
  messages: SwarmMessage[];
  /** All agents registered in the swarm. */
  agents: SwarmAgent<S, any>[];
  /** Name of the agent that will be used if the router returns an unknown name. */
  currentAgent: string;
  /** Live shared state — mutations here are visible to the dispatched agent. */
  shared: S;
}

/**
 * An optional LLM-based router that selects the starting agent for each `.run()` call.
 *
 * @example
 * const flow = swarm(agents, {
 *   defaultAgent: "triage",
 *   router: {
 *     call: (prompt) => openai.chat.completions.create({ ... }).then(r => r.choices[0].message.content!),
 *   },
 * });
 */
export interface SwarmRouter<S = any> {
  /**
   * Calls the LLM with the resolved prompt and returns the agent name to start with.
   * The response is trimmed and matched case-insensitively against the agents array.
   * An unrecognised response is silently ignored and `currentAgent` remains unchanged.
   */
  call: (prompt: string) => Promise<string>;
  /**
   * Static prompt string or async function that returns the prompt.
   * When omitted, a default prompt listing all agents and the latest user message is used.
   */
  prompt?: string | ((context: RouterContext<S>) => string | Promise<string>);
}

// ---------------------------------------------------------------------------
// historyText
// ---------------------------------------------------------------------------

/**
 * Formats a `SwarmMessage[]` into a plain-text string suitable for use in LLM
 * prompts. Each line is `[agentName] role: content`; the `[agentName]` prefix
 * is omitted when `message.agent` is undefined.
 *
 * @example
 * const prompt = `Conversation so far:\n${historyText(shared.messages ?? [])}`;
 */
export function historyText(messages: SwarmMessage[]): string {
  return messages
    .map((m) => `${m.agent ? `[${m.agent}] ` : ""}${m.role}: ${m.content}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// buildDefaultRouterPrompt (internal)
// ---------------------------------------------------------------------------

function buildDefaultRouterPrompt<S>(ctx: RouterContext<S>): string {
  const agentList = ctx.agents
    .map((a) => `- ${a.name}: ${a.description}`)
    .join("\n");
  const history = historyText(ctx.messages);
  const latest = [...ctx.messages].reverse().find((m) => m.role === "user");
  return [
    "You are a routing assistant. Choose the best agent to handle the user's request.",
    "",
    "Available agents:",
    agentList,
    "",
    ...(history ? ["Conversation history:", history, ""] : []),
    ...(latest ? [`Latest user message: ${latest.content}`, ""] : []),
    "Respond with only the exact agent name, nothing else.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// handoffTo
// ---------------------------------------------------------------------------

/**
 * Signal that control should pass to another agent in the swarm.
 *
 * Call this inside an agent's `fn` to hand off to `agentName`.
 * If the target name is not found in the swarm the handoff is silently dropped
 * and the current turn ends.
 *
 * @example
 * const billingAgent: SwarmAgent<MyState> = {
 *   name: "billing",
 *   description: "Handles billing and payment queries",
 *   fn: async (shared) => {
 *     if (!isBillingQuery(shared.messages)) {
 *       handoffTo(shared, "support", "not a billing question");
 *       return;
 *     }
 *     shared.messages!.push({ role: "assistant", content: await billingLlm(shared) });
 *   },
 * };
 */
export function handoffTo(
  shared: SwarmState,
  agentName: string,
  reason?: string,
): void {
  shared.__swarmHandoff = { target: agentName, reason };
}

// ---------------------------------------------------------------------------
// swarm
// ---------------------------------------------------------------------------

/**
 * Creates a decentralized swarm of agents that hand off to each other
 * dynamically at runtime.
 *
 * Each agent can call `handoffTo(shared, targetName, reason?)` inside its `fn`
 * to yield control to another agent. The flow loops until either:
 *  - An agent finishes without calling `handoffTo`, or
 *  - `options.maxHandoffs` is exceeded (default 5) — `onMaxHandoffs` is called.
 *
 * `currentAgent` persists between `.run()` calls so the swarm remembers which
 * agent was active. It is set to `defaultAgent` only on the first call.
 *
 * @example
 * const flow = swarm(
 *   [triageAgent, billingAgent, supportAgent],
 *   { defaultAgent: "triage" },
 * );
 *
 * await flow.run({ messages: [{ role: "user", content: "I need a refund" }] });
 */
export function swarm<
  S extends SwarmState = SwarmState,
  P extends Record<string, unknown> = Record<string, unknown>,
>(
  agents: SwarmAgent<S, P>[],
  options: SwarmOptions<S>,
  FlowClass: new () => FlowBuilder<S, P> = FlowBuilder as any,
): FlowBuilder<S, P> {
  const agentMap = new Map<string, SwarmAgent<S, P>>(
    agents.map((a) => [a.name, a]),
  );

  if (!agentMap.has(options.defaultAgent)) {
    throw new Error(
      `swarm: defaultAgent "${options.defaultAgent}" not found in agents list. ` +
        `Available agents: ${agents.map((a) => a.name).join(", ")}`,
    );
  }

  const maxHandoffs = options.maxHandoffs ?? 5;

  return (
    new FlowClass()
      // ── Per-run init ───────────────────────────────────────────────────────
      .startWith(
        (shared: S) => {
          if (shared.currentAgent === undefined) {
            shared.currentAgent = options.defaultAgent;
          }
          shared.turnCount = 0;
          shared.__swarmDone = false;
          delete shared.__swarmHandoff;
        },
        { label: "swarm:init" },
      )
      // ── Router (optional — runs once per .run() call, before the loop) ─────
      .then(
        async (shared: S) => {
          if (!options.router) return;
          const ctx: RouterContext<S> = {
            messages: shared.messages ?? [],
            agents,
            currentAgent: shared.currentAgent!,
            shared,
          };
          const rawPrompt =
            typeof options.router.prompt === "function"
              ? await options.router.prompt(ctx)
              : (options.router.prompt ?? buildDefaultRouterPrompt(ctx));
          const response = await options.router.call(rawPrompt);
          const raw = response.trim();
          const match = agents.find(
            (a) => a.name.toLowerCase() === raw.toLowerCase(),
          );
          if (match) {
            shared.currentAgent = match.name;
          }
        },
        { label: "swarm:router" },
      )
      // ── Handoff loop ───────────────────────────────────────────────────────
      .loop(
        (shared: S) => !shared.__swarmDone,
        (b) => {
          b
            // Dispatch to the current agent
            .startWith(
              async (shared: S, params: P) => {
                const agent = agentMap.get(shared.currentAgent!);
                if (!agent) {
                  // Unknown agent — fall back to default and end turn
                  shared.currentAgent = options.defaultAgent;
                  shared.__swarmDone = true;
                  return;
                }
                delete shared.__swarmHandoff;
                await agent.fn(shared, params);
              },
              { label: "swarm:dispatch" },
            )
            // Check for handoff request
            .then(
              async (shared: S) => {
                const handoff = shared.__swarmHandoff;

                if (!handoff) {
                  // Agent completed without requesting a handoff — done
                  shared.__swarmDone = true;
                  return;
                }

                if (!agentMap.has(handoff.target)) {
                  // Invalid target — silently drop, end turn
                  shared.__swarmDone = true;
                  return;
                }

                if ((shared.turnCount ?? 0) >= maxHandoffs) {
                  // Too many hops — call callback and end turn
                  await options.onMaxHandoffs?.(shared);
                  shared.__swarmDone = true;
                  return;
                }

                // Accept the handoff
                await options.onHandoff?.(
                  shared.currentAgent!,
                  handoff.target,
                  handoff.reason,
                  shared,
                );
                shared.turnCount = (shared.turnCount ?? 0) + 1;
                shared.currentAgent = handoff.target;
              },
              { label: "swarm:handoff" },
            );
        },
        { label: "swarm:loop" },
      )
      // ── Cleanup ────────────────────────────────────────────────────────────
      .then(
        (shared: S) => {
          delete shared.__swarmDone;
        },
        { label: "swarm:cleanup" },
      )
  );
}
