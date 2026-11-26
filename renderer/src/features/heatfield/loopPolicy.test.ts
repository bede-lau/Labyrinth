// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fiveTargetScenario, startupSimulation } from '../geometry/heatedEdge';
import { DEFAULT_LOOP_CONFIG, decideLoop, decideSteps, guardSteps, LoopController } from './loopPolicy';
import { createModel, modelFor, spunUpState } from './model';
import { Simulation } from './sim';
import type { HeatfieldArtifact } from './types';

const saved = (): HeatfieldArtifact => JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8'));
const HORIZON_S = 0.25;
const seconds = (sim: Simulation, s: number) => sim.advance(Math.round(s / sim.model.params.dt));

test('one diverter predicted hot switches every coil on; nothing is switched while none is', () => {
  const sim = startupSimulation(fiveTargetScenario(saved()));
  const limit = sim.model.params.tileLimit;
  const controller = new LoopController(sim, HORIZON_S);
  for (;;) {
    const outcome = controller.decide();
    if (outcome.peakTileC.some((t) => t > limit)) {
      // Mixed: some diverters are predicted hot, others are not, and every coil goes on.
      expect(outcome.peakTileC.some((t) => t <= limit)).toBe(true);
      expect(outcome.coils).toEqual([1, 1, 1, 1, 1]);
      return;
    }
    expect(outcome.coils).toEqual([0, 0, 0, 0, 0]); // nothing predicted hot, nothing switched on
    seconds(sim, 0.05); // fine steps, so the first crossing is caught while only the hottest diverters are over
    expect(sim.time).toBeLessThan(20);
  }
}, 60_000);

test('the forecast uses the coils as they are: a cool diverter with its coil on is not switched off before the minimum on-time', () => {
  // A model whose edge heating has gone away: the tiles idle far below the release temperature even with coils off.
  const art = saved();
  const cool = new Float64Array(art.grid.nTheta * art.grid.nPhi).fill(0.3); // 30 % of the nominal heating power
  const model = createModel(art, () => cool);
  const sim = new Simulation(model, model.initialState(), 0);
  seconds(sim, 4);
  expect(Math.max(...[0, 1, 2, 3].map((k) => sim.peakTileC(k)))).toBeLessThan(sim.model.params.tileLimit - DEFAULT_LOOP_CONFIG.releaseMarginC);
  sim.setCoils([1, 1, 1, 1]);
  const controller = new LoopController(sim, HORIZON_S);
  const first = controller.decide();
  expect(first.coils).toEqual([1, 1, 1, 1]);
  expect(first.probed).toBe(false);
  seconds(sim, DEFAULT_LOOP_CONFIG.minOnS - 0.1);
  expect(controller.decide().coils).toEqual([1, 1, 1, 1]);
  seconds(sim, 0.2);
  const later = controller.decide();
  expect(later.probed).toBe(true);
  expect(later.coils).toEqual([0, 0, 0, 0]); // on long enough, and the look-ahead with them off stays below the release temperature
  expect(controller.apply(later)).toBe(4);
  expect(sim.commandedCoils).toEqual([0, 0, 0, 0]);
}, 60_000);

test('coils stay on, after the minimum on-time, while the heating that made them necessary persists', () => {
  const model = modelFor(saved()); // unheated: the tiles idle at ~1080-1290 deg C with every coil off
  const sim = new Simulation(model, spunUpState(model), 0);
  sim.setCoils([1, 1, 1, 1]);
  const controller = new LoopController(sim, HORIZON_S);
  seconds(sim, DEFAULT_LOOP_CONFIG.minOnS + 1);
  const outcome = controller.decide();
  expect(outcome.probed).toBe(true); // it looked, and the look-ahead with the coils off said no
  expect(outcome.coils).toEqual([1, 1, 1, 1]);
}, 60_000);

