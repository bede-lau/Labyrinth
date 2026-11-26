import { useEffect, useRef, useState } from 'react';
import type { AppliedControls } from './controlRamp';
import { decideSteps, LoopController, type LoopOutcome, type LoopProgress } from './loopPolicy';
import type { Simulation } from './sim';

/** Model steps a frame-paced decision advances between checks of its budget. */
export const INCREMENTAL_CHUNK = 10;
/**
 * Forecast steps a frame may spend per model step the frame advanced. A guard decision forecasts about 2.5 decision
 * intervals ahead (interval + coil response + slack), so less than that would fall behind the decision cadence.
 */
export const INCREMENTAL_RATE = 3;
/** The most of a frame's forecast budget a guard decision may take while a full decision is also running. */
export const GUARD_SHARE = 2 / 3;

const sameControls = (a: AppliedControls, b: AppliedControls) =>
  a.coils.length === b.coils.length && a.coils.every((v, i) => Boolean(v) === Boolean(b.coils[i]));

export interface LoopDecision {
  time: number;
  peakTileC: number[];
  coils: readonly number[];
  drive: Float32Array<ArrayBuffer>;
}

interface ControlLoopProps {
  disabled?: boolean;
  openPredictor?: () => Worker;
  onDecision?: (decision: LoopDecision) => void;
  sim: Simulation;
  horizonS: number;
  playing: boolean;
  play: () => void;
  onToggle?: (enabled: boolean) => void;
  onChange?: () => void;
}

