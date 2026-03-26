import type {
  FlowneerPlugin,
  PluginContext,
  StepFilter,
  StepMeta,
} from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /** Prints the full `shared` object to stdout after each step. */
    withVerbose(filter?: StepFilter): this;
  }
}

export const withVerbose: FlowneerPlugin = {
  withVerbose(this: PluginContext, filter?: StepFilter) {
    this._setHooks(
      {
        afterStep: (meta: StepMeta, shared: any) => {
          console.log(
            `[flowneer] step ${meta.index} (${meta.type}):`,
            JSON.stringify(shared, null, 2),
          );
        },
      },
      filter,
    );
    return this;
  },
};
