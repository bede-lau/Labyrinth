// TS mirrors of contracts/live-status.schema.json and contracts/live-run.schema.json, plus
// hand-written validators for both (no runtime dependency). A body that does not match the contract
// is rejected before any component reads it: a partial answer such as {"schemaVersion":1,"mode":"fallback"}
// must never reach a render. `liveContract.test.ts` checks these validators against the real
// schemas with ajv over a corpus of broken payloads, so they cannot drift from the contract unnoticed.

export type LiveMode = 'unavailable' | 'idle' | 'launching' | 'live' | 'fallback' | 'terminated';

export interface LiveSample { t: number; Q: number }
export interface LiveWorker {
  gpuIndex: 0 | 1;
  deviceId: string;
  tube: 'bean' | 'triangular';
  state: 'pending' | 'initializing' | 'running' | 'checkpointed' | 'failed' | 'done';
  simTime: number | null;
  wallStart?: string | null;
  samples: LiveSample[];
  error?: string | null;
}
/** contracts/common.schema.json#/$defs/provenance (structurally equal to the design system's Provenance). */
export interface LiveProvenance {
  kind: 'archive' | 'derived' | 'prd-reported' | 'live' | 'rehearsal';
  solverRevision: string;
  units: string;
  coverage: { description: string; tStart?: number | null; tEnd?: number | null };
  runtime: string;
  verification: { outcome: 'passed' | 'failed' | 'blocked' | 'not-applicable'; details: string };
  sources: { label: string; url: string; sha256: string; path?: string }[];
}
/** live-status `$defs/archiveVerdict`: `transport.compare.compare_window(live, archive, window)` for one archive trace. */
export type LiveVerdict = 'agree' | 'disagree' | 'inconclusive' | 'no claim';
export interface LiveArchiveVerdict {
  code: 'stella' | 'GENE';
  /** Archive time-weighted mean on the window. */
  mean: number | null;
  stderr: number | null;
  /** Live mean minus archive mean; null when either is missing. */
  delta: number | null;
  verdict: LiveVerdict;
  reason: string;
}
/** live-status `$defs/comparisonWindow`. `covered: false` ⇒ mean/stderr/nEff/nEffLower/stationary null and no claim. */
export interface LiveComparisonWindow {
  window: [number, number];
  covered: boolean;
  /** Live samples inside the window. */
  nSamples: number;
  mean: number | null;
  stderr: number | null;
  /** The stderr is a lower bound (N_eff at the tau upper bound below 20, or not established). */
  stderrApproximate: boolean;
  nEff: number | null;
  /** N_eff at the one-sigma tau upper bound: the value the >= 20 gate uses. */
  nEffLower: number | null;
  /** null = undecidable. */
  stationary: boolean | null;
  /** The live trace's own gate on this window. */
  saturatedClaimAllowed: boolean;
  detail: string;
  /** Exactly two: stella, then GENE. */
  archive: [LiveArchiveVerdict & { code: 'stella' }, LiveArchiveVerdict & { code: 'GENE' }];
}
/** live-status `comparison` (D-024): this session's bean samples against the archived stella and GENE traces. */
export interface LiveComparison {
  tube: 'bean';
  nSamples: number;
  tStart: number | null;
  tEnd: number | null;
  marginFraction: number;
  method: string;
  saturatedClaimAllowed: boolean;
  reason: string;
  /** 200–300 then 300–400, or empty when the comparison could not be computed. */
  windows: [] | [LiveComparisonWindow, LiveComparisonWindow];
}
export interface LiveStatus {
  schemaVersion: 1;
  mode: LiveMode;
  reason: string;
  qualified?: boolean;
  budget: { ceilingUsd: number; billedUsd: number; pendingUsd: number; slotEstimateUsd: number; slotFits: boolean; hardTimeoutS?: number };
  workers: LiveWorker[];
  fallback: { active: boolean; label: string; savedRunId: string | null };
  provenance?: LiveProvenance;
  /** Optional, never null: present on every snapshot of a session, absent without one (D-024). */
  comparison?: LiveComparison;
}

/** contracts/live-run.schema.json (GET /api/live/runs/<savedRunId>). */
export interface SavedRun {
  savedRunId: string;
  initVerified: boolean;
  continuationVerified: boolean;
  checks: { init: boolean; continuation: boolean; distinctDevices: boolean; overlap: boolean };
  phases: LiveStatus[];
}

export const LIVE_MODES: readonly LiveMode[] = ['unavailable', 'idle', 'launching', 'live', 'fallback', 'terminated'];
/**
 * A saved run id exactly as the server serves it: main/labyrinth_main/features/live_gx/service.py RUN_ID and
 * server/app.py RUN_PATH. Checked on `fallback.savedRunId` and on the run itself; no other id is ever requested.
 */
