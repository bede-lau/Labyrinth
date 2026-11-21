import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Callout, Panel, ProvenanceBadge, StatusPill, formatNumber, formatWindow } from '../../design';
import { useArtifact } from '../../lib/artifacts';
import { useLiveStatus } from '../../lib/liveStatus';
import { ForecastChart } from './ForecastChart';
import { INITIAL, advance, nextAction, replayPillText, runningMae, type ForecastArtifact, type ReplayState } from './model';
import './forecast.css';

export function ForecastView({ livePollMs = 5000 }: { livePollMs?: number } = {}) {
  const state = useArtifact<ForecastArtifact>('forecast');
  const replay = replayPillText(useLiveStatus(livePollMs));
  if (state.status === 'loading') return <Panel title="Loading forecast replay…"><p>Reading saved windows…</p></Panel>;
  if (state.status === 'error') return (
    <Panel title="Forecast replay could not be loaded">
      <Callout tone="warn" title={`${state.file} failed to load`}>{state.message}</Callout>
    </Panel>
  );
  return <Replay artifact={state.data} replay={replay} />;
}

function Replay({ artifact, replay }: { artifact: ForecastArtifact; replay: string }) {
  const { steps } = artifact;
  const [state, setState] = useState<ReplayState | null>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const count = steps.length;
  const action = nextAction(state ?? INITIAL, count);
  const window = state && steps[state.index] ? formatWindow(steps[state.index]!.window) : '';
  const button = !state ? 'Start replay' : { predict: 'Predict', reveal: 'Reveal observed', update: 'Update', done: 'Replay complete' }[action];
  const scored = state ? state.index : count;
  const mae = runningMae(steps, scored);

  return (
    <Panel title={`${formatNumber(artifact.windowWidth, 0)}-unit mean heat flux`}
      subtitle="stella · Bean tube"
      status={<div className="fc-badges">
        <StatusPill status="replay">{replay}</StatusPill>
        <ProvenanceBadge provenance={artifact.provenance} subject="forecast replay" />
      </div>}>
      {count === 0 ? <Callout tone="blocked" title="No forecast windows in artifacts/forecast.json">No saved windows to replay.</Callout> : <>
        <ForecastChart steps={steps} replay={state} />
        <div className="fc-tools">
          <div className="fc-buttons">
            <button ref={primary} type="button" className="fc-btn fc-btn--primary" disabled={action === 'done'} onClick={() => setState(s => advance(s ?? INITIAL, count))}>{button}</button>
            {state && <button type="button" className="fc-btn" onClick={() => { flushSync(() => setState(null)); primary.current?.focus(); }}>Show all windows</button>}
          </div>
          <span role="status" className="fc-progress">{!state ? `${count} windows` : action === 'done' ? `${count} windows scored` : `Window ${state.index + 1}/${count} · ${window}`}</span>
        </div>
        {mae && <p className="fc-mae" aria-label="Mean absolute error">Mean absolute error
          <span>Persistence <b>{formatNumber(mae.persistence, 4)}</b></span>
          <span>Frozen <b>{formatNumber(mae.frozen, 4)}</b></span>
        </p>}
      </>}
    </Panel>
  );
}
