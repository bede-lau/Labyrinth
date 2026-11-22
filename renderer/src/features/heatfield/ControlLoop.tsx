import { useEffect, useRef, useState } from 'react';
import { balanceTargets, type HeatTransfer } from './loadBalance';
import type { ModelState } from './model';
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
    const steps = Math.max(1, Math.round(horizonS / sim.model.params.dt));
    let previous = sim.state.n;
    let worker: Worker | undefined;
    let pending = false;
    let closed = false;
    let requestedAt = sim.state.n;
    let incremental = false;
    let shadow: ModelState | undefined;
    const off = sim.coils.map(() => 0);
    function apply(peakTileC: number[]) {
      const coils = peakTileC.map(t => Number(t > sim.model.params.tileLimit));
      const transfers = balanceHeat ? balanceTargets(peakTileC, sim.model.params.tileLimit, sim.model.params.Tcool) : [];
      // Hold each field configuration long enough for a transfer to be visible.
      // Keep polling at the prediction interval when only local sweeping is needed.
      if (transfers.length) next.current = sim.state.n + Math.ceil(1.8 / sim.model.params.dt);
      if (balanceHeat || coils.some((on, k) => on !== sim.coils[k])) sim.setCoils(coils, transfers);
      onDecision?.({
        time: sim.time, peakTileC, coils, transfers,
        drive: Float32Array.from(sim.model.drive(sim.coils, sim.absoluteTime)),
      });
      setActive(coils.flatMap((on, k) => on ? [k + 1] : []));
    }
    function update() {
      if (sim.state.n < previous) {
        next.current = sim.state.n;
        shadow = undefined;
      }
      const elapsed = Math.max(0, sim.state.n - previous);
      previous = sim.state.n;
      if (pending) return;
      if (incremental) {
        if (!shadow) {
          if (sim.state.n < next.current) return;
          shadow = sim.state;
          requestedAt = shadow.n;
          next.current = requestedAt + steps;
        }
        // Run the forecast ahead of the drawing clock, in bounded frame-sized
        // batches, when a worker cannot keep up with fast playback.
        const left = requestedAt + steps - shadow.n;
        shadow = sim.model.advance(shadow, off, Math.min(left, Math.max(1, elapsed * 2)));
        if (shadow.n === requestedAt + steps) {
          const peaks = sim.model.diagnostics(shadow, off).peakTileC;
          shadow = undefined;
          apply(peaks);
        }
        return;
      }
      if (sim.state.n < next.current) return;
      requestedAt = sim.state.n;
      next.current = requestedAt + steps;
      if (worker) {
        pending = true;
        worker.postMessage({state: sim.state, steps});
      } else {
        apply(sim.predict(steps, off).peakTileC);
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
      worker.onmessage = ({data}: MessageEvent<number[]>) => {
        if (closed) return;
        pending = false;
        if (sim.state.n >= requestedAt && sim.state.n <= requestedAt + steps) apply(data);
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
