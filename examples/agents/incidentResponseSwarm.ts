// ---------------------------------------------------------------------------
// incidentResponseSwarm — automated SRE incident triage using callLlm
// ---------------------------------------------------------------------------
//
// When an alert fires, a SwarmRouter classifies it and dispatches to the right
// specialist. Each agent investigates, applies automated remediation where
// possible, and hands off to other agents when the issue exceeds its scope.
//
//   router      → performance  (CPU/memory/latency — resolves or escalates)
//   router      → security     (auth anomalies/intrusions — contains or escalates)
//   router      → availability (outages/health-check failures — restores or escalates)
//   any         → oncall       (unresolvable or critical — opens ticket, pages team)
//   oncall      → postmortem   (medium+ severity — drafts blameless postmortem)
//
// The router has direct access to `shared.alert` via RouterContext, so it
// makes a typed routing decision without parsing free text.
//
// Run with:  bun run examples/agents/incidentResponseSwarm.ts
// Requires:  OPENAI_API_KEY environment variable
// ---------------------------------------------------------------------------

import { swarm, handoffTo, historyText } from "../../presets/agent";
import type { SwarmAgent, SwarmMessage, SwarmState } from "../../presets/agent";
import { callLlm } from "../../utils/callLlm";

// ── Alert schema ──────────────────────────────────────────────────────────────

interface Alert {
  id: string;
  type: "performance" | "security" | "availability";
  service: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
}

// ── Shared state ──────────────────────────────────────────────────────────────

interface IncidentState extends SwarmState {
  alert: Alert;
  /** Investigation log — each agent appends its findings here. */
  messages: SwarmMessage[];
  /** Set once the incident is resolved or handed to humans. */
  resolution?: string;
  /** Set by the oncall agent when a formal incident ticket is opened. */
  incidentId?: string;
}

// ── Context builder ───────────────────────────────────────────────────────────

function buildContext(shared: IncidentState): string {
  const { alert } = shared;
  const header = [
    `Alert:   [${alert.severity.toUpperCase()}] ${alert.id}`,
    `Service: ${alert.service}`,
    `Type:    ${alert.type}`,
    `Detail:  ${alert.description}`,
  ].join("\n");
  const log = historyText(shared.messages);
  return log ? `${header}\n\nInvestigation log:\n${log}` : header;
}

// ── Agents ────────────────────────────────────────────────────────────────────

const performanceAgent: SwarmAgent<IncidentState> = {
  name: "performance",
  description: "Investigates CPU, memory, latency, and throughput anomalies",
  fn: async (shared) => {
    const analysis = await callLlm(
      `${buildContext(shared)}\n\n` +
        `You are an SRE performance specialist.\n` +
        `Analyse the alert and provide:\n` +
        `1. Most likely root cause\n` +
        `2. Immediate remediation steps (scale up, restart, cache flush, etc.)\n` +
        `3. Whether automated action is sufficient\n\n` +
        `End your response with exactly "RESOLVED" or "ESCALATE" on the last line.`,
    );

    shared.messages = [
      ...shared.messages,
      { role: "assistant", content: analysis, agent: "performance" },
    ];

    if (analysis.includes("ESCALATE") || shared.alert.severity === "critical") {
      handoffTo(shared, "oncall", "performance issue requires human intervention");
    } else {
      shared.resolution = "Resolved autonomously by performance agent";
    }
  },
};

const securityAgent: SwarmAgent<IncidentState> = {
  name: "security",
  description:
    "Investigates auth anomalies, credential attacks, and data exfiltration",
  fn: async (shared) => {
    const analysis = await callLlm(
      `${buildContext(shared)}\n\n` +
        `You are an SRE security specialist.\n` +
        `Analyse the alert and provide:\n` +
        `1. False-positive assessment — is this a genuine threat?\n` +
        `2. Immediate containment steps (block IP range, revoke tokens, enable WAF rule, etc.)\n` +
        `3. Estimated data impact scope\n\n` +
        `End your response with exactly "FALSE_POSITIVE", "CONTAINED", or "ESCALATE" on the last line.`,
    );

    shared.messages = [
      ...shared.messages,
      { role: "assistant", content: analysis, agent: "security" },
    ];

    if (analysis.includes("FALSE_POSITIVE")) {
      shared.resolution = "Confirmed false positive by security agent";
    } else {
      // All confirmed security incidents require human involvement
      handoffTo(
        shared,
        "oncall",
        "confirmed security incident — human response required",
      );
    }
  },
};

const availabilityAgent: SwarmAgent<IncidentState> = {
  name: "availability",
  description:
    "Investigates service outages, degraded health checks, and cascading failures",
  fn: async (shared) => {
    const analysis = await callLlm(
      `${buildContext(shared)}\n\n` +
        `You are an SRE availability specialist.\n` +
        `Analyse the alert and provide:\n` +
        `1. Scope of degradation (partial vs full outage)\n` +
        `2. Immediate recovery steps (restart pods, failover, drain traffic, etc.)\n` +
        `3. Whether service can be restored without human involvement\n\n` +
        `End your response with exactly "RESTORED" or "ESCALATE" on the last line.`,
    );

    shared.messages = [
      ...shared.messages,
      { role: "assistant", content: analysis, agent: "availability" },
    ];

    if (analysis.includes("ESCALATE") || shared.alert.severity === "critical") {
      handoffTo(
        shared,
        "oncall",
        "availability issue requires human intervention",
      );
    } else {
      shared.resolution = "Service restored autonomously by availability agent";
    }
  },
};

