// The change in the edge field the coils make, per LCFS cell: ΔB/B_VMEC = (B − B_VMEC)/B_VMEC (the same quantity the
// "Magnetic field change" card plots along the strike line). Drawn on the 3D surface by the field-change layer.
import type { Simulation } from '../heatfield/sim';

/** ΔB/B_VMEC on every LCFS cell (flat c = j·nTheta + i) at the simulation's current time and coils. */
export function fieldChangeCells(sim: Simulation, out: Float32Array<ArrayBufferLike> = new Float32Array(sim.model.nCells)): Float32Array<ArrayBufferLike> {
  const field = sim.field();
  const base = sim.model.Bs;
  for (let c = 0; c < out.length; c++) out[c] = (field[c]! - base[c]!) / base[c]!;
  return out;
}

/** Tidy colour-bar bounds for |ΔB/B_VMEC|: 0.1 %, 0.2 %, 0.5 %, 1 %, 2 %, 5 %, 10 %. */
export const FIELD_STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1];

/**
 * The symmetric colour range of the field-change map, fitted to the coils that are ON, not to the instantaneous drive:
 * ΔB/B = ε·Σ_k a_k·h_k with |a_k| ≤ c_k, so the largest change the applied coils can make is ε·max_c Σ_k c_k·h_k[c]. The
 * bound is the smallest tidy step at or above that (0.1 % with the coils off). It holds steady while the coils hold, so
 * the patches visibly pulse as the drive swings.
 */
export function fieldChangeRange(sim: Simulation): [number, number] {
  const m = sim.model;
  const coils = sim.coils;
  let most = 0;
  for (let c = 0; c < m.nCells; c++) {
    let s = 0;
    for (let k = 0; k < m.nDiverters; k++) s += Math.abs(coils[k] ?? 0) * m.h[k]![c]!;
    most = Math.max(most, s);
  }
  most *= m.params.epsilon;
  const bound = FIELD_STEPS.find((step) => step >= most * (1 - 1e-9)) ?? FIELD_STEPS[FIELD_STEPS.length - 1]!;
  return [-bound, bound];
}
