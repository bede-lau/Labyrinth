// Advance plasma (live GX) — pure mode/permission logic, clock tracking and playback series.
import type { SeriesId, StatusKind } from '../../design';
import type { LiveStatus, LiveState, LiveWorker } from '../../lib/liveStatus';

/** TS mirror of contracts/live-run.schema.json (GET /api/live/runs/<savedRunId>). */
export interface SavedRun {
  savedRunId: string;
  initVerified: boolean;
  continuationVerified: boolean;
  checks: { init: boolean; continuation: boolean; distinctDevices: boolean; overlap: boolean };
  phases: LiveStatus[];
}

export const SAVED_RUN_ID = /^[A-Za-z0-9_.-]{1,80}$/;

/** A saved run may be played as "saved GX rehearsal run" only if every check passed (D-018). */
export function savedRunQualified(run: SavedRun | null | undefined): boolean {
  if (!run) return false;
  const c = run.checks;
  return run.initVerified && run.continuationVerified && c.init && c.continuation && c.distinctDevices && c.overlap;
}

/** The saved run to fetch, or null: only when the API names one AND reports the service qualified. */
export function savedRunToFetch(s: LiveState): string | null {
  if (s.status !== 'ready' || s.data.mode === 'live') return null;
  const id = s.data.fallback.savedRunId;
  return id && s.data.qualified === true && SAVED_RUN_ID.test(id) ? id : null;
}

export interface Pill {
  status: StatusKind;
  text: string;
}
export interface ModeView {
  /** DESIGN.md §5 mapping of the API mode to indicator pills. */
  pills: Pill[];
  title: string;
  tone: 'info' | 'warn';
  /** Replay is playing (true for every state except live). */
  replay: boolean;
}

export function modeView(s: LiveState): ModeView {
  if (s.status === 'connecting') {
    return { pills: [{ status: 'replay', text: 'Replay · $0' }], title: 'REPLAY — connecting to the live API…', tone: 'info', replay: true };
  }
  if (s.status === 'unreachable') {
    return { pills: [{ status: 'replay', text: 'Replay · $0' }], title: 'REPLAY — live API unreachable', tone: 'warn', replay: true };
  }
  switch (s.data.mode) {
    case 'live':
      return { pills: [{ status: 'live', text: 'LIVE · GPU 0 / GPU 1' }], title: 'LIVE — GX running on two GPUs', tone: 'info', replay: false };
    case 'fallback':
      return {
        pills: [
          { status: 'failed', text: 'Worker failed' },
          { status: 'replay', text: 'Playing saved run' },
        ],
        title: 'FALLBACK — a GX worker failed; playing saved evidence',
        tone: 'warn',
        replay: true,
      };
    case 'launching':
      return { pills: [{ status: 'rehearsal', text: 'Launching…' }], title: 'LAUNCHING — not live until both workers report', tone: 'info', replay: true };
    case 'unavailable':
      return { pills: [{ status: 'replay', text: 'Replay · $0' }], title: 'REPLAY — live GX unavailable', tone: 'warn', replay: true };
    case 'terminated':
      return { pills: [{ status: 'replay', text: 'Replay · $0' }], title: 'REPLAY — last live session terminated', tone: 'info', replay: true };
    case 'idle':
    default:
      return { pills: [{ status: 'replay', text: 'Replay · $0' }], title: 'REPLAY — qualified and idle; nothing is running', tone: 'info', replay: true };
  }
}

export function canLaunch(s: LiveState): boolean {
  return s.status === 'ready' && s.data.mode === 'idle' && s.data.budget.slotFits === true;
}

export function launchBlockedReason(s: LiveState): string | null {
  if (canLaunch(s)) return null;
  if (s.status === 'connecting') return 'Waiting for /api/live/status.';
  if (s.status === 'unreachable') return 'The live API is not reachable (static replay build).';
  if (s.data.mode !== 'idle') return `Launch needs mode "idle"; the API reports "${s.data.mode}".`;
  return 'The next slot does not fit under the budget ceiling.';
}

export const TERMINATE_FAILED_PREFIX = 'TERMINATE FAILED';
export function statusTerminateFailure(s: LiveState): string | null {
  return s.status === 'ready' && s.data.reason.trim().startsWith(TERMINATE_FAILED_PREFIX) ? s.data.reason : null;
}

export function canTerminate(s: LiveState, lastTerminateFailed: boolean): boolean {
  if (s.status !== 'ready') return false;
  return (
    lastTerminateFailed ||
    statusTerminateFailure(s) !== null ||
    ['launching', 'live', 'fallback'].includes(s.data.mode) ||
    s.data.workers.length > 0
  );
}

/* ---- sim clocks ------------------------------------------------------------------------ */
export interface ClockTrack {
  latest: number | null;
  previous: number | null;
}
export type Clocks = Record<number, ClockTrack>;

/** Idempotent per snapshot: a clock "advances" when its latest distinct simTime exceeds the previous one. */
export function trackClocks(prev: Clocks, workers: readonly LiveWorker[]): Clocks {
  const next: Clocks = {};
  for (const w of workers) {
    const p = prev[w.gpuIndex];
    if (!p) next[w.gpuIndex] = { latest: w.simTime, previous: null };
    else if (w.simTime === p.latest) next[w.gpuIndex] = p;
    else next[w.gpuIndex] = { latest: w.simTime, previous: p.latest };
  }
  return next;
}

export function clockAdvance(c: ClockTrack | undefined): number | null {
  if (!c || c.latest === null || c.previous === null) return null;
  return c.latest - c.previous;
}

/** PRD: GPU 0 advances the bean tube, GPU 1 the triangular tube. */
export const EXPECTED_TUBE: Record<0 | 1, LiveWorker['tube']> = { 0: 'bean', 1: 'triangular' };

/* ---- playback -------------------------------------------------------------------------- */
export interface PlaySeries {
  id: string;
  name: string;
  seriesId: SeriesId;
  t: number[];
  Q: number[];
}

/** Concatenate a saved run's phases per tube (phase 2 continues from the checkpoint). */
export function savedRunSeries(run: SavedRun): PlaySeries[] {
  const tubes: LiveWorker['tube'][] = ['bean', 'triangular'];
  return tubes
    .map((tube) => {
      const pts = run.phases.flatMap((p) => p.workers.filter((w) => w.tube === tube).flatMap((w) => w.samples));
      pts.sort((a, b) => a.t - b.t);
      return {
        id: `gx-${tube}`,
        name: `GX ${tube} (rehearsal ${run.savedRunId})`,
        seriesId: tube as SeriesId,
        t: pts.map((p) => p.t),
        Q: pts.map((p) => p.Q),
      };
    })
    .filter((s) => s.t.length > 0);
}

/** Number of samples with t ≤ cursor (t is sorted ascending). */
export function countUpTo(t: readonly number[], cursor: number): number {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((t[mid] as number) <= cursor) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
