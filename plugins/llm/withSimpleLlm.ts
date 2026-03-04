import type { FlowBuilder, FlowneerPlugin } from "../../Flowneer";
import type { NodeFn, NodeOptions } from "../../Flowneer";

interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  // provider-specific
}

declare module "flowneer" {
  interface FlowBuilder<S, P> {
    prompt(
      template: string | ((s: S, p: P) => string | Promise<string>),
      opts?: LLMOptions & NodeOptions<S, P>,
    ): this;

    llm(
      fn: (prompt: string, opts: LLMOptions) => Promise<string>,
      opts?: LLMOptions & NodeOptions<S, P>,
    ): this;

    streamLLM(
      fn: (prompt: string, opts: LLMOptions) => AsyncIterable<string>,
      opts?: LLMOptions & NodeOptions<S, P>,
    ): this;

    toolCall(
      tools: Record<string, (args: any, s: S, p: P) => Promise<any>>,
      opts?: { force?: boolean } & LLMOptions & NodeOptions<S, P>,
    ): this;
  }
}

export const SimpleLlm: FlowneerPlugin = {
  prompt(this: FlowBuilder<any, any>, template, opts) {
    return this.then(
      async (s, p) => {
        const rendered =
          typeof template === "function" ? await template(s, p) : template;

        (s as any).__lastPrompt = rendered;
        (s as any).__llmOpts = opts ?? {};
      },
      { label: "render-prompt", ...opts },
    );
  },

  llm(this: FlowBuilder<any, any>, generatorFn, opts) {
    return this.then(
      async (s, p) => {
        const prompt = (s as any).__lastPrompt;
        if (!prompt) throw new Error("No prompt rendered before .llm()");

        const result = await generatorFn(prompt, {
          ...(s as any).__llmOpts,
          ...opts,
        });
        (s as any).__lastCompletion = result;
      },
      { label: "llm-generate", ...opts },
    );
  },

  streamLLM(this: FlowBuilder<any, any>, streamerFn, opts) {
    return this.then(
      async function* (s, p) {
        const prompt = (s as any).__lastPrompt;
        if (!prompt) throw new Error("No prompt before .streamLLM()");

        for await (const token of streamerFn(prompt, {
          ...(s as any).__llmOpts,
          ...opts,
        })) {
          (s as any).__stream?.(token); // integrates with existing .stream()
          yield token; // also allows generator-style consumption
        }
      },
      { label: "llm-stream", ...opts },
    );
  },

  // toolCall would follow similar pattern: render prompt with tool schemas,
  // call model with tool calling enabled, parse, execute chosen tool, loop if needed
};

// Usage example

// const flow = new FlowBuilder<State>()
//   .prompt("You are a helpful assistant. Answer: {question}")
//   .llm(openai.chat.completions.create.bind(openai.chat.completions), {
//     model: "gpt-4o-mini",
//     temperature: 0.7
//   })
//   .then(s => console.log(s.__lastCompletion));

// // or streaming
// const streamingFlow = new FlowBuilder<State>()
//   .prompt("Translate to French: {text}")
//   .streamLLM(openai.chat.completions.create.bind(openai.chat.completions), {
//     model: "gpt-4o-mini",
//     stream: true
//   })
//   .run(state);
