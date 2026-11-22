import { useEffect, useState } from 'react';
import { useViewActive } from '../../lib/viewActive';
import { Callout, Panel } from '../../design';
import { useArtifact } from '../../lib/artifacts';
import { ForecastChart } from './ForecastChart';
import { INITIAL, advance, nextAction, type ForecastArtifact, type ReplayState } from './model';
import './forecast.css';

export function ForecastView() {
  const state = useArtifact<ForecastArtifact>('forecast');
  if (state.status === 'loading') return <Panel title="Loading forecast…" />;
  if (state.status === 'error') {
    return (
      <Panel title="Forecast unavailable">
        <Callout tone="warn" title={`${state.file} failed to load`}>{state.message}</Callout>
      </Panel>
    );
  }
  return <Replay artifact={state.data} />;
}

function Replay({ artifact }: { artifact: ForecastArtifact }) {
  const [state, setState] = useState<ReplayState | null>(null);
  const active = useViewActive();
  const [playing, setPlaying] = useState(false);
  const windows = artifact.steps.length;
  const action = state ? nextAction(state, windows) : 'done';

  useEffect(() => {
    if (!active || !playing || !state || action === 'done') return;
    // Let the predicted point stand on its own before revealing the observation.
    const delay = action === 'reveal' ? 420 : action === 'update' ? 280 : 100;
    const timer = window.setTimeout(() => {
      const next = advance(state, windows);
      setState(next);
      if (nextAction(next, windows) === 'done') setPlaying(false);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [active, action, playing, state, windows]);

  const restart = action === 'done';
  const stepLabel = { predict: 'Predict', reveal: 'Reveal observed', update: 'Update', done: 'Start replay' }[action];
  const step = () => setState(current => advance(!current || restart ? INITIAL : current, windows));
  const togglePlayback = () => {
    if (playing) {
      setPlaying(false);
    } else {
      // In absolute-error mode the first point appears after the first Reveal.
      if (restart) step();
      setPlaying(true);
    }
  };

  return (
    <Panel title="Mean heat flux">
      {windows === 0 ? <p>No saved windows</p> : (
        <>
          <div className="fc-tools">
            <div className="fc-buttons">
              <button type="button" className="fc-btn fc-btn--primary" onClick={togglePlayback}>
                {playing ? 'Pause' : 'Run to end'}
              </button>
              <button type="button" className="fc-btn" disabled={playing} onClick={step}>{stepLabel}</button>
            </div>
            <span role="status" aria-label="Windows revealed" className="fc-progress">
              {state ? state.index + Number(state.phase === 'revealed') : windows} / {windows}
            </span>
          </div>
          <ForecastChart artifact={artifact} replay={state} />
        </>
      )}
    </Panel>
  );
}
