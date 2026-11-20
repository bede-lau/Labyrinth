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
export interface LiveStatus {
  schemaVersion: 1;
  mode: LiveMode;
  reason: string;
  qualified?: boolean;
  budget: { ceilingUsd: number; billedUsd: number; pendingUsd: number; slotEstimateUsd: number; slotFits: boolean; hardTimeoutS?: number };
  workers: LiveWorker[];
  fallback: { active: boolean; label: string; savedRunId: string | null };
  provenance?: LiveProvenance;
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
export const SAVED_RUN_ID = /^[A-Za-z0-9_.-]{1,80}$/;

/* ---- tiny schema checker ------------------------------------------------------------------- */
type Check = (value: unknown, path: string) => string | null;

const describe = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const str: Check = (v, p) => (typeof v === 'string' ? null : `${p}: expected a string, got ${describe(v)}`);
const bool: Check = (v, p) => (typeof v === 'boolean' ? null : `${p}: expected a boolean, got ${describe(v)}`);
const num: Check = (v, p) => (typeof v === 'number' && Number.isFinite(v) ? null : `${p}: expected a number, got ${describe(v)}`);
const int: Check = (v, p) => (typeof v === 'number' && Number.isInteger(v) ? null : `${p}: expected an integer, got ${describe(v)}`);
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
    fallback: object({ active: bool, label: str, savedRunId: nullable(str) }),
  },
  { qualified: bool, provenance },
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
