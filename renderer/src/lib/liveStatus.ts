// Live GX status from the main process (GET /api/live/status, contract: live-status.schema.json).
// With no backend reachable (static replay build) the app runs in REPLAY mode — never fake LIVE.
//
// ONE store polls the API for the header and every view (`useLiveStatus`). A response is applied only
// when it is a 2xx answer, valid against the contract, and newer than what is on screen; each request
// is aborted after a timeout shorter than the poll interval, so a hung backend becomes `unreachable`
// instead of leaving LIVE on frozen data. Every HTTP call to /api/live/* is in this file.
import { useCallback, useSyncExternalStore } from 'react';
import { SAVED_RUN_ID, validateLiveStatus, validateSavedRun, type LiveMode, type LiveStatus, type SavedRun } from './liveContract';

export { LIVE_MODES, LIVE_VERDICTS, SAVED_RUN_ID, validateLiveStatus, validateSavedRun } from './liveContract';
export type {
  LiveArchiveVerdict,
  LiveComparison,
  LiveComparisonWindow,
  LiveMode,
  LiveProvenance,
  LiveSample,
  LiveStatus,
  LiveVerdict,
  LiveWorker,
  SavedRun,
} from './liveContract';

/** The last snapshot that passed validation, and when it arrived (ms since the epoch). */
export interface LastKnown {
  data: LiveStatus;
  receivedAt: number;
}

/**
 * Where a launch POSTed from this page stands (FA-4, maintainer decision 2026-11-20):
 * `sent` the request is in flight · `accepted` 202 · `refused` 409, nothing was launched ·
 * `unknown` no answer, or an answer that is neither (the backend may or may not have started a session).
 */
export type LaunchPhase = 'sent' | 'accepted' | 'refused' | 'unknown';

/** The launch lock, carried on every store status while it holds. */
interface LaunchLock {
  /**
   * Launch stays disabled: `sent`/`accepted` until a later snapshot reports a mode other than idle (while `sent`,
   * also other than the mode the launch was sent from, e.g. a settled fallback), `refused`/`unknown` until the next snapshot.
   */
  launchLocked?: boolean;
  launchPhase?: LaunchPhase;
}

export type LiveState =
  | ({ status: 'connecting' } & LaunchLock)
  | ({
      status: 'unreachable';
      message: string;
      /** Why: no answer, a non-2xx answer, an answer that broke the contract, or no fresh answer in time. */
      cause?: 'network' | 'http' | 'invalid' | 'timeout' | 'stale';
      /** The last valid snapshot seen before the API stopped answering (absent if there never was one). */
      lastKnown?: LastKnown;
    } & LaunchLock)
  | ({
      status: 'ready';
      data: LiveStatus;
      /** When this snapshot arrived (ms since the epoch). */
      receivedAt?: number;
      /** How long after `receivedAt` it still counts as fresh (two poll intervals + the request timeout). */
      freshForMs?: number;
    } & LaunchLock);

/** True only when the backend itself reports live — the single source for any LIVE indicator. */
export function isLive(s: LiveState): boolean {
  return s.status === 'ready' && s.data.mode === 'live';
}

/* ---- danger states (money safety) ----------------------------------------------------------- */
// The backend's own wording, read from main/labyrinth_main/features/live_gx (read only, never imported):
//   orchestrator.py:56   TERMINATE_FAILED  "TERMINATE FAILED — check Modal dashboard; GPUs may still be billing"
//   orchestrator.py:57   TERMINATE_PENDING "TERMINATION PENDING — cancel queued, not yet confirmed; GPUs may still be billing"
//   orchestrator.py:59   TERMINATING       "TERMINATION PENDING — terminating workers, no cancel confirmed yet; …"
//   orchestrator.py:61   KILL_SWITCH_ONLY  "kill switch raised, stop not confirmed"  (modal_backend.py:183, under TERMINATE FAILED)
//   modal_backend.py:184 "… and the run kill switch could not be set: <error>"    (under TERMINATE FAILED)
//   modal_backend.py:325-326 pending clause "the run kill switch is raised" / "the run kill switch could NOT be set (…)"
//   orchestrator.py:62   STOPPING          "Stop requested; terminating workers — not confirmed yet" (mode stays launching/live)
//   orchestrator.py:320-333 how `reason` is assembled from them (the marker always leads its clause).
export const TERMINATION_MARKERS = ['TERMINATE FAILED', 'TERMINATION PENDING'] as const;
export type TerminationMarker = (typeof TERMINATION_MARKERS)[number];
/**
 * A stop that only raised the run's kill switch, or could not even set it: never confirmed
 * (modal_backend.py:28-33 "a kill-switch-only stop is NEVER ok: true"). The backend reports both under
 * TERMINATE FAILED; if a reason ever carries the phrase without the marker it is still a failed stop.
 */
