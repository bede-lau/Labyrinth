// The real ControlLoop component driven the way the app drives it: the model advances a frame's worth of steps, the
// loop reacts to the simulation's change notification. No worker: the frame-paced path the Heat & field view uses,
// and the fallback of the W7-X view. Reviews 2026-11-24 (findings 1-3) and 2026-11-25 (findings 1, 2, 5, 6, 7).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render } from '@testing-library/react';
import { ControlLoop, INCREMENTAL_CHUNK, INCREMENTAL_RATE, type LoopDecision } from './ControlLoop';
import { fiveTargetScenario, startupSimulation } from '../geometry/heatedEdge';
import { DEFAULT_LOOP_CONFIG, decideLoop, type LoopOutcome, type LoopRequest } from './loopPolicy';
import { createModel, modelFor, spunUpState, type HeatModel } from './model';
import { Simulation } from './sim';
import type { HeatfieldArtifact } from './types';

const saved = (): HeatfieldArtifact => JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8'));

/**
 * Count the forecast steps the loop runs: every model.advance call except the playback's own. Simulation.advance
 * calls model.advance once and then notifies its listeners (where the loop runs), so only that first call is playback.
 */
function meter(model: HeatModel) {
  const original = model.advance.bind(model);
  let forecast = 0;
  let playback = false;
  (model as { advance: HeatModel['advance'] }).advance = (st, coils, steps, at) => {
    if (playback) playback = false;
    else forecast += steps;
    return original(st, coils, steps, at);
  };
  return {
    take: () => { const f = forecast; forecast = 0; return f; },
    playing: <T,>(fn: () => T) => { playback = true; try { return fn(); } finally { playback = false; } },
  };
}

interface Frame { n: number; coils: readonly number[] }

/** Run the loop on `sim` for `seconds` of model time at `stepsPerFrame`; `each` runs after every frame. */
function drive(sim: Simulation, stepsPerFrame: number, seconds: number, each?: (frame: number) => void) {
  const work = meter(sim.model);
  const decisions: LoopDecision[] = [];
  // Stable callbacks, as the app passes them: a new onDecision each render would restart the loop's effect.
  const onDecision = (d: LoopDecision) => { decisions.push(d); };
  const play = () => {};
  const view = render(<ControlLoop onDecision={onDecision} sim={sim} horizonS={0.25} playing play={play} />);
  act(() => { fireEvent.click(view.getByRole('switch')); });
  work.take();
  let hottest = -Infinity, worstFrame = 0;
  const frames: Frame[] = [];
  const count = Math.round(seconds / (stepsPerFrame * sim.model.params.dt));
  for (let f = 0; f < count; f++) {
    act(() => { work.playing(() => sim.advance(stepsPerFrame)); });
    act(() => each?.(f));
    worstFrame = Math.max(worstFrame, work.take());
    for (let k = 0; k < sim.coils.length; k++) hottest = Math.max(hottest, sim.peakTileC(k));
    frames.push({ n: sim.state.n, coils: [...sim.commandedCoils] });
  }
  view.unmount();
  // A frame's forecast work: the rate, plus less than two chunks of overrun (one next() may end one forecast and
  // start the next).
  const budget = stepsPerFrame * INCREMENTAL_RATE + 2 * INCREMENTAL_CHUNK;
  return { hottest, worstFrame, budget, decisions, frames };
}

test.each([17, 68])('heated five-target scenario at %i steps a frame (1x, 4x): no tile passes the limit, no frame over budget', (stepsPerFrame) => {
  const sim = startupSimulation(fiveTargetScenario(saved()));
  const run = drive(sim, stepsPerFrame, 60);
  if (process.env.LOOP_REPORT) {
    writeFileSync(`${process.env.LOOP_REPORT}.component${stepsPerFrame}`,
      JSON.stringify({ hottest: run.hottest, worstFrame: run.worstFrame, budget: run.budget, decisions: run.decisions.length }));
  }
  // Switch-on early enough for the coils to ramp in before a tile crosses the limit.
  expect(run.hottest).toBeLessThanOrEqual(sim.model.params.tileLimit);
  // No frame runs a long forecast (a release look-ahead alone is 3,000 steps), and the loop did forecast.
  expect(run.worstFrame).toBeLessThanOrEqual(run.budget);
  expect(run.worstFrame).toBeGreaterThan(0);
  // Provisional switch-ons are not logged as decisions: about one per 250-step interval.
  expect(run.decisions.length).toBeLessThanOrEqual(Math.ceil(60 / 0.25) + 2);
  expect(run.decisions.length).toBeGreaterThan(100);
  expect(sim.commandedCoils.some(Boolean)).toBe(true);
}, 300_000);

