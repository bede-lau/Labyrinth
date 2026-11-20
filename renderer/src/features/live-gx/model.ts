// Advance plasma (live GX) — pure mode/permission logic, clock tracking and playback series.
// The danger rules and the mode -> pill mapping are shared with the header: lib/liveStatus.ts.
import type { IconName, SeriesId, StatusKind } from '../../design';
import {
  fallbackCause,
  isLive,
  liveDanger,
  modePills,
  playableSavedRunId,
  sessionMayBeBilling,
  stopUnconfirmed,
  terminationProblem,
  type LiveState,
  type LiveWorker,
  type SavedRun,
  type TerminationProblem,
} from '../../lib/liveStatus';

export { SAVED_RUN_ID } from '../../lib/liveStatus';
export type { SavedRun } from '../../lib/liveStatus';

/** A saved run may be played as "saved GX rehearsal run" only if every check passed (D-018). */
export function savedRunQualified(run: SavedRun | null | undefined): boolean {
  if (!run) return false;
  const c = run.checks;
  return run.initVerified && run.continuationVerified && c.init && c.continuation && c.distinctDevices && c.overlap;
}

/** The saved run to fetch, or null: only when the API names one AND reports the service qualified. */
export function savedRunToFetch(s: LiveState): string | null {
  if (s.status !== 'ready' || s.data.mode === 'live') return null;
  return playableSavedRunId(s.data);
}

export interface Pill {
  status: StatusKind;
  text: string;
}
export interface ModeView {
  /** DESIGN.md §5 mapping of the API mode to indicator pills (danger first, never beside "Replay · $0"). */
  pills: Pill[];
  title: string;
  tone: 'info' | 'warn' | 'danger';
  icon: IconName;
  /** Replay is playing (true for every state except live). */
  replay: boolean;
}

/**
 * The panel's state label. `localProblem` is a failed Terminate answered to this page: it is a danger
 * state even if the status poll does not (yet) carry the marker.
 */
export function modeView(s: LiveState, localProblem: TerminationProblem | null = null): ModeView {
  const danger = liveDanger(s);
  const replay = !isLive(s);
  let pills: Pill[] = modePills(s);
  if (!danger && localProblem) pills = [{ status: 'billing-risk', text: localProblem.marker }, ...pills.filter((p) => p.status !== 'replay')];
  const mode = s.status === 'ready' ? `the API reports mode "${s.data.mode}"` : 'the API is not answering';
  if (danger?.kind === 'connection-lost') {
    return { pills, title: 'STATE UNKNOWN — the live API stopped answering during a session', tone: 'danger', icon: 'danger', replay };
  }
  if (danger?.kind === 'stop-unconfirmed') {
    return { pills, title: `STOP NOT CONFIRMED — ${mode}`, tone: 'danger', icon: 'danger', replay };
  }
  if (danger || localProblem) {
    return { pills, title: `TERMINATION NOT CONFIRMED — ${mode}`, tone: 'danger', icon: 'danger', replay };
  }
  if (s.status === 'connecting') return { pills, title: 'REPLAY — connecting to the live API…', tone: 'info', icon: 'replay', replay };
  if (s.status === 'unreachable' && s.cause === 'stale') {
    return { pills, title: 'CHECKING — the last status is too old to show', tone: 'warn', icon: 'replay', replay };
  }
  if (s.status === 'unreachable') return { pills, title: 'REPLAY — live API unreachable', tone: 'warn', icon: 'replay', replay };
  switch (s.data.mode) {
    case 'live':
      return { pills, title: 'LIVE — GX running on two GPUs', tone: 'info', icon: 'live', replay };
    case 'fallback':
      return { pills, title: `FALLBACK — ${fallbackCause(s.data)}`, tone: 'warn', icon: 'alert', replay };
    case 'launching':
      return { pills, title: 'LAUNCHING — not live until both workers report', tone: 'info', icon: 'rehearsal', replay };
    case 'unavailable':
      return { pills, title: 'REPLAY — live GX unavailable', tone: 'warn', icon: 'replay', replay };
    case 'terminated':
      return { pills, title: 'REPLAY — last live session terminated', tone: 'info', icon: 'replay', replay };
    case 'idle':
    default:
      return s.data.workers.length > 0
        ? { pills, title: 'REPLAY — the API reports idle while a session still lists workers', tone: 'warn', icon: 'replay', replay }
        : { pills, title: 'REPLAY — qualified and idle; nothing is running', tone: 'info', icon: 'replay', replay };
  }
}

/** A snapshot counts as fresh only with a timestamp, for `freshForMs` after it arrived. */
export function isFresh(s: LiveState, now: number): boolean {
  return s.status === 'ready' && s.receivedAt !== undefined && s.freshForMs !== undefined && now - s.receivedAt <= s.freshForMs;
}

/**
 * FA-3: the `live` flag for ProvenanceBadge (DESIGN.md §5 "Provenance never produces LIVE by itself"):
 * only a fresh, valid snapshot (the store holds validated ones only) whose mode is "live".
 */
export function provenanceIsLive(s: LiveState, now: number): boolean {
  return isLive(s) && isFresh(s, now);
}

const LAUNCH_LOCKED: Record<NonNullable<LiveState['launchPhase']>, string> = {
  sent: 'A launch request is on its way to the API.',
  accepted:
    'A launch request was already sent from this page and accepted. Launch stays disabled until the API reports another mode.',
  refused: 'The launch was refused; waiting for a status taken after the refusal.',
  unknown: 'The launch request got no usable answer; waiting for a current status to show whether a session started.',
};

/**
 * L10: why Launch is not allowed right now, or null when it is. Allowed only for a fresh snapshot
 * with mode "idle" and `budget.slotFits`, with no session left over and no launch lock held (FA-4:
 * after a 202 until the mode changes; after a 409 or no answer, until the next snapshot).
 */
