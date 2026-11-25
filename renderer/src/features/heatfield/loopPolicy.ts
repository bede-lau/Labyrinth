// The control loop's decision, as one pure function of a snapshot of the running model. The React component, the
// forecast worker and the headless run all call it, so they cannot disagree.
//
// What it does, every decision (see ControlLoop.tsx for the cadence):
//  1. Forecast the tiles ahead with the controls the model has NOW (each coil in its present state, the cross-fade
//     in progress, the heat transfers in force) -- not with every coil off. A diverter that is cool only because its
//     coil is on therefore stays cool in the forecast, and its coil is not switched off.
//     The guard look-ahead is the decision interval PLUS the coil response time PLUS `guardSlackS`: a coil commanded
//     now is fully in only `responseSteps` later, and the next decision may come up to one frame after the horizon.
//     A crossing seen only inside the plain horizon could no longer be prevented (review 2026-11-24, finding 1).
//     Peaks are sampled every FORECAST_SAMPLE steps of a forecast (and at its end), not every step.
//  2. If any diverter is predicted above the tile limit, every coil is switched on and stays on. Coils that are
//     already on in a hot diverter are never touched. This is yielded as soon as it is known, before any transfer
//     is weighed, so a caller running the decision over several frames can switch the coils on at once.
//  3. A coil that is on goes off only after a minimum on-time, and only if a longer look-ahead with it off keeps
//     EVERY tile below the release temperature (hysteresis: on above the limit, off below ~1000 deg C). Release is
//     all-or-nothing by design: one diverter still between the release temperature and the limit keeps every
//     ready coil on. Probing costs a few seconds of model time, so it is not repeated more often than `probeRetryS`,
//     and a request may forbid it (`allowProbe: false`) for a quick guard-only decision.
//  4. A heat transfer is adopted only if its forecast lowers the maximum predicted tile temperature by at least
//     `transferMarginC`; otherwise the transfers in force are left alone. There is no hold: with this test a
//     transfer cannot be replaced by one that is no better, so nothing needs holding in place to stop flutter.
//     Transfers are weighed only while a diverter is predicted hot, and dropped once every coil is off: a policy
//     choice (the model itself would move load without coils), and the reason transfers are rare.
import { controlRamp, type AppliedControls, type RampSpec } from './controlRamp';
import { balanceTargets, type HeatTransfer } from './loadBalance';
import type { HeatModel, ModelState } from './model';
import type { Simulation } from './sim';

export interface LoopConfig {
  /** A coil may go off only if every tile stays this far below the limit (deg C) in the release look-ahead. */
  releaseMarginC: number;
  /** A coil, once on, stays on at least this long (s of model time). */
  minOnS: number;
  /** Length of the look-ahead that decides whether a coil may go off (s). */
  releaseHorizonS: number;
  /** Shortest interval between release look-aheads (s). */
  probeRetryS: number;
  /** A transfer must lower the predicted maximum by at least this much (deg C). */
  transferMarginC: number;
  /** Extra guard look-ahead beyond horizon + coil response, for a decision that lands a frame late (s). */
  guardSlackS: number;
}

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  releaseMarginC: 200, // release below 1000 deg C for the 1200 deg C tile limit
  minOnS: 5,
  releaseHorizonS: 3,
  probeRetryS: 5,
  transferMarginC: 2,
  guardSlackS: 0.05,
};

/** What the loop remembers between decisions: when each coil was switched on, and when it may next try a release. */
export interface LoopMemory {
  /** Solver step at which coil k was switched on, or -1 while it is off. */
  onSince: number[];
  /** No release look-ahead before this step. */
  nextProbe: number;
}

/** Everything a decision reads: plain data, so it can be posted to a worker. */
export interface LoopRequest {
  state: ModelState;
  applied: AppliedControls;
  target: AppliedControls;
  ramp?: RampSpec;
  responseSteps: number;
  horizonSteps: number;
  memory: LoopMemory;
  balanceHeat: boolean;
  config: LoopConfig;
  /** false: never run a release look-ahead in this decision (a quick guard check). Default true. */
  allowProbe?: boolean;
}

export interface LoopOutcome {
  coils: number[];
  transfers: HeatTransfer[];
  /**
   * Peak tile temperature of each diverter over the guard look-ahead with the controls the model had when asked
   * (deg C), sampled every FORECAST_SAMPLE steps.
   */
  peakTileC: number[];
  nextProbe: number;
  /** Whether a release look-ahead was run (it is the costly part of a decision). */
  probed: boolean;
  /** Set on an outcome yielded before the decision ended ("all coils on"): safe to apply, not the decision itself. */
  provisional?: true;
}

/** Peaks are noted every this many forecast steps. Fixed, so the decision does not depend on how work is chunked. */
export const FORECAST_SAMPLE = 50;
/** Default steps advanced between yields; the work between two yields is what a frame-paced caller budgets. */
export const FORECAST_CHUNK = 50;

