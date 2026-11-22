// Playback of the running model (H13): a requestAnimationFrame loop that advances model time at the chosen speed
// (steps per frame capped), redraws the scene through the Simulation's listeners every frame, redraws the |B| chart
// through `chartTicks` on every frame of a 60 Hz display, and refreshes the rest of React at about 10 Hz. Paused,
// nothing steps, so every display is frozen.
import { useEffect, useRef, useState } from 'react';
import { useViewActive } from '../../lib/viewActive';
import type { Simulation } from './sim';

/** Speeds offered: model seconds per real second. */
export const SPEEDS = [0.25, 1, 2] as const;
export type Speed = number;

/** At most this many model steps per animation frame (a slow frame never stalls the page). */
export const MAX_STEPS_PER_FRAME = 60;
/** React refresh interval while playing (ms). */
export const UI_INTERVAL_MS = 100;
/**
 * |B| chart redraw interval while playing (ms): below one frame of a 60 Hz display, so the chart redraws on every
 * such frame (at most every other frame on faster displays). The coil sweep runs at parameters.sweepFrequency of
 * model time, up to the fastest speed in real time; at the 10 Hz refresh it would be sampled a few times per sweep
 * and the curve would jump between phases instead of sweeping (HF-R2).
 */
export const CHART_INTERVAL_MS = 12;

/** Listeners called from the playback loop (the |B| chart redraws on it, faster than the React refresh). */
export class FrameTicker {
  private fns = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.fns.add(fn);
    return () => {
      this.fns.delete(fn);
    };
  }

  emit(): void {
    for (const fn of this.fns) fn();
  }

  /** Listeners subscribed now (a component that unmounts must leave none behind). */
  get size(): number {
    return this.fns.size;
  }
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** True while the user asks for reduced motion (false where matchMedia is unavailable). */
export function usePrefersReducedMotion(): boolean {
  const get = () => typeof globalThis.matchMedia === 'function' && globalThis.matchMedia(REDUCED_MOTION)?.matches === true;
  const [reduced, setReduced] = useState(get);
  useEffect(() => {
    if (typeof globalThis.matchMedia !== 'function') return;
    const mq = globalThis.matchMedia(REDUCED_MOTION);
    if (!mq?.addEventListener) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

const raf = (cb: (now: number) => void): number =>
  typeof globalThis.requestAnimationFrame === 'function'
    ? globalThis.requestAnimationFrame(cb)
    : (setTimeout(() => cb(performance.now()), 16) as unknown as number);
const caf = (id: number) =>
  typeof globalThis.cancelAnimationFrame === 'function' ? globalThis.cancelAnimationFrame(id) : clearTimeout(id);

export interface Playback {
  playing: boolean;
  setPlaying: (p: boolean) => void;
  speed: Speed;
  setSpeed: (s: Speed) => void;
  /** Emitted at most every CHART_INTERVAL_MS while playing. */
  chartTicks: FrameTicker;
}

/** Steps for `elapsedS` real seconds at `speed`, carrying the remainder; capped per frame with excess carried into the next frame. */
export function stepsForFrame(acc: number, elapsedS: number, speed: number, dt: number): { steps: number; acc: number } {
  const total = acc + Math.max(0, elapsedS) * speed;
  const steps = Math.min(MAX_STEPS_PER_FRAME, Math.floor(total / dt + 1e-9));
  return { steps, acc: Math.max(0, total - steps * dt) };
}

export function usePlayback(sim: Simulation, initiallyPlaying: boolean, onUiTick: () => void): Playback {
  const active = useViewActive();
  const [playing, setPlaying] = useState(initiallyPlaying);
  const [speed, setSpeed] = useState<Speed>(1);
  const speedRef = useRef<Speed>(speed);
  speedRef.current = speed;
  const tickRef = useRef(onUiTick);
  tickRef.current = onUiTick;
  const [chartTicks] = useState(() => new FrameTicker());

  useEffect(() => {
    if (!playing || !active) return;
    let alive = true;
    let last: number | null = null;
    let lastUi = -Infinity;
    let lastChart = -Infinity;
    let acc = 0;
    let id = 0;
    const dt = sim.model.params.dt;
    const resetClock = () => { last = null; };
    document.addEventListener('visibilitychange', resetClock);
    const frame = (now: number) => {
      if (!alive) return;
      if (last !== null && !document.hidden) {
        const r = stepsForFrame(acc, (now - last) / 1000, speedRef.current, dt);
        acc = r.acc;
        sim.advance(r.steps);
      }
      last = now;
      if (now - lastChart >= CHART_INTERVAL_MS) {
        lastChart = now;
        chartTicks.emit();
      }
      if (now - lastUi >= UI_INTERVAL_MS) {
        lastUi = now;
        tickRef.current();
      }
      id = raf(frame);
    };
    id = raf(frame);
    return () => {
      document.removeEventListener('visibilitychange', resetClock);
      alive = false;
      caf(id);
      tickRef.current(); // the frozen state is what every display shows
    };
  }, [active, playing, sim, chartTicks]);

  return { playing, setPlaying, speed, setSpeed, chartTicks };
}