const oncallAgent: SwarmAgent<IncidentState> = {
  name: "oncall",
  description:
    "Opens a formal incident ticket, drafts team communication, and pages the right on-call team",
  fn: async (shared) => {
    const incidentId = `INC-${Date.now().toString().slice(-5)}`;
    shared.incidentId = incidentId;

    const communication = await callLlm(
      `${buildContext(shared)}\n\n` +
        `You are the on-call incident commander for incident ${incidentId}.\n` +
        `Generate:\n\n` +
        `SLACK: A 1–2 sentence message for the #incidents channel\n` +
        `PAGE: Which team to page (infra / security / backend / data)\n` +
        `SUMMARY:\n` +
        `- Known facts (1 bullet)\n` +
        `- Immediate actions taken (1 bullet)\n` +
        `- Next steps (1 bullet)`,
    );

    shared.messages = [
      ...shared.messages,
      { role: "assistant", content: communication, agent: "oncall" },
    ];

    shared.resolution = `Incident ${incidentId} opened — on-call team paged`;

    // Draft a postmortem for anything medium severity or above
    const { severity } = shared.alert;
    if (severity === "medium" || severity === "high" || severity === "critical") {
      handoffTo(
        shared,
        "postmortem",
        `${incidentId} requires postmortem template`,
      );
    }
  },
};

const postmortemAgent: SwarmAgent<IncidentState> = {
  name: "postmortem",
  description:
    "Drafts a blameless postmortem template once an incident is escalated",
  fn: async (shared) => {
    const draft = await callLlm(
      `${buildContext(shared)}\n\n` +
        `You are writing a blameless postmortem draft.\n` +
        `Generate a structured template with these sections:\n\n` +
        `## Summary\n(2 sentences)\n\n` +
        `## Timeline\n(bullet list with [HH:MM] placeholders)\n\n` +
        `## Root Cause\n(1–2 sentences)\n\n` +
        `## Customer Impact\n(what broke, estimated duration, blast radius)\n\n` +
        `## Action Items\n(3–5 tasks with [OWNER] and [DATE] placeholders)`,
    );

    shared.messages = [
      ...shared.messages,
      { role: "assistant", content: draft, agent: "postmortem" },
    ];
  },
};

// ── Swarm setup ───────────────────────────────────────────────────────────────
//
// RouterContext<S> includes `shared`, so the router prompt can inspect
// `shared.alert` directly — no need to parse free text from messages.

const flow = swarm<IncidentState>(
  [
    performanceAgent,
    securityAgent,
    availabilityAgent,
    oncallAgent,
    postmortemAgent,
  ],
  {
    defaultAgent: "availability",
    maxHandoffs: 5,
    router: {
      call: callLlm,
      prompt: ({ agents, shared }) => {
        // Never route directly to oncall or postmortem — those are handoff targets only
        const routable = agents
          .filter((a) => !["oncall", "postmortem"].includes(a.name))
          .map((a) => `- ${a.name}: ${a.description}`)
          .join("\n");
        const { alert } = shared;
        return [
          "You are an SRE alert router.",
          `Alert: [${alert.severity.toUpperCase()}] ${alert.service} — ${alert.description}`,
          `Type hint: ${alert.type}`,
          "",
          "Choose the right specialist (do NOT route to oncall or postmortem):",
          routable,
          "",
          "Respond with only the agent name (performance, security, or availability).",
        ].join("\n");
      },
    },
    onHandoff: (from, to, reason) => {
      console.log(
        `  ↳ [handoff] ${from} → ${to}${reason ? ` (${reason})` : ""}`,
      );
    },
    onMaxHandoffs: (shared) => {
      shared.resolution = "Max handoffs reached — manual triage required";
      shared.messages = [
        ...shared.messages,
        {
          role: "assistant",
          content:
            "Automated triage could not resolve this incident. Requires manual review.",
          agent: "system",
        },
      ];
    },
  },
);

// ── Demo: fire three representative alerts ────────────────────────────────────

const DIVIDER = "─".repeat(72);

async function handleAlert(alert: Alert): Promise<void> {
  const state: IncidentState = {
    alert,
    messages: [
      {
        role: "user",
        content: `[${alert.severity.toUpperCase()}] ${alert.service}: ${alert.description}`,
      },
    ],
  };

  console.log(`\n${DIVIDER}`);
  console.log(`${alert.id}  ·  ${alert.service}  ·  ${alert.severity.toUpperCase()}`);
  console.log(`${alert.description}`);
  console.log(DIVIDER);

  await flow.run(state);

  // Print each agent's output from the log
  for (const msg of state.messages) {
    if (msg.role === "assistant" && msg.agent) {
      console.log(`\n[${msg.agent}]`);
      console.log(msg.content.trim());
    }
  }

  console.log(`\nResolution : ${state.resolution ?? "(none)"}`);
  if (state.incidentId) console.log(`Incident ID: ${state.incidentId}`);
}

// Performance issue — high severity, may self-resolve
await handleAlert({
  id: "ALT-001",
  type: "performance",
  service: "api-gateway",
  severity: "high",
  description:
    "P99 request latency spiked to 4.2 s (baseline 200 ms). CPU at 94% across all 3 instances for 12 minutes.",
});

// Security incident — critical, always escalates to oncall → postmortem
await handleAlert({
  id: "ALT-002",
  type: "security",
  service: "auth-service",
  severity: "critical",
  description:
    "1,847 failed login attempts from 23 distinct IPs in 5 minutes. Pattern matches known credential-stuffing toolkit.",
});

// Availability degradation — critical, always escalates to oncall → postmortem
await handleAlert({
  id: "ALT-003",
  type: "availability",
  service: "checkout-service",
  severity: "critical",
  description:
    "Health checks failing on 3 of 4 pods. Customers seeing 503s for 11 minutes. Estimated revenue impact: ~$2,400/min.",
});
