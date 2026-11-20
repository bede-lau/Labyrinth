// Forecast replay (task 03, F4–F5): Predict -> Reveal -> Update over eight 50-unit windows of the
// archived stella bean trace. Observed means stay hidden until revealed; running MAE for persistence
// and frozen; final computed vs PRD-claimed scores with the mismatch flag and the D-016 note.
import { useRef, useState } from 'react';
import {
  Callout,
  FixtureCheck,
  Panel,
  ProvenanceBadge,
  Stat,
  StatusPill,
  Unit,
  formatNumber,
  formatWindow,
} from '../../design';
import { useArtifact } from '../../lib/artifacts';
import {
  INITIAL,
  advance,
  nextAction,
  parseSampleAndHold,
  runningMae,
  scoredCount,
  visibility,
  type ForecastArtifact,
  type ReplayState,
} from './model';
import './forecast.css';

const FLUX_UNIT = 'Q_{gB,i}';
const TIME_UNIT = 'a/v_{th,i}';
const MEAN_DP = 3;
const ERR_DP = 4;

export function ForecastView() {
  const state = useArtifact<ForecastArtifact>('forecast');
  if (state.status === 'loading') {
    return (
      <Panel eyebrow="Forecast replay" title="Loading forecast replay…">
        <p className="fc-muted">Reading artifacts/forecast.json.</p>
      </Panel>
    );
  }
  if (state.status === 'error') {
    return (
      <Panel eyebrow="Forecast replay" title="Forecast replay could not be loaded">
        <Callout tone="warn" title={`${state.file} failed to load`}>
          {state.message}
        </Callout>
      </Panel>
    );
  }
  return <ForecastBody a={state.data} />;
}

const STAGES = [
  { id: 'predict', label: 'Predict' },
  { id: 'reveal', label: 'Reveal' },
  { id: 'update', label: 'Update' },
] as const;

/** A value that exists but is deliberately not shown yet (never "not available", never 0). */
function Pending({ label, text }: { label: string; text: string }) {
  return (
    <div className="fc-hidden" role="group" aria-label={`${label}: ${text.toLowerCase()}`}>
      <div className="fc-hidden__label">{label}</div>
      <div className="fc-hidden__value">{text}</div>
    </div>
  );
}