/** A model whose edge heating has gone away: with the coils on, everything is cool, and the coils may go off. */
function coolingDown(responseS: number) {
  const art = saved();
  const coolDrive = new Float64Array(art.grid.nTheta * art.grid.nPhi).fill(0.3); // 30 % of the nominal heating power
  const model = createModel(art, () => coolDrive);
  const sim = new Simulation(model, model.initialState(), responseS);
  sim.advance(4000);
  sim.setCoils(Array.from({ length: model.nDiverters }, () => 1));
  return sim;
}

// 0.35 s is the coil response of the W7-X view: guard forecasts then run 650 steps and compete with the release
// look-ahead for each frame's budget (review 2026-11-25b, finding 1).
test.each([0, 0.35])('a release goes through the frame-paced path (coil response %s s): the coils go off after the minimum on-time, while its look-ahead is valid', (responseS) => {
  const sim = coolingDown(responseS);
  const switchedOnAt = sim.state.n;
  const { dt } = sim.model.params;
  const run = drive(sim, 17, DEFAULT_LOOP_CONFIG.minOnS + 4);
  const off = run.frames.find((f) => f.coils.every((c) => !c));
  expect(off).toBeDefined();
  // Not before the minimum on-time (counted from the loop's start, the coils were on already)...
  expect(off!.n - switchedOnAt).toBeGreaterThanOrEqual(Math.round(DEFAULT_LOOP_CONFIG.minOnS / dt));
  // ...and well inside one release look-ahead of becoming eligible: a probe that finished after its look-ahead had
  // run out would land later than this.
  expect(off!.n - switchedOnAt).toBeLessThan(Math.round((DEFAULT_LOOP_CONFIG.minOnS + DEFAULT_LOOP_CONFIG.releaseHorizonS) / dt));
  expect(run.worstFrame).toBeLessThanOrEqual(run.budget);
}, 300_000);