export const SAVED_RUN_ID = /^(rehearsal|live)-[0-9a-f]{12}$/;

/* ---- tiny schema checker ------------------------------------------------------------------- */
type Check = (value: unknown, path: string) => string | null;

const describe = (v: unknown) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' && !Number.isInteger(v) ? String(v) : typeof v;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const str: Check = (v, p) => (typeof v === 'string' ? null : `${p}: expected a string, got ${describe(v)}`);
const bool: Check = (v, p) => (typeof v === 'boolean' ? null : `${p}: expected a boolean, got ${describe(v)}`);
/**
 * Finite numbers only, deliberately stricter than the schemas: JSON Schema's "number" (and "integer") has no
 * notion of finiteness, so ajv accepts 1e400, which JSON.parse turns into Infinity. The backend never emits it
 * (json.dumps(..., allow_nan=False)); a body that carries it is rejected here. liveContract.test.ts pins this.
 */
const num: Check = (v, p) => (typeof v === 'number' && Number.isFinite(v) ? null : `${p}: expected a finite number, got ${describe(v)}`);
const int: Check = (v, p) => (typeof v === 'number' && Number.isInteger(v) ? null : `${p}: expected an integer, got ${describe(v)}`);
/** `{ "type": "integer", "minimum": 0 }`. */
const count: Check = (v, p) => int(v, p) ?? ((v as number) < 0 ? `${p}: expected an integer >= 0, got ${String(v)}` : null);
const isNull: Check = (v, p) => (v === null ? null : `${p}: expected null, got ${describe(v)}`);
const nullable =
  (inner: Check): Check =>
  (v, p) =>
    v === null ? null : inner(v, p);
const oneOf =
  (allowed: readonly unknown[]): Check =>
  (v, p) =>
    allowed.includes(v) ? null : `${p}: expected one of ${allowed.map((a) => JSON.stringify(a)).join(', ')}, got ${JSON.stringify(v) ?? describe(v)}`;
const matching =
  (re: RegExp): Check =>
  (v, p) =>
    typeof v === 'string' && re.test(v) ? null : `${p}: expected a string matching ${re.source}`;

/** An object with `additionalProperties: false` (every object in both contracts is closed). */
function object(required: Record<string, Check>, optional: Record<string, Check> = {}): Check {
  return (v, p) => {
    if (!isRecord(v)) return `${p}: expected an object, got ${describe(v)}`;
    for (const key of Object.keys(required)) {
      if (!Object.hasOwn(v, key)) return `${p}: missing required property "${key}"`;
    }
    for (const key of Object.keys(v)) {
      const check = Object.hasOwn(required, key) ? required[key] : Object.hasOwn(optional, key) ? optional[key] : undefined;
      if (!check) return `${p}: unexpected property "${key}"`;
      const problem = check(v[key], `${p}.${key}`);
      if (problem) return problem;
    }
    return null;
  };
}

function array(item: Check, limits: { min?: number; max?: number } = {}): Check {
  return (v, p) => {
    if (!Array.isArray(v)) return `${p}: expected an array, got ${describe(v)}`;
    if (limits.min !== undefined && v.length < limits.min) return `${p}: expected at least ${limits.min} item(s), got ${v.length}`;
    if (limits.max !== undefined && v.length > limits.max) return `${p}: expected at most ${limits.max} item(s), got ${v.length}`;
    for (let i = 0; i < v.length; i++) {
      const problem = item(v[i], `${p}[${i}]`);
      if (problem) return problem;
    }
    return null;
  };
}

/** `prefixItems` + `items: false` (and min = max = the prefix length): exactly these items, in this order. */
function tuple(items: readonly Check[]): Check {
  return (v, p) => {
    if (!Array.isArray(v)) return `${p}: expected an array, got ${describe(v)}`;
    if (v.length !== items.length) return `${p}: expected exactly ${items.length} item(s), got ${v.length}`;
    for (const [i, check] of items.entries()) {
      const problem = check(v[i], `${p}[${i}]`);
      if (problem) return problem;
    }
    return null;
  };
}

/* ---- contracts/common.schema.json#/$defs/provenance ------------------------------------------ */
const provenance = object({
  kind: oneOf(['archive', 'derived', 'prd-reported', 'live', 'rehearsal']),
  solverRevision: str,
  units: str,
  coverage: object({ description: str }, { tStart: nullable(num), tEnd: nullable(num) }),
  runtime: str,
  verification: object({ outcome: oneOf(['passed', 'failed', 'blocked', 'not-applicable']), details: str }),
  sources: array(object({ label: str, url: str, sha256: matching(/^[0-9a-f]{64}$|^n\/a$/) }, { path: str })),
});

