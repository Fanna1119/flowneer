import type { FlowneerPlugin } from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /** Throw if total step executions exceed `max` (default 1000). */
    withStepLimit(max?: number): this;
  }
}

export const withStepLimit: FlowneerPlugin = {
  withStepLimit(this: any, max: number = 1000) {
    let count = 0;
    this._setHooks({
      beforeFlow: () => {
        count = 0;
      },
      beforeStep: () => {
        if (++count > max)
          throw new Error(`step limit exceeded: ${count} > ${max}`);
      },
    });
    return this;
  },
};