const KILL_SWITCH_UNCONFIRMED = ['KILL SWITCH RAISED, STOP NOT CONFIRMED', 'KILL SWITCH COULD NOT BE SET'] as const;
/** orchestrator.py:62 STOPPING: a stop was requested and no termination is confirmed yet. */
export const STOP_REQUESTED = 'Stop requested; terminating workers — not confirmed yet';

export interface TerminationProblem {
  marker: TerminationMarker;
  /** "TERMINATE FAILED — GPUs may still be billing" */
  title: string;
  /** The backend's own words. */
  reason: string;
}

const BILLING = 'GPUs may still be billing';

function reasonOf(source: LiveState | LiveStatus | string | null | undefined): string | null {
  if (typeof source === 'string') return source;
  if (!source) return null;
  if ('status' in source) return source.status === 'ready' ? source.data.reason : null;
  return typeof source.reason === 'string' ? source.reason : null;
}

/**
 * The backend puts TERMINATE FAILED or TERMINATION PENDING into `reason` (in any mode) while a
 * worker's termination is unconfirmed. Found anywhere in the text, in any letter case; FAILED wins
 * when both occur. A kill-switch-only stop (or a kill switch that could not be set) is TERMINATE FAILED
 * even without the marker. Accepts a state, a snapshot or a raw reason (e.g. from a POST answer).
 */
export function terminationProblem(source: LiveState | LiveStatus | string | null | undefined): TerminationProblem | null {
  const reason = reasonOf(source);
  if (reason === null) return null;
  const upper = reason.toUpperCase();
  const marker: TerminationMarker | undefined =
    TERMINATION_MARKERS.find((m) => upper.includes(m)) ??
    (KILL_SWITCH_UNCONFIRMED.some((p) => upper.includes(p)) ? 'TERMINATE FAILED' : undefined);
  return marker ? { marker, title: `${marker} — ${BILLING}`, reason } : null;
}

/** orchestrator.py:62: "Stop requested; terminating workers — not confirmed yet" anywhere in the reason, any letter case. */
export function stopUnconfirmed(source: LiveState | LiveStatus | string | null | undefined): boolean {
  const reason = reasonOf(source);
  return reason !== null && reason.toUpperCase().includes(STOP_REQUESTED.toUpperCase());
}

/** A snapshot other than a clean idle / unavailable / terminated one: workers may exist and bill. */
export function sessionMayBeBilling(d: LiveStatus): boolean {
  return (
    d.mode === 'launching' ||
    d.mode === 'live' ||
    d.mode === 'fallback' ||
    d.workers.length > 0 ||
    terminationProblem(d) !== null ||
    stopUnconfirmed(d)
  );
}

/** A launch from this page that may have started a session: in flight, accepted, or with no usable answer. */
export function launchMayBeRunning(s: LiveState): boolean {
  return s.launchPhase === 'sent' || s.launchPhase === 'accepted' || s.launchPhase === 'unknown';
}

export interface LiveDanger {
  kind: 'terminate-failed' | 'termination-pending' | 'stop-unconfirmed' | 'connection-lost';
  /** Short text for a pill. */
  pill: string;
  title: string;
  /** The backend's reason, verbatim (connection-lost: what this app knows, since the API is silent). */
  detail: string;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour12: false });