/* ---- contracts/common.schema.json#/$defs/window: [lo, hi] (the schema cannot order them; neither does this) */
const timeWindow = array(num, { min: 2, max: 2 });

/* ---- contracts/live-status.schema.json `comparison` (D-024) ----------------------------------- */
export const LIVE_VERDICTS: readonly LiveVerdict[] = ['agree', 'disagree', 'inconclusive', 'no claim'];

/** `$defs/archiveVerdict` with the `code` const its prefixItems slot adds. */
const archiveVerdict = (code: LiveArchiveVerdict['code']) =>
  object({ code: oneOf([code]), mean: nullable(num), stderr: nullable(num), delta: nullable(num), verdict: oneOf(LIVE_VERDICTS), reason: str });

const comparisonWindowShape = object({
  window: timeWindow,
  covered: bool,
  nSamples: count,
  mean: nullable(num),
  stderr: nullable(num),
  stderrApproximate: bool,
  nEff: nullable(num),
  nEffLower: nullable(num),
  stationary: nullable(bool),
  saturatedClaimAllowed: bool,
  detail: str,
  archive: tuple([archiveVerdict('stella'), archiveVerdict('GENE')]),
});

/** The fields the schema's `if covered: false / then` forces to null. */
const NULL_WHEN_UNCOVERED = ['mean', 'stderr', 'nEff', 'nEffLower', 'stationary'] as const;

/** `$defs/comparisonWindow`, its `if/then` included: a window that is not covered has no statistics and no claim. */
const comparisonWindow: Check = (v, p) => {
  const problem = comparisonWindowShape(v, p);
  if (problem) return problem;
  const w = v as Record<string, unknown>;
  if (w.covered !== false) return null;
  for (const key of NULL_WHEN_UNCOVERED) {
    const field = isNull(w[key], `${p}.${key}`);
    if (field) return `${field} (window not covered)`;
  }
  return w.saturatedClaimAllowed === false ? null : `${p}.saturatedClaimAllowed: expected false, got true (window not covered)`;
};

/** `maxItems: 2` and `anyOf [maxItems 0, minItems 2]`: none or both PRD windows. */
const comparisonWindows: Check = (v, p) => {
  const problem = array(comparisonWindow, { max: 2 })(v, p);
  if (problem) return problem;
  return (v as unknown[]).length === 1 ? `${p}: expected 0 or 2 items, got 1` : null;
};

/** Optional and closed; `null` is not allowed (the field is absent without a session, never null). */
const comparison = object({
  tube: oneOf(['bean']),
  nSamples: count,
  tStart: nullable(num),
  tEnd: nullable(num),
  marginFraction: num,
  method: str,
  saturatedClaimAllowed: bool,
  reason: str,
  windows: comparisonWindows,
});

/* ---- contracts/live-status.schema.json ------------------------------------------------------- */
const liveStatus = object(
  {
    schemaVersion: oneOf([1]),
    mode: oneOf(LIVE_MODES),
    reason: str,
    budget: object(
      { ceilingUsd: num, billedUsd: num, pendingUsd: num, slotEstimateUsd: num, slotFits: bool },
      { hardTimeoutS: int },
    ),
    workers: array(
      object(
        {
          gpuIndex: oneOf([0, 1]),
          deviceId: str,
          tube: oneOf(['bean', 'triangular']),
          state: oneOf(['pending', 'initializing', 'running', 'checkpointed', 'failed', 'done']),
          simTime: nullable(num),
          samples: array(object({ t: num, Q: num })),
        },
        { wallStart: nullable(str), error: nullable(str) },
      ),
      { max: 2 },
    ),
    fallback: object({ active: bool, label: str, savedRunId: nullable(matching(SAVED_RUN_ID)) }),
  },
  { qualified: bool, provenance, comparison },
);

/* ---- contracts/live-run.schema.json (closed at every level since D-023 item 6) -------------- */
const savedRun = object({
  savedRunId: matching(SAVED_RUN_ID),
  initVerified: bool,
  continuationVerified: bool,
  checks: object({ init: bool, continuation: bool, distinctDevices: bool, overlap: bool }),
  phases: array(liveStatus, { min: 1, max: 2 }),
});

/** `null` when `body` is a valid live-status snapshot, otherwise the first problem ("$.fallback: missing …"). */
export function validateLiveStatus(body: unknown): string | null {
  return liveStatus(body, '$');
}

/** `null` when `body` is a valid saved rehearsal run, otherwise the first problem. */
export function validateSavedRun(body: unknown): string | null {
  return savedRun(body, '$');
}