/** A stand-in for the forecast worker: requests queue up until `answer()` runs them (decideLoop, as the worker does). */
class FakeWorker {
  onmessage: ((e: MessageEvent<LoopOutcome>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly requests: LoopRequest[] = [];
  private queue: LoopRequest[] = [];
  constructor(private readonly model: HeatModel) {}
  postMessage(data: { request?: LoopRequest }) {
    if (data.request) { this.requests.push(data.request); this.queue.push(data.request); }
  }
  answer() {
    const queued = this.queue.splice(0);
    for (const r of queued) this.onmessage?.({ data: decideLoop(this.model, r) } as MessageEvent<LoopOutcome>);
  }
  terminated = false;
  terminate() { this.queue = []; this.terminated = true; }
}

/**
 * The worker path with the full decision held (a release look-ahead still running) for the whole run. `workers`
 * is how many workers openPredictor will hand out; the guard worker answers at the end of every frame.
 */
function heldFullDecision(workers: number) {
  vi.stubGlobal('Worker', FakeWorker);
  try {
    const sim = startupSimulation(fiveTargetScenario(saved()));
    const opened: FakeWorker[] = [];
    const openPredictor = () => {
      if (opened.length >= workers) throw new Error('no more workers');
      const w = new FakeWorker(sim.model);
      opened.push(w);
      return w as unknown as Worker;
    };
    const view = render(<ControlLoop sim={sim} horizonS={0.25} playing play={() => {}} openPredictor={openPredictor} />);
    act(() => { fireEvent.click(view.getByRole('switch')); });
    let hottest = -Infinity;
    for (let f = 0; f < Math.round(20 / (17 * sim.model.params.dt)); f++) {
      act(() => { sim.advance(17); });
      act(() => { opened[1]?.answer(); });
      for (let k = 0; k < sim.coils.length; k++) hottest = Math.max(hottest, sim.peakTileC(k));
    }
    view.unmount();
    return { hottest, limit: sim.model.params.tileLimit, full: opened[0]!, guard: opened[1] };
  } finally {
    vi.unstubAllGlobals();
  }
}

test('worker path: while the full decision is still running, a guard worker decides, without a probe, and keeps the tiles below the limit', () => {
  const run = heldFullDecision(2);
  expect(run.full.requests).toHaveLength(1); // the held one: never answered
  expect(run.guard!.requests.length).toBeGreaterThan(50);
  expect(run.guard!.requests.every((r) => r.allowProbe === false)).toBe(true);
  expect(run.hottest).toBeLessThanOrEqual(run.limit);
}, 300_000);

test('worker path without a second worker: nothing decides while the full decision runs (why the guard worker exists)', () => {
  const run = heldFullDecision(1);
  expect(run.guard).toBeUndefined();
  expect(run.hottest).toBeGreaterThan(run.limit);
}, 300_000);

/** The loop on the worker path with two fake workers that answer only when told to (review 2026-11-25b, finding 2). */
function withWorkers<T>(sim: Simulation, body: (w: { full: FakeWorker; guard: FakeWorker; decisions: LoopDecision[] }) => T): T {
  vi.stubGlobal('Worker', FakeWorker);
  const opened: FakeWorker[] = [];
  const decisions: LoopDecision[] = [];
  const onDecision = (d: LoopDecision) => { decisions.push(d); };
  const openPredictor = () => { const w = new FakeWorker(sim.model); opened.push(w); return w as unknown as Worker; };
  const view = render(<ControlLoop sim={sim} horizonS={0.25} playing play={() => {}} openPredictor={openPredictor} onDecision={onDecision} />);
  try {
    act(() => { fireEvent.click(view.getByRole('switch')); });
    expect(opened).toHaveLength(2);
    return body({ full: opened[0]!, guard: opened[1]!, decisions });
  } finally {
    view.unmount();
    vi.unstubAllGlobals();
  }
}

test('worker path: a full answer about controls no longer in force is dropped and asked again, once', () => {
  // Unheated model with every coil on: the full decision keeps them all on. Applied after D1 was switched off by
  // hand, that answer would switch D1 back on.
  const model = modelFor(saved());
  const sim = new Simulation(model, spunUpState(model), 0);
  sim.setCoils(Array.from({ length: model.nDiverters }, () => 1));
  withWorkers(sim, ({ full }) => {
    expect(full.requests).toHaveLength(1);
    act(() => { sim.setCoil(0, false); });
    act(() => { full.answer(); });
    expect(sim.commandedCoils[0]).toBe(0);
    expect(full.requests).toHaveLength(2);
    expect(full.requests[1]!.target.coils[0]).toBe(0); // asked about the controls now in force
  });
});

test.each(['error', 'late answer'])('worker path: a worker %s switches the loop to the frame-paced path, which then decides', (failure) => {
  const sim = startupSimulation(fiveTargetScenario(saved()));
  withWorkers(sim, ({ full, guard, decisions }) => {
    if (failure === 'error') act(() => { full.onerror?.(); });
    else {
      act(() => { sim.advance(Math.round(1 / sim.model.params.dt) + 100); }); // past the 1 s tolerance
      act(() => { full.answer(); });
    }
    expect(full.terminated && guard.terminated).toBe(true);
    const asked = full.requests.length + guard.requests.length;
    const before = decisions.length;
    for (let f = 0; f < 60; f++) act(() => { sim.advance(17); });
    expect(full.requests.length + guard.requests.length).toBe(asked);
    expect(decisions.length).toBeGreaterThan(before);
  });
}, 120_000);

test('a coil switched by hand while a decision runs is not reverted when that decision ends', () => {
  // Unheated model: the tiles idle at ~1080-1290 deg C with every coil off, so a release probe is refused and its
  // outcome keeps every coil on. Applied after D1 was switched off by hand, that stale outcome would turn D1 back on.
  const model = modelFor(saved());
  const sim = new Simulation(model, spunUpState(model), 0);
  sim.setCoils(Array.from({ length: model.nDiverters }, () => 1));
  const { dt, tileLimit } = model.params;
  // Just past the minimum on-time the release probe (3,000+ steps, ~70 frames) is running: switch D1 off mid-probe.
  const handFrame = Math.round((DEFAULT_LOOP_CONFIG.minOnS + 0.1) / (17 * dt));
  let handTime = -1;
  // 4 s after the hand switch: D1's tile (CFC plus heat sink: ~0.5–1 s to respond) climbs back towards the limit within that time.
  const run = drive(sim, 17, DEFAULT_LOOP_CONFIG.minOnS + 4, (f) => {
    if (f === handFrame) {
      sim.setCoil(0, false);
      handTime = sim.time;
    }
  });
  expect(handTime).toBeGreaterThan(0);
  // After the hand switch, the first decision that switches D1 on again does so because a diverter is forecast hot
  // (later ones may keep it on by hysteresis). A stale outcome applied after the switch would do it without that.
  const after = run.decisions.filter((d) => d.time >= handTime && d.coils[0] === 1);
  expect(after.length).toBeGreaterThan(0); // the tiles heat with D1 off, so the loop does switch it on again
  expect(after[0]!.peakTileC.some((p) => p > tileLimit)).toBe(true);
}, 300_000);
