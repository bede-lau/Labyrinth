// @vitest-environment node
// The plasma tracers follow the equilibrium's magnetic field lines into their own divertor's strike line, in slow motion.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sampleRZ, vmecTheta } from '../heatfield/scene';
import type { HeatfieldArtifact } from '../heatfield/types';
import { fiveTargetScenario, startupSimulation } from './heatedEdge';
import { createParticleTracks, FLIGHT_SECONDS } from './particleTracks';

const saved: HeatfieldArtifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8'));
const wrapPi = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));

test('the field-line atlas reproduces every traced line, and in-between lines wind like their traced neighbours', () => {
  const art = fiveTargetScenario(saved);
  const sim = startupSimulation(art);
  const tracks = createParticleTracks(art, sim);
  const { nTheta, nPhi } = art.grid;
  const edge = art.surfaces.at(-1)!;
  for (const f of art.fieldLines)
    for (let s = 0; s < f.phi.length; s += 9) {
      const traced = vmecTheta(edge, nTheta, nPhi, Math.hypot(f.x[s]!, f.y[s]!), f.z[s]!, f.phi[s]!);
      expect(Math.abs(wrapPi(tracks.thetaAt(f.alpha, f.phi[s]!) - traced))).toBeLessThan(1e-6); // φ samples are stored to 7 figures
    }
  // A line halfway between two traced labels winds like its neighbours: over one toroidal turn its θ advance (≈ 2π·ι,
  // plus the change in λ between where the line starts and ends) lies between theirs.
  const advance = (alpha: number) => {
    let total = 0;
    const n = 360;
    for (let i = 0; i < n; i++) total += wrapPi(tracks.thetaAt(alpha, (2 * Math.PI * (i + 1)) / n) - tracks.thetaAt(alpha, (2 * Math.PI * i) / n));
    return total;
  };
  const [l0, l1] = [art.fieldLines[0]!.alpha, art.fieldLines[1]!.alpha];
  const [a0, a1, mid] = [advance(l0), advance(l1), advance((l0 + l1) / 2)];
  expect(mid).toBeGreaterThanOrEqual(Math.min(a0, a1) - 1e-9);
  expect(mid).toBeLessThanOrEqual(Math.max(a0, a1) + 1e-9);
  expect(Math.abs(mid / (2 * Math.PI) - sim.model.iota)).toBeLessThan(0.1); // close to ι
  // Continuous across φ = 0 (the label shifts by 2πι per toroidal turn): just before and just after the seam agree to
  // the interpolation error between traced lines π/4 apart in α (~0.02 rad, under a centimetre on the LCFS); a wrong
  // shift would jump by ~2πι mod 2π ≈ 0.4 rad.
  for (const alpha of [0.3, 1.7, 4.1]) {
    const d = 1e-4;
    expect(Math.abs(wrapPi(tracks.thetaAt(alpha, -d) - tracks.thetaAt(alpha, d)))).toBeLessThan(0.03);
    expect(Math.abs(wrapPi(tracks.thetaAt(alpha, 2 * Math.PI - d) - tracks.thetaAt(alpha, 2 * Math.PI + d)))).toBeLessThan(0.03);
  }
});

test('each tracer runs along the field line through its own strike point, and the slow motion is stated', () => {
  const art = fiveTargetScenario(saved);
  const sim = startupSimulation(art);
  sim.advance(Math.round(2 / sim.model.params.dt));
  const tracks = createParticleTracks(art, sim);
  const rows = tracks.read();
  const strike = sim.model.strikeLines(sim.coils, sim.state.n);
  const p = sim.model.params;
  rows.forEach((row, k) => {
    // A line through the strike point was found (a failed search would give NaN, and the tracer would not be drawn).
    expect(Number.isFinite(row.alpha)).toBe(true);
    // At its plate (φ_k) the tracer's field line is at the divertor's strike line.
    expect(Math.abs(wrapPi(tracks.thetaAt(row.alpha, art.diverters.items[k]!.phi) - strike[k]!))).toBeLessThan(1e-3);
    // Its head is on that line, on the LCFS.
    const [r, z] = sampleRZ(art.surfaces.at(-1)!, art.grid.nTheta, art.grid.nPhi, row.theta, row.phi);
    expect(Math.abs(Math.hypot(row.position[0], row.position[1]) - r)).toBeLessThan(1e-9);
    expect(Math.abs(row.position[2] - z)).toBeLessThan(1e-9);
    // Real flight: L_c at the sound speed of the divertor's upstream temperature, about a millisecond.
    const tu = sim.model.edge(sim.state.n, sim.coils).Tu[k]!;
    const cs = Math.sqrt((2 * tu * p.keV) / (p.ionMass * p.amu));
    expect(row.realFlight).toBeCloseTo(p.connectionLength / cs, 12);
    expect(row.realFlight).toBeGreaterThan(5e-4);
    expect(row.realFlight).toBeLessThan(5e-3);
    // The drawn piece is a few metres of field line, a small part of L_c; on screen it moves at drawn/FLIGHT_SECONDS,
    // so the slow motion against the sound speed is c_s over that.
    expect(row.drawnLength).toBeGreaterThan(1);
    expect(row.drawnLength).toBeLessThan(0.05 * p.connectionLength);
    expect(row.slowdown).toBeCloseTo(cs / (row.drawnLength / FLIGHT_SECONDS), 6);
  });
  // The tracer moves toward its plate (progress grows) and in +φ toward φ_k.
  const before = tracks.read().map((r) => [r.progress, r.phi]);
  sim.advance(50);
  tracks.read().forEach((r, k) => {
    if (r.progress < before[k]![0]!) return; // landed and restarted
    expect(r.progress).toBeGreaterThan(before[k]![0]!);
    expect(wrapPi(r.phi - before[k]![1]!)).toBeGreaterThan(0);
  });
});
