import { Icon, StatusPill, type StatusKind } from '../design';
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
  /** A failed or pending termination, or a lost connection to a session that was not idle. */
  danger: LiveDanger | null;
}

function detailFor(state: LiveState, danger: LiveDanger | null): string {
  if (danger) {
    return danger.kind === 'connection-lost'
      ? 'The live API stopped answering during a session: its state is unknown.'
      : 'Termination is not confirmed: GPUs may still be billing.';
  }
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
 * are replay. A termination problem or a lost session leads with a failed pill in every mode.
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
 * The loud part, on every route: a full-width `role="alert"` under the header while a termination is
 * failed or pending, or while a session that was not idle cannot be reached. Renders nothing otherwise.
 */
export function ModeAlert({ state, route }: { state: LiveState; route: RouteId }) {
  const danger = liveDanger(state);
  if (!danger) return null;
  return (
    <div className="shell-alert" role="alert" data-kind={danger.kind}>
      <Icon name="alert" size={20} className="shell-alert__icon" />
      <div className="shell-alert__text">
        <p className="shell-alert__title">{danger.title}</p>
        <p className="shell-alert__body">{danger.detail}</p>
        <p className="shell-alert__action">
          {route === 'advance' ? (
            'Use Terminate on this page'
          ) : (
            <a className="shell-alert__link" href={hrefFor('advance')}>
              Open Advance plasma to send Terminate
            </a>
          )}
          , and check the Modal dashboard until both workers are confirmed stopped.
        </p>
      </div>
    </div>
  );
}
