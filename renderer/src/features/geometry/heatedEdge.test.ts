// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stepsForFrame } from '../heatfield/playback';
import { spunUpState } from '../heatfield/model';
import { Simulation } from '../heatfield/sim';
import type { HeatfieldArtifact } from '../heatfield/types';
import { createParticleTracks } from './particleTracks';
import { fiveTargetScenario, heatedEdge, heatedRanges, scenarioHeating, SCENARIO_POWER, startupSimulation } from './heatedEdge';

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
});

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

test('cold startup heats the core before the edge, then feedback relieves a hot target', () => {
  const saved = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8'));
  const sim = startupSimulation(fiveTargetScenario(saved));
  const {Tcool, tileLimit, dt} = sim.model.params;
  const core = () => sim.model.crossSection(sim.state, sim.coils, 0).T[0]!;
  expect(sim.time).toBe(0);
  expect(core()).toBe(0);
  expect(sim.peakTileC(0)).toBe(Tcool);
  sim.advance(Math.round(0.3 / dt));
  // The core is warming; no heating has crossed the LCFS yet (it starts at 0.4 s), so there is no scrape-off-layer
  // plasma and, by energy conservation, no load: the tiles are still at the coolant temperature.
  expect(core()).toBeGreaterThan(0);
  expect(Math.max(...sim.state.T)).toBe(0);
  expect(sim.peakTileC(0)).toBe(Tcool);
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
  const h = scenarioHeating(Pheat.value);
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