/**
 * The state that must be shown as a loud alert on every route (DESIGN.md §5 "Live state"): a failed or
 * pending termination, a requested stop that is not confirmed, or a session that may be billing when the
 * API stopped answering ("connection lost — session state unknown").
 */
export function liveDanger(s: LiveState): LiveDanger | null {
  const problem = terminationProblem(s);
  if (problem) {
    return {
      kind: problem.marker === 'TERMINATE FAILED' ? 'terminate-failed' : 'termination-pending',
      pill: problem.marker,
      title: problem.title,
      detail: problem.reason,
    };
  }
  if (s.status === 'ready' && stopUnconfirmed(s.data)) {
    return { kind: 'stop-unconfirmed', pill: 'Stop not confirmed', title: `STOP NOT CONFIRMED — ${BILLING}`, detail: s.data.reason };
  }
  // `stale` is the moment between "the snapshot is too old to show" and the answer to the request that
  // is sent at once (a resumed tab): not an alarm yet. If that request fails, the cause changes and this fires.
  if (s.status === 'unreachable' && s.cause !== 'stale' && s.lastKnown && (sessionMayBeBilling(s.lastKnown.data) || launchMayBeRunning(s))) {
    const { data, receivedAt } = s.lastKnown;
    const launch = launchMayBeRunning(s) ? ' A launch request was sent from this page after that, and its outcome is not known.' : '';
    return {
      kind: 'connection-lost',
      pill: 'Connection lost',
      title: 'CONNECTION LOST — session state unknown',
      detail: `The live API stopped answering (${s.message}). The last status, received at ${clock(receivedAt)}, reported mode "${data.mode}": ${data.reason}${launch} ${BILLING}.`,
    };
  }
  return null;
}

/* ---- mode -> indicator (DESIGN.md §5), shared by the header and the live panel ------------- */
export interface ModePill {
  status: 'live' | 'replay' | 'rehearsal' | 'failed' | 'billing-risk';
  text: string;
}

/** The saved rehearsal run that may be played: named by the API, well-formed, and the service is qualified. */
export function playableSavedRunId(d: LiveStatus): string | null {
  const id = d.fallback.savedRunId;
  return id !== null && d.qualified === true && SAVED_RUN_ID.test(id) ? id : null;
}

/** Why the session fell back, in the backend's words: the first clause of `fallback.label`. */
export function fallbackCause(d: LiveStatus): string {
  const head = d.fallback.label.split(/\s+—\s+|\.\s+/)[0]?.trim().replace(/\.$/, '') ?? '';
  return head.length > 0 && head.length <= 40 ? head : 'Fallback';
}

/** The global replay pill. Its "$0" is shown only while nothing this app knows of may be billing. */
export const REPLAY_PILL: Readonly<ModePill> = { status: 'replay', text: 'Replay · $0' };
const REPLAY: ModePill = REPLAY_PILL;
const CHECKING: ModePill = { status: 'replay', text: 'Checking status…' };
const LAUNCHING: ModePill = { status: 'rehearsal', text: 'Launching…' };

/**
 * FE2-3: what stands in for "Replay · $0" on a snapshot that reads like replay while GPUs may be billing
 * ($0 is not known then): a launch from this page that is in flight or accepted ("Launching…"), one with no
 * usable answer ("Checking status…": the next snapshot decides), or a snapshot that still lists a session's
 * workers (mode "idle" = the session object before its workers start, as in the 202 answer: "Launching…").
 * A settled fallback (no termination marker) keeps its "$0": every termination is confirmed. Null = keep "$0".
 */
function zeroUnknown(s: LiveState): ModePill | null {
  if (s.status !== 'ready') return null; // connection-lost is a danger of its own; stale reads "Checking status…"
  if (s.launchPhase === 'sent' || s.launchPhase === 'accepted') return LAUNCHING;
  if (s.launchPhase === 'unknown') return CHECKING;
  if (s.data.mode !== 'fallback' && sessionMayBeBilling(s.data)) return s.data.mode === 'idle' ? LAUNCHING : CHECKING;
  return null;
}

