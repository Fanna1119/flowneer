import type { FlowBuilder, FlowneerPlugin, StepMeta } from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /** Records wall-clock duration of each step in `shared.__timings[index]` (ms). */
    withTiming(): this;
  }
}

export const withTiming: FlowneerPlugin = {
  withTiming(this: FlowBuilder<any, any>) {
    const starts = new Map<number, number>();
    (this as any)._setHooks({
      beforeStep: (meta: StepMeta) => {
        starts.set(meta.index, Date.now());
      },
      afterStep: (meta: StepMeta, shared: any) => {
        const start = starts.get(meta.index) ?? Date.now();
        if (!shared.__timings) shared.__timings = {};
        shared.__timings[meta.index] = Date.now() - start;
        starts.delete(meta.index);
      },
    });
    return this;
  },
};