export function launchBlockedReason(s: LiveState, now: number): string | null {
  if (s.status === 'connecting') return 'Waiting for /api/live/status.';
  if (s.status === 'unreachable') {
    if (s.cause === 'stale') return 'The last status is too old; waiting for a current one.';
    return liveDanger(s)
      ? 'The live API stopped answering; the session state is unknown.'
      : 'The live API is not reachable (static replay build).';
  }
  const d = s.data;
  if (d.mode !== 'idle') return `Launch needs mode "idle"; the API reports "${d.mode}".`;
  if (terminationProblem(d) || stopUnconfirmed(d)) return 'A termination is unconfirmed; GPUs may still be billing.';
  if (d.workers.length > 0) return 'The API still lists workers from a session.';
  if (d.budget.slotFits !== true) return 'The next slot does not fit under the budget ceiling.';
  if (s.launchLocked) return LAUNCH_LOCKED[s.launchPhase ?? 'accepted'];
  if (!isFresh(s, now)) return 'The last status is not fresh; waiting for the next poll.';
  return null;
}

export function canLaunch(s: LiveState, now: number): boolean {
  return launchBlockedReason(s, now) === null;
}

/** What this page itself knows beyond the status poll. */
export interface LocalSessionFlags {
  /** The last Terminate sent from here was not confirmed. */
  terminateFailed: boolean;
  /** A launch was posted from here and neither refused nor followed by a confirmed terminate. */
  launchUnconfirmed: boolean;
}

/**
 * Terminate must stay available whenever a session may still be billing: the last valid snapshot was
 * not a clean idle one (also after the API stopped answering), a Terminate failed, or a launch is unconfirmed.
 */
export function canTerminate(s: LiveState, local: LocalSessionFlags): boolean {
  if (local.terminateFailed || local.launchUnconfirmed) return true;
  if (s.status === 'ready') return sessionMayBeBilling(s.data);
  if (s.status === 'unreachable') return s.lastKnown !== undefined && sessionMayBeBilling(s.lastKnown.data);
  return false;
}

/* ---- sim clocks ------------------------------------------------------------------------ */
export interface ClockReading {
  simTime: number | null;
  /** When the status carrying this reading arrived (ms). */
  at: number;
}
export interface ClockTrack {
  latest: ClockReading;
  previous: ClockReading | null;
}
export type Clocks = Record<number, ClockTrack>;

/**
 * Record one reading per worker for the snapshot that arrived at `at`. Every new snapshot is a new
 * reading, also when the clock did not move — that is how a stalled solver is seen. The same snapshot
 * (same `at`) processed twice stays one reading.
 */
export function trackClocks(prev: Clocks, workers: readonly LiveWorker[], at: number): Clocks {
  const next: Clocks = {};
  for (const w of workers) {
    const p = prev[w.gpuIndex];
    next[w.gpuIndex] = p && p.latest.at === at ? p : { latest: { simTime: w.simTime, at }, previous: p ? p.latest : null };
  }
  return next;
}

/** Clock change between the last two timestamped readings, or null when there are not two usable ones. */
export function clockAdvance(c: ClockTrack | undefined): { delta: number; overMs: number } | null {
  if (!c || !c.previous || c.latest.simTime === null || c.previous.simTime === null) return null;
  const overMs = c.latest.at - c.previous.at;
  return overMs > 0 ? { delta: c.latest.simTime - c.previous.simTime, overMs } : null;
}

/** PRD: GPU 0 advances the bean tube, GPU 1 the triangular tube. */
export const EXPECTED_TUBE: Record<0 | 1, LiveWorker['tube']> = { 0: 'bean', 1: 'triangular' };

export interface OverlapClaim {
  /** A live session with two workers in state `running` and distinct, non-empty device IDs in the same status reading. */
  concurrent: boolean;
  /** Both device IDs are reported and equal. Never true while an ID is still missing. */
  sameDevice: boolean;
  text: string;
}

/**
 * `live` = the API reports mode "live" right now. Outside a live session the worker states are only
 * the last ones reported (after a fallback a terminated worker can still read "running"), so they
 * prove nothing about execution.
 */
export function overlapClaim(workers: readonly LiveWorker[], live: boolean): OverlapClaim {
  if (workers.length !== 2) {
    return { concurrent: false, sameDevice: false, text: `Concurrent execution not shown: ${workers.length} of 2 workers reported.` };
  }
  const ids = workers.map((w) => w.deviceId.trim());
  const missing = workers.filter((_, i) => ids[i] === '').map((w) => `GPU ${w.gpuIndex}`);
  const running = workers.filter((w) => w.state === 'running').length;
  const sameDevice = missing.length === 0 && ids[0] === ids[1];
  const warning = sameDevice ? ' Warning: both workers report the same device ID.' : '';
  if (!live) {
    return {
      concurrent: false,
      sameDevice,
      text: `Concurrent execution not shown: the session is not live, and the states above are the last ones each worker reported.${warning}`,
    };
  }
  if (running < 2) return { concurrent: false, sameDevice, text: `Concurrent execution not shown: ${running} of 2 workers running.${warning}` };
  if (missing.length > 0) {
    return { concurrent: false, sameDevice, text: `Concurrent execution not shown: device ID not reported yet by ${missing.join(' and ')}.` };
  }
  if (sameDevice) return { concurrent: false, sameDevice, text: `Concurrent execution not shown.${warning}` };
  return {
    concurrent: true,
    sameDevice,
    text: 'Both solvers are executing concurrently on separate devices. Basis: both workers report state "running" with distinct device IDs in this status reading.',
  };
}

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
