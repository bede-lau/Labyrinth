import type { HeatTransfer } from './loadBalance';

export interface AppliedControls {
  coils: readonly number[];
  transfers: readonly HeatTransfer[];
}

// Cross-fade both the sending and receiving fractions on one solver clock.
// Interrupted ramps start at the levels already applied at the decision step.
export function controlRamp(start: AppliedControls, end: AppliedControls, first: number, duration: number) {
  const pairs = new Map<string, {from: number; to: number; a: number; b: number}>();
  for (const route of start.transfers) pairs.set(route.from+':'+route.to, {...route, a:route.fraction, b:0});
  for (const route of end.transfers) {
    const key = route.from+':'+route.to;
    const pair = pairs.get(key) ?? {...route, a:0, b:0};
    pair.b = route.fraction;
    pairs.set(key,pair);
  }
  return (step: number): AppliedControls => {
    if (step <= first) return start;
    if (step >= first+duration) return end;
    const t = (step-first)/duration;
    const w = t*t*(3-2*t);
    return {
      coils: start.coils.map((level,k) => level + w*(end.coils[k]!-level)),
      transfers: Array.from(pairs.values(), p => ({from:p.from,to:p.to,fraction:p.a+w*(p.b-p.a)})),
    };
  };
}
