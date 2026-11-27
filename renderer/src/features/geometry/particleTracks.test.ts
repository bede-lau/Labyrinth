// @vitest-environment node
// The plasma tracers follow the equilibrium's magnetic field lines into their own divertor's strike line, in slow motion.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sampleRZ, vmecTheta } from '../heatfield/scene';
import type { HeatfieldArtifact } from '../heatfield/types';
import { fiveTargetScenario, startupSimulation } from './heatedEdge';
import { createParticleTracks, TURN_SECONDS } from './particleTracks';

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

test('each tracer streams continuously round the torus on its own field line, from its strike line, in stated slow motion', () => {
  const art = fiveTargetScenario(saved);
  const sim = startupSimulation(art);
  sim.advance(Math.round(2 / sim.model.params.dt));
  const tracks = createParticleTracks(art, sim);
  const p = sim.model.params;
  const rows = tracks.read();
  rows.forEach((row, k) => {
    // Its field line passes through its divertor's nominal strike line (θ_d at φ_k); the label never changes.
    expect(Number.isFinite(row.alpha)).toBe(true);
    expect(Math.abs(wrapPi(tracks.thetaAt(row.alpha, art.diverters.items[k]!.phi) - sim.model.thetaD))).toBeLessThan(1e-3);
    // Its head is on that line, on the LCFS.
    expect(Math.abs(wrapPi(row.theta - tracks.thetaAt(row.alpha, row.phiU)))).toBeLessThan(1e-12);
    const [r, z] = sampleRZ(art.surfaces.at(-1)!, art.grid.nTheta, art.grid.nPhi, row.theta, row.phi);
    expect(Math.abs(Math.hypot(row.position[0], row.position[1]) - r)).toBeLessThan(1e-9);
    expect(Math.abs(row.position[2] - z)).toBeLessThan(1e-9);
    // One toroidal turn per TURN_SECONDS, from φ_k at t = 0.
    expect(row.phiU).toBeCloseTo(art.diverters.items[k]!.phi + (2 * Math.PI * sim.time) / TURN_SECONDS, 12);
    // Slow motion against the sound speed of the divertor it is passing.
    const tu = sim.model.edge(sim.state.n, sim.coils).Tu[row.from]!;
    const cs = Math.sqrt((2 * tu * p.keV) / (p.ionMass * p.amu));
    expect(row.soundSpeed).toBeCloseTo(cs, 9);
    expect(row.screenSpeed).toBeGreaterThan(0.5);
    expect(row.screenSpeed).toBeLessThan(20);
    expect(row.slowdown).toBeCloseTo(cs / row.screenSpeed, 6);
  });
  // A whole turn later every tracer is back near where it was, on the same line, having never jumped.
  const start = rows.map((r) => r.position);
  let last = start;
  const steps = Math.round(TURN_SECONDS / p.dt);
  for (let done = 0; done < steps; done += 100) {
    sim.advance(Math.min(100, steps - done));
    const now = tracks.read().map((r) => r.position);
    now.forEach((q, k) => expect(Math.hypot(q[0] - last[k]![0], q[1] - last[k]![1], q[2] - last[k]![2])).toBeLessThan(1.5));
    last = now;
  }
  tracks.read().forEach((r, k) => {
    // After one turn the line is at θ advanced by ~2πι: the same field line, a different poloidal place (it is not closed).
    expect(Math.abs(wrapPi(r.theta - tracks.thetaAt(rows[k]!.alpha, r.phiU)))).toBeLessThan(1e-12);
    expect(r.phiU - rows[k]!.phiU).toBeCloseTo(2 * Math.PI, 6);
  });
}, 60_000);
