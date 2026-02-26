# Multi-agent Patterns

Factory functions that return pre-configured `FlowBuilder` instances implementing common multi-agent orchestration topologies.

## Import

```typescript
import {
  supervisorCrew,
  sequentialCrew,
  hierarchicalCrew,
  roundRobinDebate,
} from "flowneer/plugins/agent";
```

---

## `supervisorCrew`

A supervisor runs first to plan/set up context, workers execute in parallel, then the supervisor runs again to aggregate results.

```typescript
const flow = supervisorCrew<BlogState>(
  // 1. Supervisor: plan
  async (s) => {
    s.outline = await planContent(s.topic);
    s.sections = {};
  },
  // 2. Workers: write sections in parallel
  [
    async (s) => {
      s.sections.intro = await writeSection("Introduction", s.topic);
    },
    async (s) => {
      s.sections.body = await writeSection("Main Body", s.topic);
    },
    async (s) => {
      s.sections.outro = await writeSection("Conclusion", s.topic);
    },
  ],
  // 3. Post step: aggregate
  {
    post: async (s) => {
      s.draft = [s.sections.intro, s.sections.body, s.sections.outro].join(
        "\n\n",
      );
    },
    // Optional: use reducer for safe parallel writes
    reducer: (shared, drafts) => {
      shared.sections = Object.assign({}, ...drafts.map((d) => d.sections));
    },
  },
);

await flow.run({ topic: "TypeScript", outline: [], sections: {}, draft: "" });
```

### Signature

```typescript
function supervisorCrew<S, P>(
  supervisor: NodeFn<S, P>,
  workers: NodeFn<S, P>[],
  options?: {
    post?: NodeFn<S, P>;
    reducer?: (shared: S, drafts: S[]) => void;
  },
): FlowBuilder<S, P>;
```

---

## `sequentialCrew`

A strict pipeline: each step runs in order and passes its results to the next via shared state.

```typescript
const flow = sequentialCrew<ResearchState>([
  async (s) => {
    s.research = await research(s.query);
  },
  async (s) => {
    s.draft = await writeDraft(s.research);
  },
  async (s) => {
    s.final = await editDraft(s.draft);
  },
]);
```

### Signature

```typescript
function sequentialCrew<S, P>(steps: NodeFn<S, P>[]): FlowBuilder<S, P>;
```

---

## `hierarchicalCrew`

A top-level manager delegates to sub-team flows (each is its own `FlowBuilder`). Teams run sequentially after the manager, then an optional aggregation step runs.

```typescript
const researchTeam = supervisorCrew(researchSupervisor, researchWorkers);
const writingTeam = sequentialCrew([drafter, editor, seoOptimizer]);

const flow = hierarchicalCrew<State>(
  async (s) => {
    s.plan = planTasks(s.input);
  }, // manager
  [researchTeam, writingTeam], // sub-teams
  async (s) => {
    s.output = mergeResults(s);
  }, // aggregation
);
```

### Signature

```typescript
function hierarchicalCrew<S, P>(
  manager: NodeFn<S, P>,
  teams: FlowBuilder<S, P>[],
  aggregate?: NodeFn<S, P>,
): FlowBuilder<S, P>;
```

---

## `roundRobinDebate`

Each agent runs in sequence, repeated `rounds` times. Agents append their perspectives to shared state — producing a multi-turn collaborative output.

```typescript
const flow = roundRobinDebate<DebateState>(
  [
    async (s) => {
      s.debate.push({ agent: "optimist", text: await optimist(s) });
    },
    async (s) => {
      s.debate.push({ agent: "critic", text: await critic(s) });
    },
    async (s) => {
      s.debate.push({ agent: "synthesiser", text: await synth(s) });
    },
  ],
  3, // 3 full rounds → 9 total turns
);

await flow.run({ topic: "AI safety", debate: [] });
```

The current round is tracked in `shared.__debateRound`.

### Signature

```typescript
function roundRobinDebate<S, P>(
  agents: NodeFn<S, P>[],
  rounds: number,
): FlowBuilder<S, P>;
```

---

## Composition

All pattern functions return a `FlowBuilder`, so they can be extended with additional plugins:

```typescript
const flow = supervisorCrew(supervisor, workers, { post })
  .withTiming()
  .withCostTracker();
```

And nested inside larger flows:

```typescript
const mainFlow = new FlowBuilder<State>()
  .startWith(initialize)
  .then(async (s, p) => {
    await researchFlow.run(s, p); // inline sub-flow
  })
  .then(finalize);
```
