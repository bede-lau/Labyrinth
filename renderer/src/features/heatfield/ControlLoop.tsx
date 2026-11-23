import { useEffect, useRef, useState } from 'react';
import type { HeatTransfer } from './loadBalance';
import { decideSteps, FORECAST_CHUNK, LoopController, type LoopOutcome } from './loopPolicy';
import type { Simulation } from './sim';

export interface LoopDecision {
  time: number;
  transfers: readonly HeatTransfer[];
  peakTileC: number[];
  coils: readonly number[];
  drive: Float32Array<ArrayBuffer>;
}

interface ControlLoopProps {
  disabled?: boolean;
  balanceHeat?: boolean;
  openPredictor?: () => Worker;
  onDecision?: (decision: LoopDecision) => void;
  sim: Simulation;
  horizonS: number;
  playing: boolean;
  play: () => void;
  onToggle?: (enabled: boolean) => void;
  onChange?: () => void;
}

export function ControlLoop({ disabled = false, balanceHeat = false, openPredictor, sim, horizonS, playing, play, onChange, onToggle, onDecision }: ControlLoopProps) {
  const [enabled, setEnabled] = useState(false);
  const [active, setActive] = useState<number[]>([]);
  const next = useRef(0);
  useEffect(() => {
    if (!enabled || !playing) return;
    const controller = new LoopController(sim, horizonS, balanceHeat);
    const steps = controller.horizonSteps;
    // A worker's answer is still applied if it arrives within this many steps of the request (a decision that
    // includes a release look-ahead takes longer than a plain forecast).
    const tolerance = Math.max(steps, Math.round(1 / sim.model.params.dt));
    let previous = sim.state.n;
    let worker: Worker | undefined;
    let pending = false;
    let closed = false;
    let requestedAt = sim.state.n;
    let incremental = false;
    let job: Generator<void, LoopOutcome> | undefined;
    function apply(outcome: LoopOutcome) {
      controller.apply(outcome);
      // No hold after a transfer: a transfer is only adopted when its forecast beats the one in force, so the
      // loop keeps polling at the prediction interval.
      onDecision?.({
        time: sim.time, peakTileC: outcome.peakTileC, coils: outcome.coils, transfers: outcome.transfers,
        drive: Float32Array.from(sim.model.drive(sim.coils, sim.absoluteTime)),
      });
      setActive(outcome.coils.flatMap((on, k) => on ? [k + 1] : []));
    }
    function update() {
      if (sim.state.n < previous) {
        next.current = sim.state.n;
        job = undefined;
        controller.reset();
      }
      const elapsed = Math.max(0, sim.state.n - previous);
      previous = sim.state.n;
      if (pending) return;
      if (incremental) {
        if (!job) {
          if (sim.state.n < next.current) return;
          requestedAt = sim.state.n;
          next.current = requestedAt + steps;
          job = decideSteps(sim.model, controller.request());
        }
        // Run the forecast in bounded frame-sized batches when a worker cannot keep up with fast playback.
        for (let budget = Math.max(1, elapsed * 2); budget > 0; budget -= FORECAST_CHUNK) {
          const r = job.next();
          if (r.done) {
            job = undefined;
            apply(r.value);
            break;
          }
        }
        return;
      }
      if (sim.state.n < next.current) return;
      requestedAt = sim.state.n;
      next.current = requestedAt + steps;
      if (worker) {
        pending = true;
        worker.postMessage({request: controller.request()});
      } else {
        apply(controller.decide());
      }
    }
    if (openPredictor && typeof Worker !== 'undefined') {
      try { worker = openPredictor(); } catch { /* Synchronous replay is available offline. */ }
    }
    function useIncrementalForecast() {
      if (closed) return;
      worker?.terminate();
      worker = undefined;
      pending = false;
      incremental = true;
      next.current = sim.state.n;
      update();
    }
    if (worker) {
      worker.onmessage = ({data}: MessageEvent<LoopOutcome>) => {
        if (closed) return;
        pending = false;
        if (sim.state.n >= requestedAt && sim.state.n <= requestedAt + tolerance) apply(data);
        else useIncrementalForecast();
      };
      worker.onerror = useIncrementalForecast;
    }
    update();
    const unsubscribe = sim.subscribe(update);
    return () => {
      closed = true;
      unsubscribe();
      worker?.terminate();
      next.current = sim.state.n;
    };
  }, [sim, enabled, playing, horizonS, onDecision, balanceHeat, openPredictor]);
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