test('hysteresis: a coil that is on does not go off while the look-ahead without it passes the release temperature', () => {
  const sim = startupSimulation(fiveTargetScenario(saved()));
  const { tileLimit, dt } = sim.model.params;
  // Coils off until D1 is at about 1180 deg C: below the limit, above the release temperature (1000).
  while (sim.peakTileC(0) < tileLimit - 30) sim.advance(10);
  sim.setCoils([1, 1, 1, 1, 1]);
  seconds(sim, 6); // on for longer than the minimum on-time
  const controller = new LoopController(sim, HORIZON_S);
  controller.memory.onSince.fill(sim.state.n - Math.round(DEFAULT_LOOP_CONFIG.minOnS / dt) - 1);
  const request = controller.request();
  const outcome = decideLoop(sim.model, request);
  // With the coils on the diverters are cool now, but the heating has not gone away: the probe refuses the release.
  expect(outcome.coils).toEqual([1, 1, 1, 1, 1]);
  expect(outcome.probed).toBe(true);
  expect(outcome.nextProbe).toBeGreaterThan(sim.state.n);
  // A refused probe is not repeated until nextProbe.
  controller.memory.nextProbe = outcome.nextProbe;
  expect(controller.decide().probed).toBe(false);
}, 60_000);

test('a decision run in pieces equals the same decision run at once', () => {
  const sim = startupSimulation(fiveTargetScenario(saved()));
  seconds(sim, 6.5);
  const controller = new LoopController(sim, HORIZON_S);
  const request = controller.request();
  const whole = decideLoop(sim.model, request);
  const run = decideSteps(sim.model, request);
  let pieces = 0;
  for (let r = run.next(); ; r = run.next()) {
    if (r.done) {
      expect(r.value).toEqual(whole);
      break;
    }
    pieces++;
  }
  expect(pieces).toBeGreaterThan(1);
}, 60_000);

/** Run a decision with a given work chunk to its end; the yields (progress, provisional outcomes) are skipped. */
function finish(model: Parameters<typeof decideSteps>[0], request: Parameters<typeof decideSteps>[1], chunk: number) {
  const run = decideSteps(model, request, chunk);
  for (let r = run.next(); ; r = run.next()) if (r.done) return r.value;
}

test('a decision does not depend on how its work is chunked: a hot decision and a release probe, at chunks 7, 10 and 50', () => {
  // Hot: the five-target scenario while D1 heats up, every coil off.
  const hot = startupSimulation(fiveTargetScenario(saved()));
  seconds(hot, 6.5);
  const hotRequest = new LoopController(hot, HORIZON_S).request();
  const hotWhole = decideLoop(hot.model, hotRequest);
  expect(hotWhole.coils).toEqual([1, 1, 1, 1, 1]);
  // Probe: coils on past the minimum on-time with the tiles cool, so the release look-ahead runs.
  const art = saved();
  const coolDrive = new Float64Array(art.grid.nTheta * art.grid.nPhi).fill(0.3); // 30 % of the nominal heating power
  const model = createModel(art, () => coolDrive);
  const cool = new Simulation(model, model.initialState(), 0);
  seconds(cool, 4);
  cool.setCoils([1, 1, 1, 1]);
  const controller = new LoopController(cool, HORIZON_S);
  seconds(cool, DEFAULT_LOOP_CONFIG.minOnS + 0.1);
  const probeRequest = controller.request();
  const probeWhole = decideLoop(cool.model, probeRequest);
  expect(probeWhole.probed).toBe(true);
  for (const chunk of [7, 10, 50]) {
    expect(finish(hot.model, hotRequest, chunk)).toEqual(hotWhole);
    expect(finish(cool.model, probeRequest, chunk)).toEqual(probeWhole);
  }
}, 120_000);

test('the switch-on is yielded at the first hot sample, before the guard forecast ends, and only once', () => {
  const sim = startupSimulation(fiveTargetScenario(saved()));
  seconds(sim, 6.5);
  const request = new LoopController(sim, HORIZON_S).request();
  const run = decideSteps(sim.model, request, 10);
  const provisional: { at: number; coils: number[] }[] = [];
  let progress = 0;
  for (let r = run.next(); !r.done; r = run.next()) {
    if (typeof r.value === 'number') progress = r.value;
    else provisional.push({ at: progress, coils: r.value.coils });
  }
  expect(provisional).toHaveLength(1);
  expect(provisional[0]!.coils).toEqual([1, 1, 1, 1, 1]);
  expect(provisional[0]!.at).toBeLessThan(guardSteps(sim.model, request));
}, 60_000);
