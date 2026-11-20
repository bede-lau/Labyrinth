// Live GX status from the main process (GET /api/live/status, contract: live-status.schema.json).
// With no backend reachable (static replay build) the app runs in REPLAY mode — never fake LIVE.
import { useEffect, useState } from 'react';

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
export interface LiveStatus {
  schemaVersion: 1;
  mode: LiveMode;
  reason: string;
  qualified?: boolean;
  budget: { ceilingUsd: number; billedUsd: number; pendingUsd: number; slotEstimateUsd: number; slotFits: boolean; hardTimeoutS?: number };
  workers: LiveWorker[];
  fallback: { active: boolean; label: string; savedRunId: string | null };
}

export type LiveState = { status: 'connecting' } | { status: 'unreachable'; message: string } | { status: 'ready'; data: LiveStatus };

/** True only when the backend itself reports live — the single source for any LIVE indicator. */
export function isLive(s: LiveState): boolean {
  return s.status === 'ready' && s.data.mode === 'live';
}

export async function fetchLiveStatus(fetchImpl: typeof fetch = fetch): Promise<LiveStatus> {
  const res = await fetchImpl('/api/live/status', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`/api/live/status: HTTP ${res.status}`);
  const body = (await res.json()) as LiveStatus;
  if (body?.schemaVersion !== 1 || typeof body.mode !== 'string') throw new Error('/api/live/status: bad payload');
  return body;
}

export function useLiveStatus(intervalMs = 2000, fetchImpl: typeof fetch = fetch): LiveState {
  const [state, setState] = useState<LiveState>({ status: 'connecting' });
  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetchLiveStatus(fetchImpl).then(
        (data) => alive && setState({ status: 'ready', data }),
        (err: unknown) => alive && setState({ status: 'unreachable', message: err instanceof Error ? err.message : String(err) }),
      );
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs, fetchImpl]);
  return state;
}