export function modePills(s: LiveState): ModePill[] {
  const danger = liveDanger(s);
  let pills: ModePill[];
  if (s.status === 'unreachable' && s.cause === 'stale') pills = [CHECKING];
  else if (s.status !== 'ready') pills = [REPLAY];
  else if (s.data.mode === 'live') pills = [{ status: 'live', text: 'LIVE · GPU 0 / GPU 1' }];
  else if (s.data.mode === 'launching') pills = [LAUNCHING];
  else if (s.data.mode === 'fallback') {
    pills = [
      { status: 'failed', text: fallbackCause(s.data) },
      playableSavedRunId(s.data) ? { status: 'replay', text: 'Playing saved run' } : REPLAY,
    ];
  } else pills = [REPLAY];
  if (!danger) {
    const instead = zeroUnknown(s);
    return instead ? pills.map((p) => (p === REPLAY ? instead : p)) : pills;
  }
  // Danger leads, and no "Replay · $0" beside it: $0 is not known while GPUs may be billing.
  return [{ status: 'billing-risk', text: danger.pill }, ...pills.filter((p) => p.status !== 'replay')];
}

/* ---- HTTP ------------------------------------------------------------------------------------ */
const STATUS_URL = '/api/live/status';

export class LiveStatusError extends Error {
  readonly kind: 'network' | 'http' | 'invalid' | 'timeout';
  constructor(kind: LiveStatusError['kind'], message: string) {
    super(message);
    this.name = 'LiveStatusError';
    this.kind = kind;
  }
}

const text = (e: unknown) => (e instanceof Error ? e.message : String(e));
const currentFetch = (fetchImpl?: typeof fetch): typeof fetch => fetchImpl ?? globalThis.fetch;

