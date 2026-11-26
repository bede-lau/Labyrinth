// Power moved between divertors by the coils (D-039). Display-only arithmetic on the model's own power shares: no new
// physics, no new parameters. Heat never jumps from one plate to another; the coil changes where the scrape-off-layer
// power lands, so the power one divertor sheds is taken up by the others through the plasma edge.
import type { Coils, HeatModel } from './model';

export interface PowerTransfer {
  /** Each divertor's power share now (MW): the model's P_k at t_n with the applied coils. */
  shares: Float64Array;
  /** The same with every coil off (MW): the split the heating alone would give. */
  base: Float64Array;
  /** shares − base (MW); sums to zero (power is moved, not made). */
  delta: Float64Array;
  /** flows[k·n + j]: MW moved from divertor k to divertor j (≥ 0; only from a loser to a gainer). */
  flows: Float64Array;
  /** Total power moved (MW): the sum of the losses, equal to the sum of the gains. */
  moved: number;
}

/**
 * Who sends power to whom. The shares are P_k = P·u_k f_k Σu/Σ(u f) with f_k = 1 − η c_k (MODEL.md v6): a coil lowers
 * its own divertor's f_k, and the power it sheds is renormalised over every divertor in proportion to its weight. This
 * attributes each loser's shed power to the gainers in proportion to their gains, flows[k→j] = L_k·G_j / ΣG. That is
 * exact for one coil (the only loser); with several coils on it is a proportional attribution, one of many that move
 * the same total; every row sums to the
 * loser's loss and every column to the gainer's gain.
 */
export function powerTransfer(model: HeatModel, n: number, coils: Coils): PowerTransfer {
  const nDiv = model.nDiverters;
  const shares = Float64Array.from(model.edge(n, coils).shares);
  const base = Float64Array.from(model.edge(n, new Array<number>(nDiv).fill(0)).shares);
  const delta = Float64Array.from(shares, (s, k) => s - base[k]!);
  let gain = 0;
  for (const d of delta) if (d > 0) gain += d;
  const flows = new Float64Array(nDiv * nDiv);
  if (gain > 0)
    for (let k = 0; k < nDiv; k++) {
      if (!(delta[k]! < 0)) continue;
      for (let j = 0; j < nDiv; j++) if (delta[j]! > 0) flows[k * nDiv + j] = (-delta[k]! * delta[j]!) / gain;
    }
  return { shares, base, delta, flows, moved: gain };
}

/** The flows above `minMW`, largest first, as [from, to, MW]. */
export function largestFlows(t: PowerTransfer, minMW = 0): [number, number, number][] {
  const n = t.shares.length;
  const out: [number, number, number][] = [];
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) if (t.flows[k * n + j]! > minMW) out.push([k, j, t.flows[k * n + j]!]);
  return out.sort((a, b) => b[2] - a[2]);
}
