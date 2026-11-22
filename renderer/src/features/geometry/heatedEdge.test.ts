// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stepsForFrame } from '../heatfield/playback';
import { balanceTargets, distributeLoads } from '../heatfield/loadBalance';
import { spunUpState } from '../heatfield/model';
import { Simulation } from '../heatfield/sim';
import type { HeatfieldArtifact } from '../heatfield/types';
import { createParticleTracks } from './particleTracks';
import { fiveTargetScenario, heatedEdge, heatedRanges, startupSimulation } from './heatedEdge';

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
  expect(Math.max(...sim.state.T.map((t, i) => Math.abs(t - initial.T[i]!)))).toBeGreaterThan(0.01);
  expect(Math.max(...prediction.peakHeatFlux.map((v, i) => Math.abs(v - initialFlux[i]!)))).toBeGreaterThan(0.01);
  expect(Math.min(...sim.state.T)).toBeGreaterThan(0);
});

test('five targets share a pulsing core, edge and coil-guided tracer clock', () => {
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
  const routes = balanceTargets([1450,1000,940,1400,980],model.params.tileLimit,model.params.Tcool);
  expect(routes.map(r => [r.from,r.to])).toEqual([[0,2],[3,4]]);
  sim.setCoils([1,0,0,1,0],routes);
  expect(tracks.read().filter(p => p.steered).map(p => p.to)).toEqual([2,4]);
  sim.advance(1100);
  expect(Math.abs(core() - initial)).toBeGreaterThan(0.3);
  expect(core()).toBeLessThanOrEqual(heatedRanges(art,sim).sliceT[1]);
  expect(core()).toBe(model.crossSection(sim.state,sim.coils,14).T[4]);
  sim.advance(2600);
  const redirected = tracks.read();
  expect(redirected.filter(p => p.steered).map(p => [p.from,p.to])).toEqual([[0,2],[3,4]]);
  const raw = model.stripLoads(sim.state,sim.coils);
  const split = model.stripLoads(sim.state,sim.coils,routes);
  expect(split.reduce((a,b)=>a+b)).toBeCloseTo(raw.reduce((a,b)=>a+b),9);
  const next = model.advance(sim.state,sim.coils,1,routes);
  const direct = model.advance(sim.state,sim.coils,1);
  expect(next.tiles.some((t,i)=>i < model.nTheta && t < direct.tiles[i]!)).toBe(true);
  expect(next.tiles.some((t,i)=>Math.floor(i/model.nTheta) === 2 && t > direct.tiles[i]!)).toBe(true);
  expect(tracks.read()).toBe(redirected);
  sim.reset();
  expect(tracks.read()).toEqual(first);
});

test('opposite heat transfers follow the shorter clockwise and counterclockwise arcs', () => {
  const art = fiveTargetScenario(JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8')));
  const model = heatedEdge(art);
  const sim = new Simulation(model, model.initialState());
  const tracks = createParticleTracks(art, sim);
  const routes = balanceTargets([1500, 1130, 1470, 980, 900], 1200, 30);
  expect(routes.map(r => [r.from,r.to])).toEqual([[0,4],[2,3]]);
  sim.setCoils([1,0,1,0,0],routes);
  const initial = tracks.read();
  sim.advance(330);
  const moved = tracks.read();
  const delta = (k: number) => {
    const d = moved[k]!.phi - initial[k]!.phi;
    return Math.atan2(Math.sin(d),Math.cos(d));
  };
  expect(delta(0)).toBeLessThan(0);
  expect(delta(2)).toBeGreaterThan(0);
  sim.setCoils([0,0,0,0,0]);
  expect(tracks.read().every(r => r.from === r.to)).toBe(true);
});


test('tracers keep their heads, trails and readings through arrivals, reversals and coil shutdown', () => {
  const art = fiveTargetScenario(JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8')));
  const model = heatedEdge(art);
  const sim = new Simulation(model, spunUpState(model), 0.35);
  const tracks = createParticleTracks(art, sim);
  const initial = tracks.read();
  const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v,k) => v-b[k]!));
  function command(to?: number) {
    const before = tracks.read();
    const oldState = sim.state, oldField = sim.field();
    sim.setCoils([Number(to !== undefined),0,0,0,0], to === undefined ? [] : [{from:0,to,fraction:0.2}]);
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
  command(4);
  // Pass the old relaunch point several times, then reverse during a handover.
  for (let frame = 0; frame < 420; frame++) {
    if (frame === 180) command(2);
    if (frame === 195) command(1);
    if (frame === 300) command();
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
    sim.setCoils([1,0,0,0,0],[{from:0,to:2,fraction:0.2}]);
    for (const steps of batches) { sim.advance(steps); tracks.read(); }
    expect(sim.coils[0]).toBeGreaterThan(0);
    expect(sim.coils[0]).toBeLessThan(1);
    sim.setCoils([0,0,1,0,0],[{from:2,to:0,fraction:0.1}]);
    const predicted = sim.predict(450);
    sim.advance(450);
    expect(sim.diagnostics()).toEqual(predicted);
    return {temperatures:sim.state.T,tiles:sim.state.tiles,heads:tracks.read().map(p=>p.position)};
  };
  expect(run([160])).toEqual(run([13,47,50,50]));
  const loads = new Float64Array([4,6]);
  distributeLoads(loads,1,[{from:0,to:1,fraction:0.25},{from:1,to:0,fraction:0.5}]);
  expect([...loads]).toEqual([6,4]);
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
  const {Ttarget, Tcool, tileLimit, dt} = sim.model.params;
  const core = () => sim.model.crossSection(sim.state, sim.coils, 0).T[0]!;
  expect(sim.time).toBe(0);
  expect(core()).toBeCloseTo(Ttarget);
  expect(sim.peakTileC(0)).toBe(Tcool);
  sim.advance(Math.round(0.3 / dt));
  expect(core()).toBeGreaterThan(Ttarget);
  expect(Math.max(...sim.state.T)).toBeCloseTo(Ttarget);
  expect(sim.peakTileC(0)).toBeCloseTo(Tcool);
  let peaks = sim.coils.map((_, k) => sim.peakTileC(k));
  while (Math.max(...peaks) < tileLimit && sim.time < 12) {
    sim.advance(100);
    peaks = sim.coils.map((_, k) => sim.peakTileC(k));
  }
  expect(Math.max(...peaks)).toBeGreaterThanOrEqual(tileLimit);
  const routes = balanceTargets(peaks, tileLimit, Tcool);
  expect(routes.length).toBeGreaterThan(0);
  const {from, to} = routes[0]!;
  const unregulated = sim.predict(600);
  sim.setCoils(peaks.map(t => Number(t >= tileLimit)), routes);
  sim.advance(600);
  expect(sim.peakTileC(from)).toBeLessThan(unregulated.peakTileC[from]!);
  expect(sim.model.stripLoads(sim.state, sim.coils, sim.transfers).subarray(to * sim.model.nTheta, (to+1)*sim.model.nTheta)
    .some((v, i) => v > sim.model.stripLoads(sim.state, sim.coils)[to * sim.model.nTheta + i]!)).toBe(true);
});
