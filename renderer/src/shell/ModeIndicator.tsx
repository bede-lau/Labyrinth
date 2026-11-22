import { useState } from 'react';
import { Alert } from '../design';
import { liveDanger, sendTerminate, type LiveState, type TerminateAnswer } from '../lib/liveStatus';

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
