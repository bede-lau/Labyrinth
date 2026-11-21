// Forecast replay (task 03, F4–F5, F7–F8): the owner's redesign (bbf2fc6) combined with D-026 / D-028.
// One panel. It opens on the overview, every saved window of the archived stella bean trace: a chart of Predicted
// (the selected forecaster) vs Actual heat flux, or, with the owner's toggle, the absolute errors of both
// forecasters with the signed range of errors. "Start replay" steps through Predict → Reveal → Update (a value is
// plotted only once predicted or revealed; "Run to end" takes the same steps for every remaining window; "Show all
// windows" returns to the overview). Below: MAE of both forecasters and MSE, RMSE, range of MSE and range of errors
// of the selected one, running over the scored windows and equal to errorStats in the overview; then the PRD scores,
// claimed vs recomputed with the mismatch flag, which a pointer at the top of the panel names (DS-4, FC-R7); the
// steps table under a disclosure.
import { useId, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import {
  Callout,
  FixtureCheck,
  Icon,
  Panel,
  ProvenanceBadge,
  Stat,
  StatusPill,
  Unit,
  VERIFICATION_STATUS,
  formatNumber,
  formatWindow,
  provenanceStatus,
  spokenUnit,
} from '../../design';
import { useArtifact } from '../../lib/artifacts';
import { useLiveStatus } from '../../lib/liveStatus';
import { ForecastChart } from './ForecastChart';
import {
  FLUX_SQ_UNIT,
  FLUX_UNIT,
  INITIAL,
  advance,
  completeState,
  errorStatDisagreements,
  errorStatPrintDifferences,
  errorStatTolerance,
  formatStat,
  mismatchedScores,
  nextAction,
  parseSampleAndHold,
  replayPillText,
  runningErrorStat,
  runningMae,
  runToEnd,
  sampleAndHoldMatchesPrd,
  scoredCount,
  statDecimals,
  visibility,
  type ForecastArtifact,
  type Forecaster,
  type ReplayState,
  type StatKey,
  type Window,
} from './model';
import './forecast.css';

const MEAN_DP = 3;
const ERR_DP = 4;

export interface ForecastViewProps {
  /** Poll interval for /api/live/status (ms): the replay pill drops "$0" whenever the header does. */
  livePollMs?: number;
}

/** In-page target of the mismatch pointer's "PRD scores" link (FC-R7): the PRD scores' heading. */
const PRD_SCORES_ID = 'forecast-prd-scores';

export function ForecastView({ livePollMs = 5000 }: ForecastViewProps = {}) {
  const state = useArtifact<ForecastArtifact>('forecast');
  const replay = replayPillText(useLiveStatus(livePollMs));
  if (state.status === 'loading') {
    return (
      <Panel title="Loading forecast replay…">
        <p className="fc-muted">Reading the saved windows (artifacts/forecast.json)…</p>
      </Panel>
    );
  }
  if (state.status === 'error') {
    return (
      <Panel title="Forecast replay could not be loaded">
        <Callout tone="warn" title={`${state.file} failed to load`}>
          {state.message}
        </Callout>
      </Panel>
    );
  }
  return <Replay a={state.data} replay={replay} />;
}

/** A value that exists but is deliberately not shown yet (never "not available", never 0). */
function Pending({ label, text }: { label: string; text: string }) {
  return (
    <div className="fc-hidden" role="group" aria-label={`${label}: ${text.toLowerCase()}`}>
      <div className="fc-hidden__label">{label}</div>
      <div className="fc-hidden__value">{text}</div>
    </div>
  );
}

/** A [min, max] range typeset like a Stat (DESIGN.md §6: the error statistics are Stats beside the chart). */
function RangeStat({
  label,
  range,
  unit,
  stat,
  note,
}: {
  label: string;
  range: Window;
  unit: string;
  /** Which statistic: sets how each end is printed (formatStat). */
  stat: StatKey;
  note?: string;
}) {
  const text = (v: number) => formatStat(stat, v);
  const spoken = (v: number) => text(v).replace('−', 'minus ').replace('+', 'plus ');
  return (
    <div
      className="lab-stat lab-stat--md fc-range"
      role="group"
      aria-label={`${label}: ${spoken(range[0])} to ${spoken(range[1])} ${spokenUnit(unit)}`}
      data-available="true"
    >
      <div className="lab-stat__label">{label}</div>
      <div className="lab-stat__value">
        <span className="lab-stat__number lab-num">{text(range[0])}</span>
        <span className="fc-range__to">to</span>
        <span className="lab-stat__number lab-num">{text(range[1])}</span>
        <Unit unit={unit} className="lab-stat__unit" />
      </div>
      {note && <div className="lab-stat__note">{note}</div>}
    </div>
  );
}

/** The replay's progress, for the status line: the window and what is shown of it, never a value. */
function progressText(a: ForecastArtifact, s: ReplayState | null): string {
  const n = a.steps.length;
  if (!s) return `${n} windows`;
  if (nextAction(s, n) === 'done') return `${n} windows scored`;
  const where = `Window ${s.index + 1}/${n} · ${formatWindow(a.steps[s.index]!.window)}`;
  if (s.phase === 'predicted') return `${where} · forecasts shown, observed hidden`;
  if (s.phase === 'revealed') return `${where} · observed revealed, scored at Update`;
  return `${where} · ${scoredCount(s)} of ${n} scored`;
}

function Replay({ a, replay }: { a: ForecastArtifact; replay: string }) {
  const n = a.steps.length;
  const [state, setState] = useState<ReplayState | null>(null);
  const [forecaster, setForecaster] = useState<Forecaster>('persistence');
  const primary = useRef<HTMLButtonElement>(null);
  const overview = useRef<HTMLButtonElement>(null);
  const prdHeading = useRef<HTMLHeadingElement>(null);
  const runHintId = `${useId()}-run-hint`;
  const action = nextAction(state ?? INITIAL, n);
  const done = action === 'done';
  const scored = state ? scoredCount(state) : n;
  const note = state ? `after ${scored} of ${n} windows` : `all ${n} windows`;
  const button = !state ? 'Start replay' : { predict: 'Predict', reveal: 'Reveal observed', update: 'Update', done: 'Replay complete' }[action];

  const step = () => {
    const next = advance(state ?? INITIAL, n);
    flushSync(() => setState(next));
    // FC-R6: the last Update disables the step button; focus moves to "Show all windows", the one control left
    // that acts (as after Run to end).
    if (nextAction(next, n) === 'done') overview.current?.focus();
  };

  return (
    <Panel
      title={`${formatNumber(a.windowWidth, 0)}-unit mean heat flux`}
      subtitle="stella · Bean tube · predicted vs actual"
      status={
        <div className="fc-badges">
          {/* "Replay · $0" only while the header shows it: never "$0" beside a bill that may be running. */}
          <StatusPill status="replay">{replay}</StatusPill>
          <ProvenanceBadge provenance={a.provenance} subject="forecast replay" />
        </div>
      }
      footer={<Footer a={a} />}
    >
      {n === 0 ? (
        <>
          <Callout tone="blocked" title="No forecast windows in artifacts/forecast.json">
            No saved windows to replay. Regenerate them with{' '}
            <code className="lab-mono">python3 -m labyrinth_main.build_artifacts</code> (from{' '}
            <code className="lab-mono">main/</code>).
          </Callout>
          <PrdScores a={a} headingRef={prdHeading} />
        </>
      ) : (
        <>
          <MismatchPointer a={a} target={prdHeading} />
          <ForecastChart artifact={a} replay={state} forecaster={forecaster} onForecasterChange={setForecaster} />
          <div className="fc-tools">
            <div className="fc-buttons">
              <button ref={primary} type="button" className="fc-btn fc-btn--primary" disabled={done} onClick={step}>
                {button}
              </button>
              {state && (
                <>
                  {/* DZ-9: the step button pressed until the replay is complete (runToEnd = advance repeated), done
                      at once, so there is no motion to reduce. Focus moves to "Show all windows". */}
                  <button
                    type="button"
                    className="fc-btn"
                    disabled={done}
                    aria-describedby={runHintId}
                    onClick={() => {
                      flushSync(() => setState((x) => runToEnd(x ?? INITIAL, n)));
                      overview.current?.focus();
                    }}
                  >
                    Run to end
                  </button>
                  <span id={runHintId} className="lab-visually-hidden">
                    Predicts, reveals and scores every remaining window in turn, as the step button does.
                  </span>
                  <button
                    ref={overview}
                    type="button"
                    className="fc-btn"
                    onClick={() => {
                      flushSync(() => setState(null));
                      primary.current?.focus();
                    }}
                  >
                    Show all windows
                  </button>
                </>
              )}
            </div>
            <span role="status" className="fc-progress" data-testid="progress">
              {progressText(a, state)}
            </span>
          </div>

          <div className="fc-scores">
            <MaeStats a={a} scored={scored} note={note} />
            <ErrorStatistics a={a} scored={scored} forecaster={forecaster} note={note} />
          </div>
          <PrdScores a={a} headingRef={prdHeading} />
          <StepsTable a={a} state={state} />
        </>
      )}
    </Panel>
  );
}

function Footer({ a }: { a: ForecastArtifact }) {
  const notes = [...new Set(a.fixtures.map((f) => f.note).filter((x): x is string => Boolean(x)))];
  return (
    <>
      <p className="fc-note" data-testid="forecast-note">
        Means in <Unit unit={FLUX_UNIT} />. Persistence forecasts the mean of the previous completed window, computed
        without look-ahead (its right edge is held at the last sample inside the window), so it can differ from that
        window's revealed observed mean in the last digits. Frozen keeps the {formatWindow(a.initWindow)} initialisation
        mean for every window.
      </p>
      <details className="fc-details">
        <summary>Method (from the artifact)</summary>
        <p>{a.method}</p>
        {a.errorStats?.definition && <p>Error statistics: {a.errorStats.definition}</p>}
        {notes.map((x, i) => (
          <p key={i}>PRD scores: {x}</p>
        ))}
      </details>
    </>
  );
}

/** MAE of both forecasters over the scored windows (a window counts at its Update); every window in the overview. */
function MaeStats({ a, scored, note }: { a: ForecastArtifact; scored: number; note: string }) {
  const mae = runningMae(a.steps, scored);
  return (
    <div className="fc-mae" role="group" aria-label="Mean absolute error" data-testid="mae">
      {mae ? (
        <>
          <Stat label="MAE · persistence" value={mae.persistence} unit={FLUX_UNIT} decimals={ERR_DP} note={note} />
          <Stat label="MAE · frozen" value={mae.frozen} unit={FLUX_UNIT} decimals={ERR_DP} note={note} />
        </>
      ) : (
        <>
          <Pending label="MAE · persistence" text="Not scored yet (first Update)" />
          <Pending label="MAE · frozen" text="Not scored yet (first Update)" />
        </>
      )}
    </div>
  );
}

/**
 * F8 (D-026): MSE, RMSE, range of MSE and range of errors of the forecaster drawn as Predicted, over the windows
 * scored so far (a window counts at its Update, like the MAE), or every window in the overview. Only with every
 * window scored are they compared with the artifact's `errorStats`: a difference beyond the steps' rounding is
 * shown, never hidden; one within it (a value at a printed rounding boundary) is named with the artifact's printed value.
 */
function ErrorStatistics({ a, scored, forecaster, note }: { a: ForecastArtifact; scored: number; forecaster: Forecaster; note: string }) {
  const n = a.steps.length;
  const stat = runningErrorStat(a.steps, scored, forecaster);
  const { mse, rmse, squaredErrorRange, errorRange } = stat;
  const complete = scored >= n;
  const artifactStat = a.errorStats?.[forecaster];
  const disagreements = complete ? errorStatDisagreements(stat, artifactStat, errorStatTolerance(a.steps, scored, forecaster)) : [];
  const printDiffs = complete && artifactStat && disagreements.length === 0 ? errorStatPrintDifferences(stat, artifactStat) : [];
  const label = (what: string) => `${what} · ${forecaster}`;
  const pending = 'Not scored yet (first Update)';

  return (
    <div className="fc-stats-block">
      <div
        className="fc-stats"
        role="group"
        aria-label={`Error statistics of the ${forecaster} forecast, predicted minus actual`}
        data-testid="error-stats"
      >
        {mse !== null && rmse !== null && squaredErrorRange && errorRange ? (
          <>
            <Stat label={label('MSE')} value={mse} unit={FLUX_SQ_UNIT} decimals={statDecimals('mse', mse)} note={note} />
            <Stat label={label('RMSE')} value={rmse} unit={FLUX_UNIT} decimals={statDecimals('rmse', rmse)} note={note} />
            <RangeStat label={label('Range of MSE')} range={squaredErrorRange} unit={FLUX_SQ_UNIT} stat="squaredErrorRange" note={note} />
            <RangeStat label={label('Range of errors')} range={errorRange} unit={FLUX_UNIT} stat="errorRange" note={note} />
          </>
        ) : (
          <>
            <Pending label={label('MSE')} text={pending} />
            <Pending label={label('RMSE')} text={pending} />
            <Pending label={label('Range of MSE')} text={pending} />
            <Pending label={label('Range of errors')} text={pending} />
          </>
        )}
      </div>
      <p className="fc-stats__def" data-testid="error-stats-definition">
        Error e = predicted − actual for each window; range of MSE = min–max of the per-window squared errors e²
        (the values the MSE averages); RMSE = √MSE.
      </p>
      {complete &&
        (disagreements.length === 0 ? (
          printDiffs.length === 0 ? (
            <p className="fc-note" data-testid="error-stats-check">
              All {n} windows scored: these equal <code className="lab-mono">errorStats</code> in artifacts/forecast.json
              (computed by main/ from the same steps) at the printed precision.
            </p>
          ) : (
            <p className="fc-note" data-testid="error-stats-check">
              All {n} windows scored: these agree with <code className="lab-mono">errorStats</code> in artifacts/forecast.json
              (computed by main/ from the unrounded window means) within the 7-significant-figure rounding of the steps
              they are recomputed from. At a rounding boundary that is enough to print differently:{' '}
              {printDiffs.map((d) => `${d.name} prints as ${d.artifact} there`).join('; ')}.
            </p>
          )
        ) : (
          <Callout tone="warn" title="The replayed error statistics differ from artifacts/forecast.json">
            {artifactStat ? (
              <>
                {disagreements.join(', ')} of the {forecaster} forecast {disagreements.length === 1 ? 'differs' : 'differ'}{' '}
                from the artifact's <code className="lab-mono">errorStats</code> by more than the 7-significant-figure
                rounding of the steps explains, although both come from the same steps.
              </>
            ) : (
              <>
                The artifact has no <code className="lab-mono">errorStats</code> for the {forecaster} forecast to check
                these against.
              </>
            )}{' '}
            The artifact may be stale: regenerate it with <code className="lab-mono">python3 -m labyrinth_main.build_artifacts</code>.
          </Callout>
        ))}
    </div>
  );
}

/** A score's PRD claim as printed ("0.0423"), or "—" when the artifact carries none. */
function claimText(a: ForecastArtifact, id: string): string {
  const f = a.fixtures.find((x) => x.id === id);
  return f && f.claimed !== null ? formatNumber(f.claimed, f.printedDecimals) : '—';
}

/**
 * F5 and the honesty rule: the PRD's MAE scores are fixtures, shown claimed vs recomputed at the PRD's printed
 * precision with the mismatch flag (the owner's redesign retired the separate score panel; this compact block
 * keeps the comparison on the page). The artifact's note is under "Method"; the narrative below says why.
 */
function PrdScores({ a, headingRef }: { a: ForecastArtifact; headingRef: RefObject<HTMLHeadingElement | null> }) {
  const n = a.steps.length;
  const sah = parseSampleAndHold(a.fixtures.find((f) => f.note)?.note);
  const persistenceFixture = a.fixtures.find((f) => f.id === 'mae-persistence');
  const frozenFixture = a.fixtures.find((f) => f.id === 'mae-frozen');
  const ordered = [
    ...(persistenceFixture ? [persistenceFixture] : []),
    ...(frozenFixture ? [frozenFixture] : []),
    ...a.fixtures.filter((f) => f !== persistenceFixture && f !== frozenFixture),
  ];
  const mismatched = mismatchedScores(a);
  const kind = provenanceStatus(a.provenance.kind);
  const affected =
    mismatched.length === 1
      ? `${mismatched.length} of ${a.fixtures.length} scores is shown as a mismatch`
      : `${mismatched.length} of ${a.fixtures.length} scores are shown as mismatches`;

  return (
    <div className="fc-prd" role="group" aria-labelledby={PRD_SCORES_ID} data-testid="prd-scores">
      <div className="fc-prd__head">
        {/* The mismatch pointer's link moves focus here (FC-R7): focusable by script only, so no extra Tab stop. */}
        <h3 id={PRD_SCORES_ID} ref={headingRef} tabIndex={-1} className="fc-prd__title">
          PRD scores: claimed vs recomputed
        </h3>
        <div className="fc-badges">
          {/* No live flag: an artifact is replayed evidence, its provenance can never earn the LIVE pill. */}
          <StatusPill status={kind.status}>{kind.label}</StatusPill>
          <StatusPill status={VERIFICATION_STATUS[a.provenance.verification.outcome]} />
        </div>
      </div>
      <p className="fc-prd__sub">
        {n > 0
          ? `MAE over all ${n} windows, at the PRD's printed precision.`
          : "MAE as recorded in the artifact, at the PRD's printed precision."}
      </p>
      <div className="fc-fixtures" data-testid="final-scores">
        {ordered.map((f) => (
          <FixtureCheck key={f.id} fixture={{ ...f, note: undefined }} unit={FLUX_UNIT} />
        ))}
      </div>
      {mismatched.length > 0 &&
        (sah && !sampleAndHoldMatchesPrd(sah, a) ? (
          <Callout tone="warn" title="The PRD scores do not reproduce with the stated method">
            A time-weighted sample-and-hold window mean gives persistence{' '}
            <span className="lab-num">
              {sah.persistence[0]} → {sah.persistence[1]}
            </span>{' '}
            and frozen{' '}
            <span className="lab-num">
              {sah.frozen[0]} → {sah.frozen[1]}
            </span>
            , which does not match the PRD's printed{' '}
            <span className="lab-num">{claimText(a, 'mae-persistence')}</span> and{' '}
            <span className="lab-num">{claimText(a, 'mae-frozen')}</span> either. One window-mean definition is kept
            everywhere (D-013, D-016), so {affected} rather than tuned to the claim.
          </Callout>
        ) : sah ? (
          <Callout tone="warn" title="The PRD scores reproduce only under a different window-mean definition">
            A time-weighted sample-and-hold window mean gives persistence{' '}
            <span className="lab-num">
              {sah.persistence[0]} → {sah.persistence[1]}
            </span>{' '}
            and frozen{' '}
            <span className="lab-num">
              {sah.frozen[0]} → {sah.frozen[1]}
            </span>
            , matching the PRD, but it breaks the archive fixture
            {sah.archive ? (
              <>
                {' '}
                (stella 300–400 = <span className="lab-num">{sah.archive.value}</span>, prints{' '}
                <span className="lab-num">{sah.archive.printed}</span> vs PRD{' '}
                <span className="lab-num">{sah.archive.claimed}</span>)
              </>
            ) : null}
            . Labyrinth keeps one edge-interpolated definition everywhere (D-013, D-016), so {affected} rather than
            tuned to the claim.
          </Callout>
        ) : (
          <Callout tone="warn" title="The PRD scores do not reproduce with the stated method">
            One window-mean definition is kept everywhere (D-013, D-016), so {affected} rather than tuned to the claim.
          </Callout>
        ))}
    </div>
  );
}

/**
 * DS-4: while a PRD score is shown as a mismatch, the panel's first line says so and points at the PRD scores
 * below the chart, so the mismatch never sits only below the fold. The same count as the rows marked Mismatch
 * there (`mismatchedScores`); no numbers here. "PRD scores" is an in-page link (FC-R7) that scrolls to them and
 * moves focus to their heading. Hash routing owns location.hash, so, like the shell's skip link, it moves focus
 * without following the href.
 */
function MismatchPointer({ a, target }: { a: ForecastArtifact; target: RefObject<HTMLHeadingElement | null> }) {
  const m = mismatchedScores(a).length;
  if (m === 0) return null;
  const toScores = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const heading = target.current;
    // The block's top edge to the top of the view (instant: no motion to reduce), then focus without a second scroll.
    heading?.closest('.fc-prd')?.scrollIntoView?.({ block: 'start' });
    heading?.focus({ preventScroll: true });
  };
  return (
    <p className="fc-pointer" data-testid="scores-pointer">
      <span className="fc-pointer__flag">
        <Icon name="cross" size={12} />
        Mismatch
      </span>{' '}
      <span>
        {m} of {a.fixtures.length} PRD scores {m === 1 ? 'does' : 'do'} not reproduce with the stated method: see{' '}
        <a href={`#${PRD_SCORES_ID}`} onClick={toScores}>
          PRD scores
        </a>
        , below the chart.
      </span>
    </p>
  );
}

/** F7: the table is not the primary display; it stays for exact values (keyboard, screen readers). */
function StepsTable({ a, state }: { a: ForecastArtifact; state: ReplayState | null }) {
  const n = a.steps.length;
  const s = state ?? completeState(n);
  const replaying = state !== null && nextAction(state, n) !== 'done';
  return (
    <details className="fc-steps">
      <summary>Show the steps table</summary>
      <div className="fc-table-wrap" role="region" aria-label="Forecast steps table" tabIndex={0}>
        <table className="fc-table">
          <caption className="lab-visually-hidden">
            Forecast steps: window, both forecasts, observed mean and absolute errors. In a step-through replay, values
            appear as they are predicted and revealed.
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
                <tr key={i} aria-current={replaying && i === s.index ? 'step' : undefined} data-testid={`step-${i}`}>
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
    </details>
  );
}