/**
 * What a decision yields while it runs: the forecast steps it has advanced so far (a number, for a caller that budgets
 * real work), or a provisional outcome to apply now.
 */
export type LoopProgress = LoopOutcome | number;

interface Plan {
  coils: readonly number[];
  transfers: readonly HeatTransfer[];
  ramp?: (step: number) => AppliedControls;
}

/** Per-diverter peak tile temperature over a forecast: with the starting state, and after it (what a control can change). */
interface Forecast {
  max: number[];
  ahead: number[];
}

interface Work {
  /** Forecast steps advanced so far in this decision. */
  steps: number;
}

/**
 * `onSample` is called with the peaks so far at every sample; an outcome it returns is yielded at once (the early
 * switch-on: a crossing near the start of the look-ahead must not wait for the whole forecast to be computed).
 */
function* forecastMax(model: HeatModel, from: ModelState, plan: Plan, steps: number, chunk: number, work: Work,
  onSample?: (peaks: readonly number[]) => LoopOutcome | undefined): Generator<LoopProgress, Forecast> {
  const { nDiverters: nDiv, nTheta } = model;
  const peaks = Array<number>(nDiv).fill(-Infinity);
  const ahead = Array<number>(nDiv).fill(-Infinity);
  const note = (st: ModelState, into: number[]) => {
    for (let k = 0; k < nDiv; k++) {
      for (let i = 0; i < nTheta; i++) into[k] = Math.max(into[k]!, st.tiles[k * nTheta + i]!);
    }
  };
  let st = from;
  note(st, peaks);
  for (let done = 0; done < steps;) {
    // Never cross a sample boundary inside one piece: the peaks are the same however the work is chunked.
    const toSample = FORECAST_SAMPLE - (done % FORECAST_SAMPLE);
    const piece = Math.min(chunk, toSample, steps - done);
    st = model.advance(st, plan.coils, piece, plan.transfers, plan.ramp);
    done += piece;
    work.steps += piece;
    if (done % FORECAST_SAMPLE === 0 || done === steps) {
      note(st, peaks);
      note(st, ahead);
      const early = onSample?.(peaks);
      if (early) yield early;
    }
    if (done < steps) yield work.steps;
  }
  return { max: peaks, ahead };
}

const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const sameRoutes = (a: readonly HeatTransfer[], b: readonly HeatTransfer[]) =>
  a.length === b.length && a.every((r, i) => r.from === b[i]!.from && r.to === b[i]!.to && r.fraction === b[i]!.fraction);

/** Steps the guard forecast looks ahead: the decision interval, the coil response, and a frame of slack. */
export function guardSteps(model: HeatModel, req: Pick<LoopRequest, 'horizonSteps' | 'responseSteps' | 'config'>): number {
  return req.horizonSteps + req.responseSteps + Math.max(0, Math.round(req.config.guardSlackS / model.params.dt));
}

/**
 * The decision. A generator so a caller can spread the forecasting over frames (`chunk` steps of model work between
 * yields); run it out with `decideLoop`. A yielded number is progress (forecast steps so far). A yielded outcome is
 * provisional and safe to apply at once: every coil on, at the first sample of the guard forecast that is over the
 * limit. The returned outcome is final.
 */
