// ---------------------------------------------------------------------------
// withMemory — attach a Memory instance to shared state
// ---------------------------------------------------------------------------

import type { FlowBuilder, FlowneerPlugin } from "../../Flowneer";
import type { Memory } from "./types";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /**
     * Attaches a `Memory` instance to `shared.__memory` before the flow starts.
     *
     * Steps can then read/write conversational memory without needing to
     * manage the instance lifecycle themselves.
     *
     * @example
     * import { BufferWindowMemory } from "flowneer/plugins/memory";
     *
     * const memory = new BufferWindowMemory({ maxMessages: 10 });
     * const flow = new FlowBuilder<MyState>()
     *   .withMemory(memory)
     *   .startWith(async (s) => {
     *     s.__memory!.add({ role: "user", content: userInput });
     *     const ctx = await s.__memory!.toContext();
     *     // ...
     *   });
     */
    withMemory(memory: Memory): this;
  }
}

export const withMemory: FlowneerPlugin = {
  withMemory(this: FlowBuilder<any, any>, memory: Memory) {
    (this as any)._setHooks({
      beforeFlow: (shared: any) => {
        shared.__memory = memory;
      },
    });
    return this;
  },
};
