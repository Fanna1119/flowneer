# Pipeline Presets

General-purpose LLM workflow patterns. Import from `flowneer/presets/pipeline`.

| Preset                                            | Description                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| [`generateUntilValid`](./generate-until-valid.md) | Generate → validate → retry with error context                       |
| [`mapReduceLlm`](./map-reduce-llm.md)             | Fan out LLM calls across N items, then aggregate                     |
| [`approvalGate`](./approval-gate.md)              | Human approval / review gate with approve, reject, and edit outcomes |
| [`clarifyLoop`](./clarify-loop.md)                | Generate → evaluate → ask for clarification → retry (up to N rounds) |
