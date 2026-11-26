// @vitest-environment node
// The field-change layer shows ΔB/B₀ = (B − B_VMEC)/B_VMEC on every LCFS cell: zero with the coils off, largest at the
// coil's divertor when one is on, and the same numbers the "Magnetic field change" card plots along the strike line.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { HeatfieldArtifact } from '../heatfield/types';
import { sampleFieldChange } from './FieldChangeCard';
import { FIELD_STEPS, fieldChangeCells, fieldChangeRange } from './fieldChange';
import { fiveTargetScenario, startupSimulation } from './heatedEdge';

const saved: HeatfieldArtifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8'));

test('ΔB/B_VMEC is zero with the coils off, peaks at the switched coil, stays within ±ε, and matches the card', () => {
  const sim = startupSimulation(fiveTargetScenario(saved));
  const m = sim.model;
  sim.advance(Math.round(1 / m.params.dt));
  expect(Math.max(...Array.from(fieldChangeCells(sim), Math.abs))).toBe(0);
  expect(fieldChangeRange(sim)).toEqual([-0.001, 0.001]); // coils off: the smallest tidy bound

  sim.setCoil(1, true);
  sim.advance(sim.responseSteps + 2);
  const d = fieldChangeCells(sim);
  const [lo, hi] = fieldChangeRange(sim);
  expect(lo).toBe(-hi);
  // The bound fits the coils that are on (ε·max Σ c_k h_k), independently of the drive's phase: the tidy step above it.
  let cap = 0;
  for (let c = 0; c < m.nCells; c++) cap = Math.max(cap, m.h[1]![c]!);
  cap *= m.params.epsilon;
  expect(hi).toBe(FIELD_STEPS.filter((s) => s >= cap * (1 - 1e-9))[0]);
  // It holds while the coils hold: over a whole sweep the bound is unchanged and never exceeded, and the drawn
  // change passes through zero (the patches pulse) instead of the scale re-fitting to it.
  const most = Math.max(...Array.from(d, Math.abs));
  expect(most).toBeLessThanOrEqual(hi);
  let smallest = Infinity;
  for (let s = 0; s < 40; s++) {
    sim.advance(Math.max(1, Math.round(0.0125 / m.params.dt)));
    expect(fieldChangeRange(sim)[1]).toBe(hi);
    smallest = Math.min(smallest, Math.max(...Array.from(fieldChangeCells(sim), Math.abs)));
  }
  expect(smallest).toBeLessThan(0.25 * hi);
  let peak = 0;
  for (let c = 1; c < d.length; c++) if (Math.abs(d[c]!) > Math.abs(d[peak]!)) peak = c;
  expect(Math.abs(d[peak]!)).toBeGreaterThan(0);
  expect(Math.abs(d[peak]!)).toBeLessThanOrEqual(hi * (1 + 1e-6));
  // The largest change sits at D2's toroidal plane (within the coil envelope's width).
  const j = Math.floor(peak / m.nTheta);
  const gap = Math.abs(Math.atan2(Math.sin(m.phi[j]! - m.phiK[1]!), Math.cos(m.phi[j]! - m.phiK[1]!)));
  expect(gap).toBeLessThan(m.params.sigmaCoilPhi * 2);
  // The card's profile is these cells along the strike-line row.
  const card = sampleFieldChange(sim);
  const i = ((Math.round(m.thetaD / m.dTheta) % m.nTheta) + m.nTheta) % m.nTheta;
  const now = fieldChangeCells(sim);
  card.profile.forEach((p, jj) => expect(now[jj * m.nTheta + i]).toBeCloseTo(p.change, 6));
});

test('the heat map and the field change are never both on: switching one on switches the other off', async () => {
  const { toggleLayer } = await import('./plasmaLayers');
  const start = { heat: true, field: false, particles: true, lines: false, hardware: false };
  const field = toggleLayer(start, 'field');
  expect(field).toEqual({ ...start, heat: false, field: true });
  const heat = toggleLayer(field, 'heat');
  expect(heat).toEqual({ ...start, heat: true, field: false });
  // Switching one off leaves the other as it was, and other layers are untouched.
  expect(toggleLayer(field, 'field')).toEqual({ ...start, heat: false, field: false });
  expect(toggleLayer(start, 'lines')).toEqual({ ...start, lines: true });
});
