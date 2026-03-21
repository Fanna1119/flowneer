import type {
  FlowBuilder,
  FlowneerPlugin,
  StepFilter,
  StepMeta,
} from "../../Flowneer";

declare module "../../Flowneer" {
  interface FlowBuilder<S, P> {
    /** Records wall-clock duration of each step in `shared.__timings[index]` (ms). */
    withTiming(filter?: StepFilter): this;
  }
  interface AugmentedState {
    /** Per-step wall-clock duration in ms, keyed by step index. Written by `.withTiming()`. */
    __timings?: Record<number, number>;
  }
}

export const withTiming: FlowneerPlugin = {
  withTiming(this: FlowBuilder<any, any>, filter?: StepFilter) {
    const starts = new Map<number, number>();
    (this as any)._setHooks(
      {
        beforeStep: (meta: StepMeta) => {
          starts.set(meta.index, Date.now());
        },
        afterStep: (meta: StepMeta, shared: any) => {
          const start = starts.get(meta.index) ?? Date.now();
          if (!shared.__timings) shared.__timings = {};
          shared.__timings[meta.index] = Date.now() - start;
          starts.delete(meta.index);
        },
      },
      filter,
    );
    return this;
  },
};
