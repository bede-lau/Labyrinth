// Forecast replay state machine and derived numbers (pure; tested without the DOM).
import type { FixtureCheckData, Provenance } from '../../design';

export type Window = [number, number];

export interface ForecastStep {
  window: Window;
  observed: number;
  persistence: number;
  frozen: number;
  absErrPersistence: number;
  absErrFrozen: number;
}

/** TS mirror of contracts/forecast.schema.json. */
export interface ForecastArtifact {
  schemaVersion: 1;
  traceId: string;
  initWindow: Window;
  windowWidth: number;
  method: string;
  steps: ForecastStep[];
  mae: { persistence: number; frozen: number };
  fixtures: FixtureCheckData[];
  provenance: Provenance;
}

/**
 * `index` = the step being worked on; `phase` = what has been shown for it.
 *   ready     -> nothing for this step yet (next: Predict)
 *   predicted -> both forecasts shown, observed hidden (next: Reveal)
 *   revealed  -> observed + absolute errors shown (next: Update, which scores the step and moves on)
 * `index === steps.length` means the replay is complete.
 */
export type Phase = 'ready' | 'predicted' | 'revealed';
export interface ReplayState {
  index: number;
  phase: Phase;
}

export const INITIAL: ReplayState = { index: 0, phase: 'ready' };

export function advance(s: ReplayState, nSteps: number): ReplayState {
  if (s.index >= nSteps) return s;
  if (s.phase === 'ready') return { index: s.index, phase: 'predicted' };
  if (s.phase === 'predicted') return { index: s.index, phase: 'revealed' };
  return { index: s.index + 1, phase: 'ready' };
}

export type NextAction = 'predict' | 'reveal' | 'update' | 'done';
export function nextAction(s: ReplayState, nSteps: number): NextAction {
  if (s.index >= nSteps) return 'done';
  return s.phase === 'ready' ? 'predict' : s.phase === 'predicted' ? 'reveal' : 'update';
}

/** Number of steps scored so far (Update commits a step). */
export const scoredCount = (s: ReplayState) => s.index;

export interface StepVisibility {
  forecasts: boolean;
  observed: boolean;
}
export function visibility(s: ReplayState, i: number): StepVisibility {
  if (i < s.index) return { forecasts: true, observed: true };
  if (i > s.index) return { forecasts: false, observed: false };
  return { forecasts: s.phase !== 'ready', observed: s.phase === 'revealed' };
}

/** Running MAE over the scored steps, or null before the first Update. */
export function runningMae(steps: readonly ForecastStep[], scored: number): { persistence: number; frozen: number } | null {
  const done = steps.slice(0, scored);
  if (done.length === 0) return null;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return { persistence: mean(done.map((s) => s.absErrPersistence)), frozen: mean(done.map((s) => s.absErrFrozen)) };
}

export interface SampleAndHold {
  persistence: [string, string];
  frozen: [string, string];
  archive: { value: string; printed: string; claimed: string } | null;
}

/** Extract the D-016 sample-and-hold numbers from the fixture note (the artifact is the only source). */
export function parseSampleAndHold(note: string | undefined): SampleAndHold | null {
  if (!note) return null;
  const m = /persistence\s+([0-9.]+)\s*→\s*([0-9.]+),\s*frozen\s+([0-9.]+)\s*→\s*([0-9.]+)/.exec(note);
  if (!m) return null;
  const a = /300–400\s*=\s*([0-9.]+)\s*\(prints\s+([0-9.]+),\s*PRD\s+([0-9.]+)\)/.exec(note);
  return {
    persistence: [m[1] as string, m[2] as string],
    frozen: [m[3] as string, m[4] as string],
    archive: a ? { value: a[1] as string, printed: a[2] as string, claimed: a[3] as string } : null,
  };
}
