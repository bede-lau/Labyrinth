/** The controls applied to the model: one coil amplitude in [0, 1] per diverter. */
export interface AppliedControls {
  coils: readonly number[];
}

/** A cross-fade in progress: how to rebuild its `controlRamp` (the fields are plain data, so a worker can be sent them). */
export interface RampSpec {
  start: AppliedControls;
  end: AppliedControls;
  first: number;
  steps: number;
}

// Cross-fade the coil amplitudes on one solver clock (smoothstep). An interrupted ramp starts at the levels already
// applied at the decision step.
export function controlRamp(start: AppliedControls, end: AppliedControls, first: number, duration: number) {
  return (step: number): AppliedControls => {
    if (step <= first) return start;
    if (step >= first+duration) return end;
    const t = (step-first)/duration;
    const w = t*t*(3-2*t);
    return { coils: start.coils.map((level,k) => level + w*(end.coils[k]!-level)) };
  };
}
