import type { FlowBuilder, FlowneerPlugin, StepMeta } from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /** Prints the full `shared` object to stdout after each step. */
    withVerbose(): this;
  }
}

export const withVerbose: FlowneerPlugin = {
  withVerbose(this: FlowBuilder<any, any>) {
    (this as any)._setHooks({
      afterStep: (meta: StepMeta, shared: any) => {
        console.log(
          `[flowneer] step ${meta.index} (${meta.type}):`,
          JSON.stringify(shared, null, 2),
        );
      },
    });
    return this;
  },
};
