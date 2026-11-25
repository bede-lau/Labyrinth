// @vitest-environment node
// The control loop run headless on the five-target heated scenario of the plasma explorer: let every diverter
// overheat with the coils off, switch the loop on, and watch 60 s of model time.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fiveTargetScenario, startupSimulation } from '../geometry/heatedEdge';
import { LoopController } from './loopPolicy';
import type { Simulation } from './sim';

const HORIZON_S = 0.25; // PlasmaExplorer's look-ahead and decision interval
const SAMPLE_S = 0.5;

function scenario() {
  const saved = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8'));
  return startupSimulation(fiveTargetScenario(saved));
}

const peaks = (sim: Simulation) => Array.from(sim.coils, (_, k) => sim.peakTileC(k));

/** Coils off until every diverter is over the tile limit. Returns the model time that took. */
function overheat(sim: Simulation): number {
  const { dt, tileLimit } = sim.model.params;
  while (!peaks(sim).every((t) => t > tileLimit)) {
    if (sim.time > 120) throw new Error('the scenario never overheats every diverter');
    sim.advance(Math.round(SAMPLE_S / dt));
  }
  return sim.time;
}

export interface LoopRun {
  flips: number;
  switchEvents: number;
  samples: number[];
  over: number;
  maxC: number;
  probes: number;
  finalCoils: number[];
}

/**
 * Run the loop `seconds` of model time. Samples are the hottest tile every SAMPLE_S, the first one SAMPLE_S after the start.
 * `decideEvery` is the decision interval in solver steps: by default exactly the horizon (250). The live app decides on
 * the first animation frame at or after the horizon, so at 1x (17 steps a frame at dt = 1 ms) every 255 steps.
 */
export function runLoop(sim: Simulation, seconds: number, decideEvery = Math.round(HORIZON_S / sim.model.params.dt)): LoopRun {
  const { dt, tileLimit } = sim.model.params;
  const controller = new LoopController(sim, HORIZON_S);
  const sampleEvery = Math.round(SAMPLE_S / dt);
  const total = Math.round(seconds / dt);
  const start = sim.state.n;
  let flips = 0, switchEvents = 0, probes = 0;
  const samples: number[] = [];
  for (let s = 0; s < total; s++) {
    if (s % decideEvery === 0) {
      const outcome = controller.decide();
      const changed = controller.apply(outcome);
      flips += changed;
      switchEvents += changed ? 1 : 0;
      probes += outcome.probed ? 1 : 0;
    }
    sim.advance(1);
    if ((sim.state.n - start) % sampleEvery === 0) samples.push(Math.max(...peaks(sim)));
  }
  const over = samples.filter((t) => t > tileLimit).length;
  return { flips, switchEvents, samples, over, maxC: Math.max(...samples), probes, finalCoils: [...sim.commandedCoils] };
}

test('all five diverters overheating, then the loop on: only the settling sample is over the tile limit, and no coil flips back', () => {
  const sim = scenario();
  const at = overheat(sim);
  expect(at).toBeGreaterThan(0);
  const { tileLimit } = sim.model.params;
  expect(peaks(sim).every((t) => t > tileLimit)).toBe(true);
  const run = runLoop(sim, 60);
  // LOOP_REPORT=<file> saves the numbers (the test runner hides console output).
  if (process.env.LOOP_REPORT) {
    writeFileSync(process.env.LOOP_REPORT, JSON.stringify({ overheatedAtS: at, ...run, samples: undefined, first: run.samples.slice(0, 6), maxAfterSettleC: Math.max(...run.samples.slice(2)) }, null, 1));
  }
  expect(run.samples).toHaveLength(120);
  // The tiles start above the limit, and the coils take sim.responseSeconds (0.35 s) to ramp in: the sample
  // 0.5 s after switching on is the only one that can still read over the limit. From 1 s on, none does.
  expect(run.samples.slice(2).every((t) => t <= tileLimit)).toBe(true);
  expect(run.over).toBeLessThanOrEqual(1);
  // Five coils switch on, once, and none switches off again while the heating persists.
  expect(run.switchEvents).toBe(1);
  expect(run.flips).toBe(5);
  expect(run.probes).toBeGreaterThan(0); // it did look for a chance to release, and the look-ahead refused
  expect(run.finalCoils).toEqual([1, 1, 1, 1, 1]);
}, 120_000);

test('loop on from the cold start of the five-target scenario: the tiles never pass the limit', () => {
  const sim = scenario();
  const run = runLoop(sim, 60);
  if (process.env.LOOP_REPORT) writeFileSync(process.env.LOOP_REPORT + '.cold', JSON.stringify({ ...run, samples: undefined }, null, 1));
  expect(run.over).toBe(0);
  expect(run.switchEvents).toBe(1);
}, 120_000);

test.each([255, 272])('at a live decision cadence (every %i steps: 1x and 4x frames of 17 steps) the tiles never pass the limit', (every) => {
  // The live app decides on the first animation frame at or after the horizon: every 255 steps at 1x, not 250.
  // Before the guard look-ahead covered the coil response (review 2026-11-24, finding 1), this run caught the
  // overheat one decision late and one sample read ~1207 deg C.
  const sim = scenario();
  const run = runLoop(sim, 60, every);
  if (process.env.LOOP_REPORT) writeFileSync(`${process.env.LOOP_REPORT}.live${every}`, JSON.stringify({ ...run, samples: undefined }, null, 1));
  expect(run.over).toBe(0);
  expect(run.switchEvents).toBe(1);
}, 120_000);
