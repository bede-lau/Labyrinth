// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stepsForFrame } from '../heatfield/playback';
import { spunUpState } from '../heatfield/model';
import { Simulation } from '../heatfield/sim';
import type { HeatfieldArtifact } from '../heatfield/types';
import { createParticleTracks } from './particleTracks';
import { fiveTargetScenario, heatedEdge, heatedRanges, scenarioCoreEnergy, scenarioHeating, SCENARIO_POWER, startupSimulation } from './heatedEdge';

test('ongoing prescribed heating changes edge temperature and flux with feedback off, and forecast matches replay', () => {
  const art: HeatfieldArtifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8'));
  const model = heatedEdge(art);
  const sim = new Simulation(model, spunUpState(model));
  const initial = sim.state;
  const initialFlux = sim.diagnostics().peakHeatFlux;
  const prediction = sim.predict(500);
  expect(sim.state).toBe(initial);
  sim.advance(500);
  expect(sim.coils).toEqual([0, 0, 0, 0]);
  expect(sim.diagnostics()).toEqual(prediction);
  expect(Math.max(...sim.state.T.map((t, i) => Math.abs(t - initial.T[i]!)))).toBeGreaterThan(1e-3); // keV: the modulated heating moves the edge
  expect(Math.max(...prediction.peakHeatFlux.map((v, i) => Math.abs(v - initialFlux[i]!)))).toBeGreaterThan(0.01);
  expect(Math.min(...sim.state.T)).toBeGreaterThan(0);
});

test('five targets share a pulsing core and edge; each tracer stays with its own diverter', () => {
  const saved: HeatfieldArtifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8'));
  const art = fiveTargetScenario(saved);
  expect(saved.diverters.items).toHaveLength(4);
  const model = heatedEdge(art);
  const sim = new Simulation(model, model.initialState());
  const tracks = createParticleTracks(art, sim);
  const first = tracks.read();
  expect(first).toHaveLength(5);
  const core = () => model.crossSection(sim.state,sim.coils,0).T[0]!;
  const initial = core();
  sim.setCoils([1,0,0,1,0]);
  sim.advance(1100);
  expect(Math.abs(core() - initial)).toBeGreaterThan(0.3);
  expect(core()).toBeLessThanOrEqual(heatedRanges(art,sim).sliceT[1]);
  expect(core()).toBe(model.crossSection(sim.state,sim.coils,14).T[4]);
  sim.advance(2600);
  const later = tracks.read();
  // Nothing moves heat between targets (D-031): every tracer circles within a sector of its own diverter.
  later.forEach((p, k) => {
    expect(p.from).toBe(k);
    const d = p.phi - art.diverters.items[k]!.phi;
    expect(Math.abs(Math.atan2(Math.sin(d), Math.cos(d)))).toBeLessThan(Math.PI / art.diverters.items.length);
  });
  expect(tracks.read()).toBe(later);
  sim.reset();
  expect(tracks.read()).toEqual(first);
});

test('tracers keep their heads, trails and readings through coil switches and shutdown', () => {
  const art = fiveTargetScenario(JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8')));
  const model = heatedEdge(art);
  const sim = new Simulation(model, spunUpState(model), 0.35);
  const tracks = createParticleTracks(art, sim);
  const initial = tracks.read();
  const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v,k) => v-b[k]!));
  function command(coils: number[]) {
    const before = tracks.read();
    const oldState = sim.state, oldField = sim.field();
    sim.setCoils(coils);
    expect(sim.state).toBe(oldState);
    expect(sim.field()).toBe(oldField);
    tracks.read().forEach((p,k) => {
      const old = before[k]!;
      expect(distance(p.position,old.position)).toBeLessThan(1e-12);
      p.trail.forEach((point,i) => expect(distance(point,old.trail[i]!)).toBeLessThan(1e-12));
      expect(p.temperature).toBeCloseTo(old.temperature,12);
      expect(p.field).toBeCloseTo(old.field,12);
      expect(p.flux).toBe(old.flux);
    });
  }
  command([1,0,0,0,0]);
  // Switch coils mid-ramp, then everything off.
  for (let frame = 0; frame < 420; frame++) {
    if (frame === 180) command([1,0,1,0,0]);
    if (frame === 195) command([0,1,1,0,0]);
    if (frame === 300) command([0,0,0,0,0]);
    const previous = tracks.read();
    sim.advance(10);
    tracks.read().forEach((p,k) => {
      expect(distance(previous[k]!.position,p.position)).toBeLessThan(0.33);
      expect(Math.abs(previous[k]!.temperature-p.temperature)).toBeLessThan(0.04);
      expect(Math.abs(previous[k]!.field-p.field)).toBeLessThan(0.1);
    });
  }
  expect(sim.coils).toEqual([0,0,0,0,0]);
  sim.reset();
  expect(tracks.read()).toEqual(initial);
}, 20_000);

