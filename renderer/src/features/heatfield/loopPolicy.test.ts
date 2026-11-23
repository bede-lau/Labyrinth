// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fiveTargetScenario, startupSimulation } from '../geometry/heatedEdge';
import { balanceTargets } from './loadBalance';
import { DEFAULT_LOOP_CONFIG, decideLoop, decideSteps, LoopController } from './loopPolicy';
import { createModel, modelFor, spunUpState } from './model';
import { Simulation } from './sim';
import type { HeatfieldArtifact } from './types';

const saved = (): HeatfieldArtifact => JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8'));
const HORIZON_S = 0.25;
const seconds = (sim: Simulation, s: number) => sim.advance(Math.round(s / sim.model.params.dt));

test('one diverter predicted hot switches every coil on, and the transfer adopted lowers the maximum on an independent run', () => {
  const sim = startupSimulation(fiveTargetScenario(saved()));
  const limit = sim.model.params.tileLimit;
  const controller = new LoopController(sim, HORIZON_S, true);
  for (;;) {
    const outcome = controller.decide();
    if (outcome.peakTileC.some((t) => t > limit)) {
      // Mixed: some diverters are predicted hot, others are not. Old behaviour: switch the hot ones on and start a
      // transfer. Now: every coil on, and the route the balancer proposes is judged by its forecast.
      expect(outcome.peakTileC.some((t) => t <= limit)).toBe(true);
      expect(balanceTargets(outcome.peakTileC, limit, sim.model.params.Tcool).length).toBeGreaterThan(0);
      expect(outcome.coils).toEqual([1, 1, 1, 1, 1]);
      // The balancer's route is adopted only because its forecast beats no route; run both on copies to check.
      expect(outcome.transfers).toEqual(balanceTargets(outcome.peakTileC, limit, sim.model.params.Tcool, true));
      const hottestAfter = (routes: typeof outcome.transfers) => {
        const copy = new Simulation(sim.model, sim.state, 0.35);
        copy.setCoils(outcome.coils, routes);
        let hottest = -Infinity;
        for (let i = 0; i < 5; i++) {
          copy.advance(50);
          hottest = Math.max(hottest, ...[0, 1, 2, 3, 4].map((k) => copy.peakTileC(k)));
        }
        return hottest;
      };
      expect(hottestAfter(outcome.transfers)).toBeLessThan(hottestAfter([]));
      return;
    }
    expect(outcome.coils).toEqual([0, 0, 0, 0, 0]); // nothing predicted hot, nothing switched on
    seconds(sim, 0.25);
    expect(sim.time).toBeLessThan(20);
  }
}, 60_000);

test('the forecast uses the coils as they are: a cool diverter with its coil on is not switched off before the minimum on-time', () => {
  // A model whose edge heating has gone away: the tiles idle far below the release temperature even with coils off.
  const art = saved();
  const cool = new Float64Array(art.grid.nTheta * art.grid.nPhi).fill(0.3 * art.model.parameters.Tped.value);
  const model = createModel(art, () => cool);
  const sim = new Simulation(model, model.initialState(), 0);
  seconds(sim, 4);
  expect(Math.max(...[0, 1, 2, 3].map((k) => sim.peakTileC(k)))).toBeLessThan(sim.model.params.tileLimit - DEFAULT_LOOP_CONFIG.releaseMarginC);
  sim.setCoils([1, 1, 1, 1]);
  const controller = new LoopController(sim, HORIZON_S, true);
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
  const model = modelFor(saved()); // unheated: the tiles idle at ~1150-1380 deg C with every coil off
  const sim = new Simulation(model, spunUpState(model), 0);
  sim.setCoils([1, 1, 1, 1]);
  const controller = new LoopController(sim, HORIZON_S, true);
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
  const controller = new LoopController(sim, HORIZON_S, true);
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
  const controller = new LoopController(sim, HORIZON_S, true);
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
