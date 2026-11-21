import { useState } from 'react';
import { Alert, StatusPill, type StatusKind } from '../design';
import { liveDanger, modePills, sendTerminate, type LiveDanger, type LiveState, type TerminateAnswer } from '../lib/liveStatus';

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

/** Stop the current session and display the backend acknowledgement on any route. */
function HeaderTerminate({ retry }: { retry: boolean }) {
  const [sending, setSending] = useState(0);
  const [answer, setAnswer] = useState<TerminateAnswer | null>(null);
  const send = async () => {
    setSending((n) => n + 1);
    try {
      setAnswer(await sendTerminate());
    } finally {
      setSending((n) => n - 1);
    }
  };
  const again = retry || (answer !== null && !answer.confirmed);
  return (
    <span className="shell-alert__terminate">
      <button type="button" className="shell-alert__button" aria-busy={sending > 0} onClick={send}>
        {sending > 0 ? 'Terminating… (send again)' : again ? 'Retry terminate' : 'Terminate'}
      </button>
      {answer && (
        <span role="status" aria-label="Terminate answer">
          {answer.confirmed ? `Terminate confirmed: ${answer.reason}` : `Terminate not confirmed: ${answer.reason}`}
        </span>
      )}
    </span>
  );
}

/** Keep termination available during active sessions and uncertain shutdowns. */
export function ModeAlert({ state }: { state: LiveState }) {
  const danger = liveDanger(state);
  if (!danger) {
    if (state.status === 'ready' && ['launching', 'live'].includes(state.data.mode)) {
      return <div className="shell-alert" role="status">Modal session active <HeaderTerminate retry={false} /></div>;
    }
    return null;
  }
  const action = <HeaderTerminate retry={danger.kind === 'terminate-failed'} />;
  return (
    <Alert className="shell-alert" title={danger.title} reason={danger.detail} action={action}>
      Check the Modal dashboard until both workers are confirmed stopped.
    </Alert>
  );
}