test('interrupted actuator ramps match prediction and are independent of render cadence', () => {
  const art = fiveTargetScenario(JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8')));
  const model = heatedEdge(art);
  const run = (batches: number[]) => {
    const sim = new Simulation(model, model.initialState(), 0.35);
    const tracks = createParticleTracks(art,sim);
    sim.setCoils([1,0,0,0,0]);
    for (const steps of batches) { sim.advance(steps); tracks.read(); }
    expect(sim.coils[0]).toBeGreaterThan(0);
    expect(sim.coils[0]).toBeLessThan(1);
    sim.setCoils([0,0,1,0,0]);
    const predicted = sim.predict(450);
    sim.advance(450);
    expect(sim.diagnostics()).toEqual(predicted);
    return {temperatures:sim.state.T,tiles:sim.state.tiles,heads:tracks.read().map(p=>p.position)};
  };
  expect(run([160])).toEqual(run([13,47,50,50]));
});

test('late animation frames carry every unprocessed solver step forward', () => {
  let steps = 0, acc = 0;
  for (const seconds of [0.15,0.016,0.016,0.016]) {
    const frame = stepsForFrame(acc, seconds, 1, 0.001);
    acc = frame.acc;
    steps += frame.steps;
  }
  expect(steps).toBe(198);
  expect(acc).toBeCloseTo(0,12);
});

test('each hundredth-speed slider setting advances exactly one second of wall time at that rate', () => {
  for (let hundredths = 1; hundredths <= 200; hundredths++) {
    let acc = 0, steps = 0;
    for (let frame = 0; frame < 60; frame++) {
      const tick = stepsForFrame(acc, 1/60, hundredths/100, 0.001);
      steps += tick.steps;
      acc = tick.acc;
    }
    expect(steps).toBe(hundredths*10);
  }
});

test('cold startup heats the core before the edge (0-D energy balance), then feedback relieves a hot target', () => {
  const saved = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8'));
  const sim = startupSimulation(fiveTargetScenario(saved));
  const {Tcool, tileLimit, dt} = sim.model.params;
  const core = () => sim.model.crossSection(sim.state, sim.coils, 0).T[0]!;
  expect(sim.time).toBe(0);
  expect(core()).toBe(0);
  expect(sim.peakTileC(0)).toBe(Tcool);
  // Before the heaters switch on (0.2 s) nothing is stored and nothing crosses the LCFS.
  sim.advance(Math.round(0.15 / dt));
  expect(core()).toBe(0);
  expect(Math.max(...sim.state.T)).toBe(0);
  expect(sim.peakTileC(0)).toBe(Tcool);
  // Heating on: the core fills first (dW/dt = P − W/τ_E): the power leaving it, W/τ_E, lags the heating, and the
  // stored energy accounts for the difference (energy conserved).
  const energy = scenarioCoreEnergy(fiveTargetScenario(saved));
  for (const t of [0.3, 0.4, 0.5]) expect(energy.lossPower(t)).toBeLessThan(energy.heating(t));
  sim.advance(Math.round(0.25 / dt));
  expect(core()).toBeGreaterThan(0);
  expect(sim.peakTileC(0)).toBeLessThan(Tcool + 100);
  // Steady state: the loss power is the heating (within the modulation's lag), so the targets get the scenario power.
  const late = [8, 9, 10].map((t) => energy.lossPower(t) / energy.heating(t));
  late.forEach((r) => expect(Math.abs(r - 1)).toBeLessThan(0.05));
  let peaks = sim.coils.map((_, k) => sim.peakTileC(k));
  while (Math.max(...peaks) < tileLimit && sim.time < 12) {
    sim.advance(100);
    peaks = sim.coils.map((_, k) => sim.peakTileC(k));
  }
  expect(Math.max(...peaks)).toBeGreaterThanOrEqual(tileLimit);
  const from = peaks.indexOf(Math.max(...peaks));
  const unregulated = sim.predict(600);
  sim.setCoils(peaks.map(t => Number(t >= tileLimit)));
  sim.advance(600);
  // The strike-line sweep spreads the load: the hot target ends cooler than without its coil.
  expect(sim.peakTileC(from)).toBeLessThan(unregulated.peakTileC[from]!);
});

test('the scenario heating is SCENARIO_POWER times the nominal power, and the model shares exactly that', () => {
  const saved: HeatfieldArtifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8'));
  const art = fiveTargetScenario(saved);
  const { Pheat, fRad } = saved.model.parameters;
  const h = scenarioHeating(art);
  expect(h.factor).toBe(SCENARIO_POWER);
  expect(h.mean).toBeCloseTo(SCENARIO_POWER * Pheat.value, 12);
  expect(h.lo).toBeGreaterThan(0.85 * h.mean);
  expect(h.hi).toBeLessThan(1.15 * h.mean);
  // Fully on (after the sector ramp), the divertors share the scenario power less the radiated part, within its range.
  const model = heatedEdge(art);
  for (const t of [8, 9.3, 11.1]) {
    const e = model.edge(Math.round(t / model.params.dt), [0, 0, 0, 0, 0]);
    const total = e.shares.reduce((a, b) => a + b, 0) / (1 - fRad.value);
    expect(total).toBeGreaterThanOrEqual(h.lo * (1 - 1e-9));
    expect(total).toBeLessThanOrEqual(h.hi * (1 + 1e-9));
  }
});

test('τ_E follows the heating power (ISS04, τ ∝ P^−0.61): shorter at the modulation peak, and the loss is W/τ_E(P(t))', () => {
  const art = fiveTargetScenario(JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8')));
  const core = scenarioCoreEnergy(art);
  const p = startupSimulation(art).model.params;
  // Over a modulation period (5 s), τ_E is shortest where the heating is highest.
  const times = Array.from({ length: 50 }, (_, i) => 6 + 0.1 * i);
  const hi = times.reduce((a, t) => (core.heating(t) > core.heating(a) ? t : a));
  const lo = times.reduce((a, t) => (core.heating(t) < core.heating(a) ? t : a));
  expect(core.tauAt(hi)).toBeLessThan(core.tauAt(lo));
  expect(core.tauAt(hi) / core.tauAt(lo)).toBeCloseTo((core.heating(hi) / core.heating(lo)) ** p.iss04P, 10);
  // The mean-power τ quoted in the view is ISS04 at the mean.
  expect(core.tauAt(hi)).toBeLessThan(core.tau);
  expect(core.tauAt(lo)).toBeGreaterThan(core.tau);
});