function ForecastBody({ a }: { a: ForecastArtifact }) {
  const [s, setS] = useState<ReplayState>(INITIAL);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const n = a.steps.length;
  const action = nextAction(s, n);
  const current = a.steps[Math.min(s.index, n - 1)];
  const scored = scoredCount(s);
  const mae = runningMae(a.steps, scored);
  const vis = visibility(s, s.index);
  const sah = parseSampleAndHold(a.fixtures.find((f) => f.note)?.note);
  const persistenceFixture = a.fixtures.find((f) => f.id === 'mae-persistence');
  const frozenFixture = a.fixtures.find((f) => f.id === 'mae-frozen');

  const curWin = current ? formatWindow(current.window) : '';
  const buttonText =
    action === 'predict'
      ? `Predict ${curWin}`
      : action === 'reveal'
        ? `Reveal observed ${curWin}`
        : action === 'update'
          ? `Update forecasts${s.index + 1 < n ? ` → ${formatWindow(a.steps[s.index + 1]!.window)}` : ' (score last window)'}`
          : 'Replay complete';

  const announce =
    action === 'done'
      ? `Replay complete. All ${n} windows scored.`
      : `Window ${s.index + 1} of ${n}, t ${curWin}: ` +
        (s.phase === 'ready'
          ? 'nothing predicted yet.'
          : s.phase === 'predicted'
            ? `persistence forecast ${formatNumber(current!.persistence, MEAN_DP)}, frozen forecast ${formatNumber(current!.frozen, MEAN_DP)}; observed hidden.`
            : `observed ${formatNumber(current!.observed, MEAN_DP)}; absolute errors ${formatNumber(current!.absErrPersistence, ERR_DP)} persistence, ${formatNumber(current!.absErrFrozen, ERR_DP)} frozen.`);

  const stageIndex = action === 'predict' ? 0 : action === 'reveal' ? 1 : action === 'update' ? 2 : 3;

  return (
    <div className="fc-view">
      <Panel
        eyebrow="Forecast replay"
        title="Predict the next 50-unit mean of the stella bean flux"
        subtitle={`Initialised on ${formatWindow(a.initWindow)}; ${n} windows from ${formatWindow([a.steps[0]!.window[0], a.steps[n - 1]!.window[1]])}. Replayed archive data, not live.`}
        status={
          <div className="fc-badges">
            <StatusPill status="replay">Replay · $0</StatusPill>
            <ProvenanceBadge provenance={a.provenance} subject="forecast replay" />
          </div>
        }
        footer={
          <details className="fc-details">
            <summary>Method (from the artifact)</summary>
            <p>{a.method}</p>
          </details>
        }
      >
        <div className="fc-controls">
          <ol className="fc-stages" aria-label="Replay stage">
            {STAGES.map((st, i) => (
              <li key={st.id} aria-current={i === stageIndex ? 'step' : undefined} data-done={i < stageIndex}>
                <span className="fc-stages__n lab-num" aria-hidden="true">
                  {i + 1}
                </span>
                {st.label}
              </li>
            ))}
          </ol>
          <div className="fc-buttons">
            <button
              ref={primaryRef}
              type="button"
              className="fc-btn fc-btn--primary"
              onClick={() => setS((x) => advance(x, n))}
              disabled={action === 'done'}
            >
              {buttonText}
            </button>
            <button
              type="button"
              className="fc-btn"
              onClick={() => {
                setS(INITIAL);
                primaryRef.current?.focus();
              }}
              disabled={s.index === 0 && s.phase === 'ready'}
            >
              Reset
            </button>
          </div>
        </div>
        <p className="fc-live" role="status" aria-live="polite" data-testid="announce">
          {announce}
        </p>

        {current && action !== 'done' && (
          <div className="fc-current" aria-label={`Current window t ${curWin}`} role="group">
            {vis.forecasts ? (
              <>
                <Stat
                  label="Persistence forecast"
                  value={current.persistence}
                  unit={FLUX_UNIT}
                  decimals={MEAN_DP}
                  window={current.window}
                  windowUnit={TIME_UNIT}
                />
                <Stat
                  label="Frozen forecast"
                  value={current.frozen}
                  unit={FLUX_UNIT}
                  decimals={MEAN_DP}
                  window={current.window}
                  windowUnit={TIME_UNIT}
                />
              </>
            ) : (
              <>
                <Pending label="Persistence forecast" text="Not predicted yet" />
                <Pending label="Frozen forecast" text="Not predicted yet" />
              </>
            )}
            {vis.observed ? (
              <Stat
                label="Observed (archive)"
                value={current.observed}
                unit={FLUX_UNIT}
                decimals={MEAN_DP}
                window={current.window}
                windowUnit={TIME_UNIT}
                status={<StatusPill status="archive" />}
              />
            ) : (
              <Pending label="Observed (archive)" text="Hidden until revealed" />
            )}
          </div>
        )}

        <div className="fc-mae" role="group" aria-label="Running mean absolute error">
          {mae ? (
            <>
              <Stat label="Running MAE · persistence" value={mae.persistence} unit={FLUX_UNIT} decimals={ERR_DP} note={`after ${scored} of ${n} windows`} />
              <Stat label="Running MAE · frozen" value={mae.frozen} unit={FLUX_UNIT} decimals={ERR_DP} note={`after ${scored} of ${n} windows`} />
            </>
          ) : (
            <>
              <Pending label="Running MAE · persistence" text="Not scored yet (first Update)" />
              <Pending label="Running MAE · frozen" text="Not scored yet (first Update)" />
            </>
          )}
        </div>

        <div className="fc-table-wrap" role="region" aria-label="Forecast steps table" tabIndex={0}>
          <table className="fc-table">
            <caption className="lab-visually-hidden">
              Forecast steps: window, both forecasts, observed mean and absolute errors. Values appear as they are
              predicted and revealed.
            </caption>
            <thead>
              <tr>
                <th scope="col">Window (t)</th>
                <th scope="col" className="fc-num">Persistence</th>
                <th scope="col" className="fc-num">Frozen</th>
                <th scope="col" className="fc-num">Observed</th>
                <th scope="col" className="fc-num">|err| persistence</th>
                <th scope="col" className="fc-num">|err| frozen</th>
              </tr>
            </thead>
            <tbody>
              {a.steps.map((st, i) => {
                const v = visibility(s, i);
                const hiddenObs = v.forecasts && !v.observed;
                return (
                  <tr key={i} aria-current={i === s.index && action !== 'done' ? 'step' : undefined} data-testid={`step-${i}`}>
                    <th scope="row" className="lab-num">{formatWindow(st.window)}</th>
                    <td className="fc-num lab-num">{v.forecasts ? formatNumber(st.persistence, MEAN_DP) : '—'}</td>
                    <td className="fc-num lab-num">{v.forecasts ? formatNumber(st.frozen, MEAN_DP) : '—'}</td>
                    <td className="fc-num lab-num">{v.observed ? formatNumber(st.observed, MEAN_DP) : hiddenObs ? 'hidden' : '—'}</td>
                    <td className="fc-num lab-num">{v.observed ? formatNumber(st.absErrPersistence, ERR_DP) : '—'}</td>
                    <td className="fc-num lab-num">{v.observed ? formatNumber(st.absErrFrozen, ERR_DP) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="fc-note">
          Means in <Unit unit={FLUX_UNIT} />. Persistence forecasts the mean of the previous completed window, computed
          without look-ahead (its right edge is held at the last sample inside the window), so it can differ from that
          window's revealed observed mean in the last digits. Frozen keeps the {formatWindow(a.initWindow)} initialisation
          mean for every window.
        </p>
      </Panel>

      <Panel
        eyebrow="Forecast replay"
        title="Final scores: recomputed vs PRD claim"
        subtitle={`MAE over all ${n} windows, at the PRD's printed precision.`}
        status={<StatusPill status="derived" />}
      >
        <div className="fc-fixtures">
          {persistenceFixture && <FixtureCheck fixture={persistenceFixture} unit={FLUX_UNIT} />}
          {frozenFixture && <FixtureCheck fixture={frozenFixture} unit={FLUX_UNIT} />}
          {a.fixtures
            .filter((f) => f !== persistenceFixture && f !== frozenFixture)
            .map((f) => (
              <FixtureCheck key={f.id} fixture={f} unit={FLUX_UNIT} />
            ))}
        </div>
        <Callout tone="warn" title="The PRD scores reproduce only under a different window-mean definition">
          {sah ? (
            <>
              A time-weighted sample-and-hold window mean gives persistence{' '}
              <span className="lab-num">{sah.persistence[0]} → {sah.persistence[1]}</span> and frozen{' '}
              <span className="lab-num">{sah.frozen[0]} → {sah.frozen[1]}</span>, matching the PRD, but it breaks the
              archive fixture
              {sah.archive ? (
                <>
                  {' '}
                  (stella 300–400 = <span className="lab-num">{sah.archive.value}</span>, prints{' '}
                  <span className="lab-num">{sah.archive.printed}</span> vs PRD{' '}
                  <span className="lab-num">{sah.archive.claimed}</span>)
                </>
              ) : null}
              . Labyrinth keeps one edge-interpolated definition everywhere (D-013, D-016), so these scores are shown as
              mismatches rather than tuned to the claim.
            </>
          ) : (
            <>
              No single tested window-mean definition reproduces every PRD number; one definition is kept everywhere
              (D-013, D-016).
            </>
          )}
        </Callout>
      </Panel>
    </div>
  );
}
