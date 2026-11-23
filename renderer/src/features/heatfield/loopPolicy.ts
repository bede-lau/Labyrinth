// The control loop's decision, as one pure function of a snapshot of the running model. The React component, the
// forecast worker and the headless run all call it, so they cannot disagree.
//
// What it does, every decision (see ControlLoop.tsx for the cadence):
//  1. Forecast the tiles a short horizon ahead with the controls the model has NOW (each coil in its present state,
//     the cross-fade in progress, the heat transfers in force) -- not with every coil off. A diverter that is cool
//     only because its coil is on therefore stays cool in the forecast, and its coil is not switched off.
//  2. If any diverter is predicted above the tile limit, every coil is switched on and stays on. Coils that are
//     already on in a hot diverter are never touched.
//  3. A coil that is on goes off only after a minimum on-time, and only if a longer look-ahead with it off keeps
//     every tile below the release temperature (hysteresis: on above the limit, off below ~1000 deg C).
//     Probing costs a few seconds of model time, so it is not repeated more often than `probeRetryS`.
//  4. A heat transfer is adopted only if its forecast lowers the maximum predicted tile temperature by at least
//     `transferMarginC`; otherwise the transfers in force are left alone. There is no hold: with this test a
//     transfer cannot be replaced by one that is no better, so nothing needs holding in place to stop flutter.
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
}

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  releaseMarginC: 200, // release below 1000 deg C for the 1200 deg C tile limit
  minOnS: 5,
  releaseHorizonS: 3,
  probeRetryS: 5,
  transferMarginC: 2,
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
}

export interface LoopOutcome {
  coils: number[];
  transfers: HeatTransfer[];
  /** Peak tile temperature of each diverter over the horizon with the controls the model had when asked (deg C). */
  peakTileC: number[];
  nextProbe: number;
  /** Whether a release look-ahead was run (it is the costly part of a decision). */
  probed: boolean;
}

/** Steps advanced between yields; the work between two yields is what a frame-paced caller budgets. */
export const FORECAST_CHUNK = 50;

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

function* forecastMax(model: HeatModel, from: ModelState, plan: Plan, steps: number): Generator<void, Forecast> {
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
    const chunk = Math.min(FORECAST_CHUNK, steps - done);
    st = model.advance(st, plan.coils, chunk, plan.transfers, plan.ramp);
    done += chunk;
    note(st, peaks);
    note(st, ahead);
    if (done < steps) yield;
  }
  return { max: peaks, ahead };
}

const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const sameRoutes = (a: readonly HeatTransfer[], b: readonly HeatTransfer[]) =>
  a.length === b.length && a.every((r, i) => r.from === b[i]!.from && r.to === b[i]!.to && r.fraction === b[i]!.fraction);

/** The decision. A generator so a caller can spread the forecasting over frames; run it out with `decideLoop`. */
export function* decideSteps(model: HeatModel, req: LoopRequest): Generator<void, LoopOutcome> {
  const { state, target, memory, config, horizonSteps } = req;
  const { dt, tileLimit: limit, Tcool } = model.params;
  const releaseC = limit - config.releaseMarginC;
  const secondsToSteps = (s: number) => Math.max(1, Math.round(s / dt));

  const keep: Plan = req.ramp
    ? { coils: target.coils, transfers: target.transfers, ramp: controlRamp(req.ramp.start, req.ramp.end, req.ramp.first, req.ramp.steps) }
    : { coils: target.coils, transfers: target.transfers };
  // "Command these now": cross-fade from what is applied now, as Simulation.setCoils would.
  const command = (coils: readonly number[], transfers: readonly HeatTransfer[]): Plan =>
    req.responseSteps > 0
      ? { coils, transfers, ramp: controlRamp(req.applied, { coils, transfers }, state.n, req.responseSteps) }
      : { coils, transfers };

  // 1. Forecast with the controls in force.
  const base = yield* forecastMax(model, state, keep, horizonSteps);
  const peaks = base.max;
  const anyHot = peaks.some((p) => p > limit);
  const coils = target.coils.map(Number);
  let transfers: readonly HeatTransfer[] = target.transfers;
  let nextProbe = memory.nextProbe;
  let probed = false;

  if (anyHot) {
    // 2. Every coil on while any diverter is predicted hot.
    coils.fill(1);
    // 4. A transfer only if it provably helps. Compare like with like: same coils, with and without the new routes.
    if (req.balanceHeat) {
      const candidate = balanceTargets(peaks, limit, Tcool, true);
      if (candidate.length && !sameRoutes(candidate, transfers)) {
        const without = same(coils, target.coils) ? base : yield* forecastMax(model, state, command(coils, transfers), horizonSteps);
        const withRoutes = yield* forecastMax(model, state, command(coils, candidate), horizonSteps);
        // Judged on the temperatures after the start: the start itself is the same either way.
        if (Math.max(...withRoutes.ahead) < Math.max(...without.ahead) - config.transferMarginC) transfers = candidate;
      }
    }
  } else if (state.n >= memory.nextProbe) {
    // 3. Which coils have been on long enough, and are cool, so that they may go off?
    const minOn = secondsToSteps(config.minOnS);
    const ready = coils.map((on, k) => on === 1 && memory.onSince[k]! >= 0 && state.n - memory.onSince[k]! >= minOn && peaks[k]! < releaseC);
    if (ready.some(Boolean)) {
      const candidate = coils.map((on, k) => (ready[k] ? 0 : on));
      const result = yield* forecastMax(model, state, command(candidate, []), secondsToSteps(config.releaseHorizonS));
      probed = true;
      if (result.max.every((p) => p < releaseC)) {
        candidate.forEach((on, k) => { coils[k] = on; });
        transfers = [];
      } else {
        nextProbe = state.n + secondsToSteps(config.probeRetryS);
      }
    }
  }
  // Transfers have nothing to carry once no coil is on.
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

  request(): LoopRequest {
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
