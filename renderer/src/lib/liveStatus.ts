// Live GX status from the main process (GET /api/live/status, contract: live-status.schema.json).
// With no backend reachable (static replay build) the app runs in REPLAY mode — never fake LIVE.
//
// ONE store polls the API for the header and every view (`useLiveStatus`). A response is applied only
// when it is a 2xx answer, valid against the contract, and newer than what is on screen; each request
// is aborted after a timeout shorter than the poll interval, so a hung backend becomes `unreachable`
// instead of leaving LIVE on frozen data. Every HTTP call to /api/live/* is in this file.
import { useCallback, useSyncExternalStore } from 'react';
import { SAVED_RUN_ID, validateLiveStatus, validateSavedRun, type LiveStatus, type SavedRun } from './liveContract';

export { LIVE_MODES, SAVED_RUN_ID, validateLiveStatus, validateSavedRun } from './liveContract';
export type { LiveMode, LiveProvenance, LiveSample, LiveStatus, LiveWorker, SavedRun } from './liveContract';

/** The last snapshot that passed validation, and when it arrived (ms since the epoch). */
export interface LastKnown {
  data: LiveStatus;
  receivedAt: number;
}

export type LiveState =
  | { status: 'connecting'; launchLocked?: boolean }
  | {
      status: 'unreachable';
      message: string;
      /** Why: no answer, a non-2xx answer, an answer that broke the contract, or no fresh answer in time. */
      cause?: 'network' | 'http' | 'invalid' | 'timeout' | 'stale';
      /** The last valid snapshot seen before the API stopped answering (absent if there never was one). */
      lastKnown?: LastKnown;
      launchLocked?: boolean;
    }
  | {
      status: 'ready';
      data: LiveStatus;
      /** When this snapshot arrived (ms since the epoch). */
      receivedAt?: number;
      /** How long after `receivedAt` it still counts as fresh (two poll intervals + the request timeout). */
      freshForMs?: number;
      /** A launch was POSTed and the API has not reported another mode since. */
      launchLocked?: boolean;
    };

/** True only when the backend itself reports live — the single source for any LIVE indicator. */
export function isLive(s: LiveState): boolean {
  return s.status === 'ready' && s.data.mode === 'live';
}

/* ---- danger states (money safety) ----------------------------------------------------------- */
export const TERMINATION_MARKERS = ['TERMINATE FAILED', 'TERMINATION PENDING'] as const;
export type TerminationMarker = (typeof TERMINATION_MARKERS)[number];
export interface TerminationProblem {
  marker: TerminationMarker;
  /** "TERMINATE FAILED — GPUs may still be billing" */
  title: string;
  /** The backend's own words. */
  reason: string;
}

const BILLING = 'GPUs may still be billing';

/**
 * The backend puts TERMINATE FAILED or TERMINATION PENDING into `reason` (in any mode) while a
 * worker's termination is unconfirmed. Found anywhere in the text, in any letter case; FAILED wins
 * when both occur. Accepts a state, a snapshot or a raw reason (e.g. from a POST answer).
 */
export function terminationProblem(source: LiveState | LiveStatus | string | null | undefined): TerminationProblem | null {
  const reason =
    typeof source === 'string'
      ? source
      : !source
        ? null
        : 'status' in source
          ? source.status === 'ready'
            ? source.data.reason
            : null
          : source.reason;
  if (typeof reason !== 'string') return null;
  const upper = reason.toUpperCase();
  const marker = TERMINATION_MARKERS.find((m) => upper.includes(m));
  return marker ? { marker, title: `${marker} — ${BILLING}`, reason } : null;
}

/** A snapshot other than a clean idle / unavailable / terminated one: workers may exist and bill. */
export function sessionMayBeBilling(d: LiveStatus): boolean {
  return d.mode === 'launching' || d.mode === 'live' || d.mode === 'fallback' || d.workers.length > 0 || terminationProblem(d) !== null;
}

export interface LiveDanger {
  kind: 'terminate-failed' | 'termination-pending' | 'connection-lost';
  /** Short text for a pill. */
  pill: string;
  title: string;
  detail: string;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour12: false });

/**
 * The state that must be shown as a loud alert on every route: a failed or pending termination, or a
 * session that was not idle when the API stopped answering ("connection lost — session state unknown").
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
  // `stale` is the moment between "the snapshot is too old to show" and the answer to the request that
  // is sent at once (a resumed tab): not an alarm yet. If that request fails, the cause changes and this fires.
  if (s.status === 'unreachable' && s.cause !== 'stale' && s.lastKnown && sessionMayBeBilling(s.lastKnown.data)) {
    const { data, receivedAt } = s.lastKnown;
    return {
      kind: 'connection-lost',
      pill: 'Connection lost',
      title: 'CONNECTION LOST — session state unknown',
      detail: `The live API stopped answering (${s.message}). The last status, received at ${clock(receivedAt)}, reported mode "${data.mode}": ${data.reason} ${BILLING}.`,
    };
  }
  return null;
}

/* ---- mode -> indicator (DESIGN.md §5), shared by the header and the live panel ------------- */
export interface ModePill {
  status: 'live' | 'replay' | 'rehearsal' | 'failed';
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

const REPLAY: ModePill = { status: 'replay', text: 'Replay · $0' };

export function modePills(s: LiveState): ModePill[] {
  const danger = liveDanger(s);
  let pills: ModePill[];
  if (s.status === 'unreachable' && s.cause === 'stale') pills = [{ status: 'replay', text: 'Checking status…' }];
  else if (s.status !== 'ready') pills = [REPLAY];
  else if (s.data.mode === 'live') pills = [{ status: 'live', text: 'LIVE · GPU 0 / GPU 1' }];
  else if (s.data.mode === 'launching') pills = [{ status: 'rehearsal', text: 'Launching…' }];
  else if (s.data.mode === 'fallback') {
    pills = [
      { status: 'failed', text: fallbackCause(s.data) },
      playableSavedRunId(s.data) ? { status: 'replay', text: 'Playing saved run' } : REPLAY,
    ];
  } else pills = [REPLAY];
  if (!danger) return pills;
  // Danger leads, and no "Replay · $0" beside it: $0 is not known while GPUs may be billing.
  return [{ status: 'failed', text: danger.pill }, ...pills.filter((p) => p.status !== 'replay')];
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
  /** Call right before POSTing a launch: Launch stays locked until the API reports a mode other than idle. */
  lockLaunch(): void;
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
  let launchLocked = false;
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
  const lock = () => (launchLocked ? { launchLocked: true } : {});

  const emit = (next: LiveState) => {
    state = next;
    for (const l of [...listeners.keys()]) l();
  };

  const fail = (message: string, cause: Extract<Outcome, { ok: false }>['cause']) => {
    failures += 1;
    // While a session may be billing, keep polling at the normal pace: the unknown must be resolved fast.
    const urgent = lastKnown !== null && sessionMayBeBilling(lastKnown.data);
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
    if (outcome.data.mode !== 'idle') launchLocked = false; // the mode changed since the launch was posted
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
    launchLocked = false;
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
      launchLocked = true;
      emit({ ...state, launchLocked: true });
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
