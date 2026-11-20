import { Alert, StatusPill, type StatusKind } from '../design';
import { liveDanger, modePills, type LiveDanger, type LiveState } from '../lib/liveStatus';
import { hrefFor, type RouteId } from './routes';

export interface ModePill {
  status: StatusKind;
  text: string;
}

export interface ModeView {
  pills: ModePill[];
  /** One plain sentence: why the app is in this mode. */
  detail: string;
  /** A failed, pending or merely requested termination, or a lost connection to a session that may be billing. */
  danger: LiveDanger | null;
}

const DANGER_DETAIL: Record<LiveDanger['kind'], string> = {
  'terminate-failed': 'Termination is not confirmed: GPUs may still be billing.',
  'termination-pending': 'Termination is not confirmed: GPUs may still be billing.',
  'stop-unconfirmed': 'A stop was requested and is not confirmed yet: GPUs may still be billing.',
  'connection-lost': 'The live API stopped answering during a session: its state is unknown.',
};

function detailFor(state: LiveState, danger: LiveDanger | null): string {
  if (danger) return DANGER_DETAIL[danger.kind];
  if (state.status === 'connecting') return 'Checking for a live backend…';
  if (state.status === 'unreachable') {
    if (state.cause === 'stale') return `The last status is too old to show (${state.message}); asking the live API again.`;
    return state.cause === 'invalid'
      ? 'The live API answered with an invalid status; it is ignored and every view plays saved evidence.'
      : 'No live backend reachable: every view plays saved evidence.';
  }
  const { mode, reason, fallback } = state.data;
  return reason || (mode === 'fallback' && fallback.label) || `Live backend mode: ${mode}.`;
}

/**
 * DESIGN.md §5: map /api/live/status to the global indicator. LIVE appears only when the backend
 * itself reports mode "live" on a valid, current answer; connecting, unreachable and every other mode
 * are replay. A danger state leads with the billing-risk pill in every mode.
 * The pill mapping lives in lib/liveStatus.ts so the live panel shows the same thing.
 */
export function modeView(state: LiveState): ModeView {
  const danger = liveDanger(state);
  return { pills: modePills(state), detail: detailFor(state, danger), danger };
}

export function ModeIndicator({ state }: { state: LiveState }) {
  const view = modeView(state);
  return (
    <div
      className="shell-mode"
      role="status"
      aria-live="polite"
      data-danger={view.danger?.kind}
      aria-label={`Mode: ${view.pills.map((p) => p.text).join(', ')}. ${view.detail}`}
    >
      <span className="shell-mode__pills">
        {view.pills.map((p) => (
          <StatusPill key={`${p.status}:${p.text}`} status={p.status} size="md">
            {p.text}
          </StatusPill>
        ))}
      </span>
      <span className="shell-mode__detail">{view.detail}</span>
    </div>
  );
}

/**
 * The loud part, on every route: the design system's Alert (DESIGN.md §5) under the header while
 * GPUs may still be billing — a termination failed, pending or only requested, or a session that may
 * be billing cannot be reached. It quotes the backend's reason verbatim. Renders nothing otherwise.
 */
export function ModeAlert({ state, route }: { state: LiveState; route: RouteId }) {
  const danger = liveDanger(state);
  if (!danger) return null;
  return (
    <Alert
      className="shell-alert"
      title={danger.title}
      reason={danger.detail}
      action={
        route === 'advance' ? (
          <span>Use Terminate in the Advance plasma panel below.</span>
        ) : (
          <a href={hrefFor('advance')}>Open Advance plasma to send Terminate</a>
        )
      }
    >
      Check the Modal dashboard until both workers are confirmed stopped.
    </Alert>
  );
}
