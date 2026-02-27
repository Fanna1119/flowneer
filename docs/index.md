---
layout: home

hero:
  # name: "Flowneer"
  image: /flowneer_logo.png
  text: "Fluent flow builder for TypeScript"
  tagline: Zero-dependency. Composable. Plugin-driven. Built for LLM pipelines and beyond.
  actions:
    - theme: brand
      text: Get Started
      link: /core/getting-started
    - theme: alt
      text: Plugin Reference
      link: /plugins/overview
    - theme: alt
      text: GitHub
      link: https://github.com/Fanna1119/flowneer

features:
  - title: Fluent & Composable
    details: Chain steps with .startWith(), .then(), .branch(), .loop(), .batch(), and .parallel() — all through one FlowBuilder class.
  - title: Plugin System
    details: Extend any flow with hooks registered via FlowBuilder.use(). 30+ built-in plugins covering LLM, memory, resilience, observability, and more.
  - title: LLM-Native
    details: First-class support for structured output validation, tool calling, ReAct agent loops, human-in-the-loop interrupts, and streaming token output.
  - title: Zero Dependencies
    details: The core is pure TypeScript with no runtime dependencies. Plugins are tree-shaken so you only ship what you use.
  - title: Shared-State Model
    details: Every step receives a single mutable shared object. No message-passing boilerplate — just read and write the state you need.
  - title: Graph Composition
    details: Declare flows as DAGs with addNode/addEdge and let Flowneer compile them into efficient sequential or conditional pipelines.
---
