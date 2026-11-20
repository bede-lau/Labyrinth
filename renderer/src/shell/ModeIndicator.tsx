import { StatusPill, type StatusKind } from '../design';
import { isLive, type LiveState } from '../lib/liveStatus';

export interface ModePill {
  status: StatusKind;
  text: string;
}

export interface ModeView {
  pills: ModePill[];
  /** One plain sentence: why the app is in this mode. */
  detail: string;
}

/**
 * DESIGN.md §5: map /api/live/status to the global indicator. LIVE appears only when the backend
 * itself reports mode "live" (isLive); connecting, unreachable and every other mode are replay.
 */
export function modeView(state: LiveState): ModeView {
  if (isLive(state) && state.status === 'ready') {
    return { pills: [{ status: 'live', text: 'LIVE · GPU 0 / GPU 1' }], detail: state.data.reason || 'GX workers are reporting.' };
  }
  if (state.status === 'connecting') {
    return { pills: [{ status: 'replay', text: 'Replay · $0' }], detail: 'Checking for a live backend…' };
  }
  if (state.status === 'unreachable') {
    return {
      pills: [{ status: 'replay', text: 'Replay · $0' }],
      detail: 'No live backend reachable: every view plays saved evidence.',
    };
  }
  const { mode, reason } = state.data;
  if (mode === 'fallback') {
    return {
      pills: [
        { status: 'failed', text: 'Worker failed' },
        { status: 'replay', text: 'Playing saved run' },
      ],
      detail: reason || state.data.fallback.label,
    };
  }
  if (mode === 'launching') {
    return { pills: [{ status: 'rehearsal', text: 'Launching…' }], detail: reason || 'Not live until workers report.' };
  }
  return { pills: [{ status: 'replay', text: 'Replay · $0' }], detail: reason || `Live backend mode: ${mode}.` };
}

export function ModeIndicator({ state }: { state: LiveState }) {
  const view = modeView(state);
  return (
    <div className="shell-mode" role="status" aria-live="polite" aria-label={`Mode: ${view.pills.map((p) => p.text).join(', ')}. ${view.detail}`}>
      <span className="shell-mode__pills">
        {view.pills.map((p) => (
          <StatusPill key={p.text} status={p.status} size="md">
            {p.text}
          </StatusPill>
        ))}
      </span>
      <span className="shell-mode__detail">{view.detail}</span>
    </div>
  );
}