export function* decideSteps(model: HeatModel, req: LoopRequest, chunk = FORECAST_CHUNK): Generator<LoopProgress, LoopOutcome> {
  const { state, target, memory, config } = req;
  const { dt, tileLimit: limit, Tcool } = model.params;
  const releaseC = limit - config.releaseMarginC;
  const secondsToSteps = (s: number) => Math.max(1, Math.round(s / dt));
  const horizonSteps = guardSteps(model, req);
  const step = Math.max(1, Math.round(chunk));

  const keep: Plan = req.ramp
    ? { coils: target.coils, transfers: target.transfers, ramp: controlRamp(req.ramp.start, req.ramp.end, req.ramp.first, req.ramp.steps) }
    : { coils: target.coils, transfers: target.transfers };
  // "Command these now": cross-fade from what is applied now, as Simulation.setCoils would.
  const command = (coils: readonly number[], transfers: readonly HeatTransfer[]): Plan =>
    req.responseSteps > 0
      ? { coils, transfers, ramp: controlRamp(req.applied, { coils, transfers }, state.n, req.responseSteps) }
      : { coils, transfers };

  const work: Work = { steps: 0 };
  const allOn = target.coils.map(() => 1);
  let switchedEarly = same(allOn, target.coils); // nothing to switch on
  // 2, early: the moment a sample of the guard forecast is over the limit, every coil on (see the header).
  const earlySwitch = (sampled: readonly number[]): LoopOutcome | undefined => {
    if (switchedEarly || !sampled.some((p) => p > limit)) return undefined;
    switchedEarly = true;
    return { coils: [...allOn], transfers: [...target.transfers], peakTileC: [...sampled], nextProbe: memory.nextProbe, probed: false, provisional: true };
  };

  // 1. Forecast with the controls in force.
  const base = yield* forecastMax(model, state, keep, horizonSteps, step, work, earlySwitch);
  const peaks = base.max;
  const anyHot = peaks.some((p) => p > limit);
  const coils = target.coils.map(Number);
  let transfers: readonly HeatTransfer[] = target.transfers;
  let nextProbe = memory.nextProbe;
  let probed = false;

  if (anyHot) {
    // 2. Every coil on while any diverter is predicted hot (already yielded provisionally by earlySwitch).
    coils.fill(1);
    // 4. A transfer only if it provably helps. Compare like with like: same coils, with and without the new routes.
    if (req.balanceHeat) {
      const candidate = balanceTargets(peaks, limit, Tcool, true);
      if (candidate.length && !sameRoutes(candidate, transfers)) {
        const without = same(coils, target.coils) ? base : yield* forecastMax(model, state, command(coils, transfers), horizonSteps, step, work);
        const withRoutes = yield* forecastMax(model, state, command(coils, candidate), horizonSteps, step, work);
        // Judged on the temperatures after the start: the start itself is the same either way.
        if (Math.max(...withRoutes.ahead) < Math.max(...without.ahead) - config.transferMarginC) transfers = candidate;
      }
    }
  } else if (req.allowProbe !== false && state.n >= memory.nextProbe) {
    // 3. Which coils have been on long enough, and are cool, so that they may go off?
    const minOn = secondsToSteps(config.minOnS);
    const ready = coils.map((on, k) => on === 1 && memory.onSince[k]! >= 0 && state.n - memory.onSince[k]! >= minOn && peaks[k]! < releaseC);
    if (ready.some(Boolean)) {
      const candidate = coils.map((on, k) => (ready[k] ? 0 : on));
      const result = yield* forecastMax(model, state, command(candidate, []), secondsToSteps(config.releaseHorizonS), step, work);
      probed = true;
      if (result.max.every((p) => p < releaseC)) {
        candidate.forEach((on, k) => { coils[k] = on; });
        transfers = [];
      } else {
        nextProbe = state.n + secondsToSteps(config.probeRetryS);
      }
    }
  }
  // Policy: no transfers while no coil is on (see 4. in the header).
  if (!coils.some(Boolean)) transfers = [];
  return { coils, transfers: [...transfers], peakTileC: peaks, nextProbe, probed };
}

/** Run a decision to the end in one go (worker, synchronous fallback, headless runs). */
export function decideLoop(model: HeatModel, req: LoopRequest): LoopOutcome {
  const run = decideSteps(model, req);
  for (;;) {
    const r = run.next();
    if (r.done) return r.value;
  }
}

/** Per-simulation bookkeeping around `decideSteps`: builds requests from the live model and applies outcomes. */
export class LoopController {
  memory: LoopMemory;
  constructor(
    readonly sim: Simulation,
    readonly horizonS: number,
    readonly balanceHeat: boolean,
    readonly config: LoopConfig = DEFAULT_LOOP_CONFIG,
  ) {
    this.memory = this.fresh();
  }

  /** Forget everything: a coil already on counts as switched on now, so a minimum on-time starts counting. */
  fresh(): LoopMemory {
    const n = this.sim.state.n;
    return { onSince: this.sim.commandedCoils.map((on) => (on ? n : -1)), nextProbe: n };
  }

  reset(): void {
    this.memory = this.fresh();
  }

  get horizonSteps(): number {
    return Math.max(1, Math.round(this.horizonS / this.sim.model.params.dt));
  }

  request(allowProbe = true): LoopRequest {
    const { sim } = this;
    // Coils may have been switched by hand since the last decision: a coil found on counts as on from now.
    sim.commandedCoils.forEach((on, k) => {
      if (!on) this.memory.onSince[k] = -1;
      else if (this.memory.onSince[k]! < 0) this.memory.onSince[k] = sim.state.n;
    });
    return {
      state: sim.state,
      applied: sim.appliedControls,
      target: sim.commandedControls,
      ramp: sim.ongoingRamp,
      responseSteps: sim.responseSteps,
      horizonSteps: this.horizonSteps,
      memory: this.memory,
      balanceHeat: this.balanceHeat,
      config: this.config,
      allowProbe,
    };
  }

  /** Decide synchronously from the model as it is now. */
  decide(): LoopOutcome {
    return decideLoop(this.sim.model, this.request());
  }

  /** Command the outcome and remember it. Returns how many coils changed state. */
  apply(outcome: LoopOutcome): number {
    const { sim, memory } = this;
    const before = sim.commandedCoils;
    let flips = 0;
    outcome.coils.forEach((on, k) => {
      if (Boolean(on) !== Boolean(before[k])) flips++;
      memory.onSince[k] = on ? (before[k] && memory.onSince[k]! >= 0 ? memory.onSince[k]! : sim.state.n) : -1;
    });
    memory.nextProbe = Math.max(memory.nextProbe, outcome.nextProbe);
    if (this.balanceHeat || flips) sim.setCoils(outcome.coils, outcome.transfers);
    return flips;
  }
}