export function ControlLoop({ disabled = false, openPredictor, sim, horizonS, playing, play, onChange, onToggle, onDecision }: ControlLoopProps) {
  const [enabled, setEnabled] = useState(false);
  const [active, setActive] = useState<number[]>([]);
  const next = useRef(0);
  useEffect(() => {
    if (!enabled || !playing) return;
    const controller = new LoopController(sim, horizonS);
    const steps = controller.horizonSteps;
    // A worker's answer is still applied if it arrives within this many steps of the request (a decision that
    // includes a release look-ahead takes longer than a plain forecast).
    const tolerance = Math.max(steps, Math.round(1 / sim.model.params.dt));
    let previous = sim.state.n;
    let closed = false;
    // Without a worker, decisions run on the main thread spread over frames (never one long synchronous forecast:
    // a release look-ahead is thousands of steps, review 2026-11-24 finding 2).
    let incremental = !openPredictor || typeof Worker === 'undefined';
    // `job` is the full decision (it may run a long release look-ahead); `guard` is a quick decision without one,
    // started whenever a decision falls due while `job` is still running, so a hot forecast is never waited out.
    // Each remembers the controls it was asked about: once those are no longer in force (a guard, another decision
    // or the user changed them) its final outcome would undo that change, so it is dropped (review 2026-11-25, 2).
    interface Job { run: Generator<LoopProgress, LoopOutcome>; asked: AppliedControls; steps: number }
    let job: Job | undefined;
    let guard: Job | undefined;
    let busy = false;
    const start = (allowProbe: boolean): Job => {
      const req = controller.request(allowProbe);
      return { run: decideSteps(sim.model, req, INCREMENTAL_CHUNK), asked: req.target, steps: 0 };
    };
    const current = (j: Job) => sameControls(sim.commandedControls, j.asked);
    function apply(outcome: LoopOutcome): number {
      const flips = controller.apply(outcome);
      if (outcome.provisional) return flips; // the decision itself is logged when it ends
      onDecision?.({
        time: sim.time, peakTileC: outcome.peakTileC, coils: outcome.coils,
        drive: Float32Array.from(sim.model.drive(sim.coils, sim.absoluteTime)),
      });
      setActive(outcome.coils.flatMap((on, k) => on ? [k + 1] : []));
      return flips;
    }
    /**
     * Advance a decision by one chunk. A provisional outcome ("all coils on") is always safe and applied; the final
     * one only if the controls it was asked about are still in force. Returns the forecast steps spent and whether done.
     */
    function stepJob(j: Job): { spent: number; done: boolean } {
      const r = j.run.next();
      let spent = 0;
      if (typeof r.value === 'number') {
        spent = r.value - j.steps;
        j.steps = r.value;
      } else if (r.value.provisional) {
        apply(r.value);
        j.asked = sim.commandedControls; // its own change: the rest of this decision still holds
      } else if (current(j)) {
        apply(r.value);
      }
      return { spent, done: Boolean(r.done) };
    }
    function runIncremental(elapsed: number) {
      // A due decision stays due until a job is free to take it (review 2026-11-25b, finding 3).
      if (sim.state.n >= next.current && (!job || !guard)) {
        next.current = sim.state.n + steps;
        if (!job) job = start(true);
        else guard = start(false);
      }
      // Frame-sized batches of real forecast steps. The guard goes first but may take at most GUARD_SHARE of them, so
      // a release look-ahead still advances while guards run (review 2026-11-25b, finding 1). A decision whose
      // controls are no longer in force is dropped at once rather than finished. One next() may end one forecast and
      // start the next, so the last of a frame overruns the budget by less than 2 * INCREMENTAL_CHUNK steps.
      let budget = Math.max(INCREMENTAL_CHUNK, elapsed * INCREMENTAL_RATE);
      let guardBudget = Math.ceil(budget * GUARD_SHARE);
      while (budget > 0) {
        if (job && !current(job)) job = undefined;
        if (guard && !current(guard)) guard = undefined;
        const j = guard && (guardBudget > 0 || !job) ? guard : job;
        if (!j) break;
        const { spent, done } = stepJob(j);
        budget -= Math.max(spent, 1);
        if (j === guard) guardBudget -= Math.max(spent, 1);
        if (done) {
          if (j === guard) guard = undefined;
          else job = undefined;
        }
      }
    }
    function update() {
      if (busy) return; // apply() commands the coils, and the simulation notifies its listeners at once
      if (sim.state.n < previous) {
        next.current = sim.state.n;
        job = guard = undefined;
        controller.reset();
      }
      const elapsed = Math.max(0, sim.state.n - previous);
      previous = sim.state.n;
      if (incremental) {
        busy = true;
        try { runIncremental(elapsed); } finally { busy = false; }
        return;
      }
      if (sim.state.n < next.current) return;
      // The full decision goes to `full`; one that falls due while it is still working (a release look-ahead) goes
      // to `guarding` without a probe, so an overheat is never waited out (review 2026-11-25, finding 3). With both
      // busy the decision stays due and is sent to whichever answers first.
      const lane = !full!.pending ? full! : guarding && !guarding.pending ? guarding : undefined;
      if (!lane) return;
      next.current = sim.state.n + steps;
      lane.requestedAt = sim.state.n;
      lane.pending = true;
      const request = controller.request(lane === full);
      lane.asked = request.target;
      lane.worker.postMessage({request});
    }
    interface Lane { worker: Worker; pending: boolean; requestedAt: number; asked?: AppliedControls }
    const open = (): Lane => ({ worker: openPredictor!(), pending: false, requestedAt: sim.state.n });
    let full: Lane | undefined;
    let guarding: Lane | undefined;
    if (!incremental) {
      try { full = open(); } catch { incremental = true; /* the frame-paced path needs no worker */ }
      // Without a second worker the full worker still decides; there is just no guard while it runs a look-ahead.
      if (full) try { guarding = open(); } catch { guarding = undefined; }
    }
    function useIncrementalForecast() {
      if (closed) return;
      full?.worker.terminate();
      guarding?.worker.terminate();
      full = guarding = undefined;
      incremental = true;
      next.current = sim.state.n;
      update();
    }
    function listen(lane: Lane) {
      lane.worker.onmessage = ({data}: MessageEvent<LoopOutcome>) => {
        if (closed || (lane !== full && lane !== guarding)) return;
        lane.pending = false;
        if (sim.state.n < lane.requestedAt || !lane.asked || !sameControls(sim.commandedControls, lane.asked)) {
          // Reset, or the controls changed while the worker worked (the other worker, or the user, changed them):
          // the answer is about another state. Ask again at once.
          next.current = sim.state.n;
          update();
        } else if (sim.state.n <= lane.requestedAt + tolerance) apply(data);
        else useIncrementalForecast(); // the workers cannot keep up
      };
      lane.worker.onerror = useIncrementalForecast;
    }
    if (full) listen(full);
    if (guarding) listen(guarding);
    update();
    const unsubscribe = sim.subscribe(update);
    return () => {
      closed = true;
      unsubscribe();
      full?.worker.terminate();
      guarding?.worker.terminate();
      next.current = sim.state.n;
    };
  }, [sim, enabled, playing, horizonS, onDecision, openPredictor]);
  return <div className="auto-feedback">
    <span>{enabled ? (playing ? (active.length ? 'Adjusting ' + active.map(k => 'D' + k).join(' · ') : 'Monitoring heat') : 'Paused') : 'Off'}</span>
    <label className="auto-feedback__switch">
      <input type="checkbox" role="switch" disabled={disabled} checked={enabled} onChange={e => {
        const on = e.target.checked;
        next.current = on ? sim.state.n : Infinity;
        setEnabled(on);
        onToggle?.(on);
        if (on) play();
        else {
          sim.setCoils(sim.coils.map(() => 0));
          setActive([]);
          onChange?.();
        }
      }} /> Control loop
    </label>
  </div>;
}