/** Resolves only for a 2xx answer whose body is a complete live-status snapshot. */
export async function fetchLiveStatus(fetchImpl: typeof fetch = fetch, init: { signal?: AbortSignal } = {}): Promise<LiveStatus> {
  let res: Response;
  try {
    res = await fetchImpl(STATUS_URL, { headers: { Accept: 'application/json' }, signal: init.signal });
  } catch (e) {
    throw e instanceof LiveStatusError ? e : new LiveStatusError('network', text(e));
  }
  if (!res.ok) throw new LiveStatusError('http', `${STATUS_URL}: HTTP ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch (e) {
    throw new LiveStatusError('invalid', `${STATUS_URL}: bad payload (not JSON: ${text(e)})`);
  }
  const problem = validateLiveStatus(body);
  if (problem) throw new LiveStatusError('invalid', `${STATUS_URL}: bad payload (${problem})`);
  return body as LiveStatus;
}

/** GET /api/live/runs/<id>: a saved rehearsal run, shape-checked against live-run.schema.json. */
export async function fetchSavedRun(id: string, fetchImpl?: typeof fetch): Promise<SavedRun> {
  if (!SAVED_RUN_ID.test(id)) throw new Error(`saved run id ${JSON.stringify(id)} is not valid`);
  const url = `/api/live/runs/${encodeURIComponent(id)}`;
  const res = await currentFetch(fetchImpl)(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch (e) {
    throw new Error(`${url}: bad payload (not JSON: ${text(e)})`);
  }
  const problem = validateSavedRun(body);
  if (problem) throw new Error(`${url}: bad payload (${problem})`);
  const run = body as SavedRun;
  if (run.savedRunId !== id) throw new Error(`${url}: bad payload (answered with run ${run.savedRunId})`);
  return run;
}

export interface LiveActionResult {
  /** A 2xx answer whose body says `ok: true`. Anything else is not a confirmation. */
  ok: boolean;
  /** `null` when no answer arrived at all (the outcome on the backend is then unknown). */
  httpStatus: number | null;
  reason: string;
  /** The status snapshot carried by the answer, when it has a valid one. */
  status: LiveStatus | null;
}

async function postLive(url: string, payload: unknown, fetchImpl?: typeof fetch): Promise<LiveActionResult> {
  let res: Response;
  try {
    res = await currentFetch(fetchImpl)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, httpStatus: null, reason: `No response from ${url} (${text(e)})`, status: null };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const b = typeof body === 'object' && body !== null ? (body as { ok?: unknown; reason?: unknown; status?: unknown }) : {};
  return {
    ok: res.ok && b.ok === true,
    httpStatus: res.status,
    reason: typeof b.reason === 'string' && b.reason.length > 0 ? b.reason : `HTTP ${res.status}`,
    status: validateLiveStatus(b.status) === null ? (b.status as LiveStatus) : null,
  };
}

/** POST /api/live/launch with exactly the cost the user confirmed. */
export function postLiveLaunch(confirmCostUsd: number, fetchImpl?: typeof fetch): Promise<LiveActionResult> {
  return postLive('/api/live/launch', { confirmCostUsd }, fetchImpl);
}

/** POST /api/live/terminate. `ok` only when the backend confirmed the termination (HTTP 200). */
export function postLiveTerminate(fetchImpl?: typeof fetch): Promise<LiveActionResult> {
  return postLive('/api/live/terminate', {}, fetchImpl);
}

/** What one Terminate sent from this page came back with. */
export interface TerminateAnswer {
  /** FA-2: a 2xx `ok: true` whose words do not say otherwise. Anything else is not a confirmation. */
  confirmed: boolean;
  /** The backend's words (or, with no answer at all, what this page knows). */
  reason: string;
  /** The snapshot on screen right after the answer was applied: a later snapshot is a different object. */
  seen: LiveStatus | null;
}

/**
 * POST /api/live/terminate, then show what the backend says now: the status the answer carries, or a fresh
 * poll when it carries none. Shared by the live panel and the header's control, so both read an answer alike.
 */
export async function sendTerminate(store: LiveStatusStore = liveStatusStore, fetchImpl?: typeof fetch): Promise<TerminateAnswer> {
  const r = await postLiveTerminate(fetchImpl);
  // A stop is confirmed only by a 2xx ok:true whose words do not say otherwise (a kill-switch-only or requested
  // stop is never "terminated", modal_backend.py:28-33, orchestrator.py:60-62).
  const confirmed = r.ok && terminationProblem(r.reason) === null && !stopUnconfirmed(r.reason);
  if (!r.status || !store.apply(r.status)) void store.refresh();
  const now = store.getState();
  return {
    confirmed,
    reason: r.httpStatus === null ? `${r.reason}; termination is unconfirmed.` : r.reason,
    seen: now.status === 'ready' ? now.data : null,
  };
}

/* ---- the shared store ----------------------------------------------------------------------- */
export interface LiveStatusStoreOptions {
  /** Defaults to the global `fetch`, looked up at each request. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Upper bound for one request; the effective timeout is also kept below the poll interval. */
  timeoutMs?: number;
  /** Poll back-off while no backend answers (static replay build). `false` polls at every interval. */
  backoff?: { baseMs: number; maxMs: number } | false;
}

export interface LiveStatusStore {
  getState(): LiveState;
  /** Start (or join) polling at `intervalMs`; the fastest subscriber sets the pace. Returns unsubscribe. */
  subscribe(listener: () => void, intervalMs?: number): () => void;
  /** Poll now, ignoring any back-off. Resolves once that answer was applied or dropped. */
  refresh(): Promise<void>;
  /** Apply a status snapshot carried by a POST answer. Returns false (and changes nothing) if it is invalid. */
  apply(status: unknown): boolean;
  /** Call right before POSTing a launch: Launch is locked (`launchPhase: 'sent'`) from here on. */
  lockLaunch(): void;
  /**
   * Call with the launch POST's outcome, BEFORE applying the status it carried (FA-4):
   * `accepted` (202) stays locked until a snapshot requested after the answer reports a mode other than idle;
   * `refused` (409: nothing was launched) and `unknown` (no answer, or neither 2xx nor 409) are released
   * by the next snapshot requested after this call, whatever it says — that snapshot decides whether
   * launching is allowed. No-op when no launch is locked.
   */
  launchAnswered(outcome: Exclude<LaunchPhase, 'sent'>): void;
}

export const DEFAULT_POLL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_BACKOFF = { baseMs: 4_000, maxMs: 60_000 };

type Outcome = { ok: true; data: LiveStatus } | { ok: false; message: string; cause: NonNullable<Extract<LiveState, { status: 'unreachable' }>['cause']> };

export function createLiveStatusStore(opts: LiveStatusStoreOptions = {}): LiveStatusStore {
  const now = opts.now ?? (() => Date.now());
  const backoff = opts.backoff === undefined ? DEFAULT_BACKOFF : opts.backoff;
  const listeners = new Map<() => void, number>();

  let state: LiveState = { status: 'connecting' };
  let lastKnown: LastKnown | null = null;
  // The launch lock and the newest request sequence number when it last changed: only a snapshot
  // requested after that can release it (an older poll may predate the launch on the backend). `from` is
  // the mode on screen when the launch was sent (idle, or a settled fallback: cross-RX-4).
  let launch: { phase: LaunchPhase; after: number; from: LiveMode | null } | null = null;
  let issued = 0; // sequence number of the newest request (or applied POST answer)
  let applied = 0; // sequence number of the answer on screen
  let epoch = 0; // bumped on reset: answers from before a reset are dropped
  let failures = 0;
  let nextAttempt = 0;
  let pollInFlight = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let timerMs = 0;

  const interval = () => (listeners.size ? Math.min(...listeners.values()) : DEFAULT_POLL_MS);
  const timeout = () => Math.max(1, Math.min(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, Math.floor(interval() * 0.75)));
  const freshFor = () => 2 * interval() + timeout();
  const lock = (): LaunchLock => (launch ? { launchLocked: true, launchPhase: launch.phase } : {});

  const emit = (next: LiveState) => {
    state = next;
    for (const l of [...listeners.keys()]) l();
  };

  /** Re-emit the current state with the current launch lock. */
  const relock = () => {
    const { launchLocked: _locked, launchPhase: _phase, ...rest } = state;
    emit({ ...rest, ...lock() } as LiveState);
  };

  const fail = (message: string, cause: Extract<Outcome, { ok: false }>['cause']) => {
    failures += 1;
    // While a session may be billing, keep polling at the normal pace: the unknown must be resolved fast.
    const urgent = (lastKnown !== null && sessionMayBeBilling(lastKnown.data)) || (launch !== null && launch.phase !== 'refused');
    nextAttempt = backoff && !urgent ? now() + Math.min(backoff.maxMs, backoff.baseMs * 2 ** (failures - 1)) : 0;
    emit({ status: 'unreachable', message, cause, ...(lastKnown ? { lastKnown } : {}), ...lock() });
  };

  const settle = (seq: number, at: number, outcome: Outcome) => {
    if (at !== epoch || seq <= applied) return; // from before a reset, or older than what is on screen
    applied = seq;
    if (!outcome.ok) return fail(outcome.message, outcome.cause);
    failures = 0;
    nextAttempt = 0;
    const receivedAt = now();
    lastKnown = { data: outcome.data, receivedAt };
    if (launch && seq > launch.after) {
      // refused / unknown: this snapshot, requested after the answer, says what is true now.
      // sent / accepted: released once the mode changed (right after a 202 the API can still read idle).
      // While the request is in flight (sent) the backend may still report the mode it was sent from (a
      // fallback), so that mode does not count as a change; after a 202 every snapshot is the new session's.
      const mode = outcome.data.mode;
      const changed = mode !== 'idle' && (launch.phase === 'accepted' || mode !== launch.from);
      if (launch.phase === 'refused' || launch.phase === 'unknown' || changed) launch = null;
    }
    emit({ status: 'ready', data: outcome.data, receivedAt, freshForMs: freshFor(), ...lock() });
  };

  const request = async (): Promise<void> => {
    const seq = ++issued;
    const at = epoch;
    const ms = timeout();
    const ctrl = new AbortController();
    let kill: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      kill = setTimeout(() => {
        ctrl.abort();
        reject(new LiveStatusError('timeout', `${STATUS_URL}: no answer within ${ms} ms`));
      }, ms);
    });
    try {
      const data = await Promise.race([fetchLiveStatus(currentFetch(opts.fetchImpl), { signal: ctrl.signal }), timedOut]);
      settle(seq, at, { ok: true, data });
    } catch (e) {
      settle(seq, at, { ok: false, message: text(e), cause: e instanceof LiveStatusError ? e.kind : 'network' });
    } finally {
      clearTimeout(kill);
    }
  };

  const poll = () => {
    const t = now();
    // A snapshot that outlived its freshness (timers were suspended) is not shown as current any longer.
    if (state.status === 'ready' && state.receivedAt !== undefined && t - state.receivedAt > (state.freshForMs ?? freshFor())) {
      emit({
        status: 'unreachable',
        message: `no fresh status for ${Math.round((t - state.receivedAt) / 1000)} s`,
        cause: 'stale',
        ...(lastKnown ? { lastKnown } : {}),
        ...lock(),
      });
    }
    if (pollInFlight || t < nextAttempt) return;
    pollInFlight = true;
    const at = epoch;
    void request().finally(() => {
      if (at === epoch) pollInFlight = false;
    });
  };

  const schedule = () => {
    const ms = interval();
    if (timer !== null && ms === timerMs) return;
    if (timer !== null) clearInterval(timer);
    timerMs = ms;
    timer = setInterval(poll, ms);
  };

  const reset = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    epoch += 1;
    applied = issued;
    failures = 0;
    nextAttempt = 0;
    pollInFlight = false;
    lastKnown = null;
    launch = null;
    state = { status: 'connecting' };
  };

  return {
    getState: () => state,
    subscribe(listener, intervalMs = DEFAULT_POLL_MS) {
      const first = listeners.size === 0;
      listeners.set(listener, Math.max(1, intervalMs));
      schedule();
      if (first) poll();
      return () => {
        listeners.delete(listener);
        // Nobody is looking: stop polling and forget everything, so nothing stale greets the next subscriber.
        if (listeners.size === 0) reset();
        else schedule();
      };
    },
    refresh: () => request(),
    apply(status) {
      if (validateLiveStatus(status) !== null) return false;
      settle(++issued, epoch, { ok: true, data: status as LiveStatus });
      return true;
    },
    lockLaunch() {
      launch = { phase: 'sent', after: issued, from: state.status === 'ready' ? state.data.mode : null };
      relock();
    },
    launchAnswered(outcome) {
      if (!launch) return; // already released (the mode changed while the request was in flight)
      launch = { phase: outcome, after: issued, from: launch.from };
      relock();
    },
  };
}

/** The one store behind the header and every view. */
export const liveStatusStore: LiveStatusStore = createLiveStatusStore();

const customStores = new WeakMap<typeof fetch, LiveStatusStore>();

/** The shared store, or (tests) one store per injected fetch. */
export function liveStatusStoreFor(fetchImpl?: typeof fetch): LiveStatusStore {
  if (!fetchImpl) return liveStatusStore;
  let store = customStores.get(fetchImpl);
  if (!store) customStores.set(fetchImpl, (store = createLiveStatusStore({ fetchImpl })));
  return store;
}

/**
 * Subscribe to the shared live status. Every caller gets the same snapshot at the same time; the
 * shortest `intervalMs` among the mounted callers sets the poll rate.
 */
export function useLiveStatus(intervalMs: number = DEFAULT_POLL_MS, fetchImpl?: typeof fetch): LiveState {
  const store = liveStatusStoreFor(fetchImpl);
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener, intervalMs), [store, intervalMs]);
  return useSyncExternalStore(subscribe, store.getState, store.getState);
}
