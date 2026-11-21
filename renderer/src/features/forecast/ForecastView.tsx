// Forecast replay (task 03, F4–F5, F7–F8). The replay comes first (DZ-9): Predict -> Reveal -> Update over
// eight 50-unit windows of the archived stella bean trace, drawn as a chart of predicted and actual heat flux
// against time (D-026): a value is plotted only once predicted or revealed; "Run to end" takes the same steps
// for every remaining window. Running MAE for both forecasters, and MSE, RMSE and both ranges for the
// forecaster drawn as Predicted. The steps table sits under a disclosure. Then the final scores: recomputed MAE
// beside the PRD claim with the mismatch flag and the D-016 note; while a score is a mismatch, the replay's
// first line says so and links to them (DS-4: the mismatch stays in the first viewport; FC-R7).
import { useId, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import {
  Callout,
  FixtureCheck,
  Icon,
  Panel,
  ProvenanceBadge,
  SegmentedControl,
  Stat,
  StatusPill,
  Unit,
  VERIFICATION_STATUS,
  formatNumber,
  formatWindow,
  provenanceStatus,
  spokenUnit,
  useResolvedTheme,
  type SegmentedOption,
} from '../../design';
import { useArtifact } from '../../lib/artifacts';
import { useLiveStatus } from '../../lib/liveStatus';
import { forecastChartSpec } from './chart';
import {
  FLUX_SQ_UNIT,
  FLUX_UNIT,
  FORECASTERS,
  FORECASTER_LABEL,
  INITIAL,
  TIME_UNIT,
  advance,
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
import { PlotlyChart } from './PlotlyChart';
import './forecast.css';

const MEAN_DP = 3;
const ERR_DP = 4;

const FORECASTER_OPTIONS: readonly SegmentedOption<Forecaster>[] = FORECASTERS.map((f) => ({ value: f, label: FORECASTER_LABEL[f] }));

export interface ForecastViewProps {
  /** Poll interval for /api/live/status (ms): the replay pill drops "$0" whenever the header does. */
  livePollMs?: number;
}

/** In-page target of the mismatch pointer's "Final scores" link (FC-R7): the Final scores panel's heading text. */
const FINAL_SCORES_ID = 'forecast-final-scores';

export function ForecastView({ livePollMs = 5000 }: ForecastViewProps = {}) {
  const state = useArtifact<ForecastArtifact>('forecast');
  const replay = replayPillText(useLiveStatus(livePollMs));
  const scoresHeading = useRef<HTMLSpanElement>(null);
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
  // DOM order is reading and focus order: the replay with its chart first, then the final scores (DZ-9).
  return (
    <div className="fc-view">
      {state.data.steps.length > 0 ? (
        <Replay a={state.data} replay={replay} scoresHeading={scoresHeading} />
      ) : (
        <NoSteps a={state.data} replay={replay} />
      )}
      <FinalScores a={state.data} headingRef={scoresHeading} />
    </div>
  );
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

function FinalScores({ a, headingRef }: { a: ForecastArtifact; headingRef: RefObject<HTMLSpanElement | null> }) {
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
    <Panel
      eyebrow="Forecast replay"
      title={
        // The mismatch pointer's link moves focus here (FC-R7): focusable by script only, so no extra Tab stop.
        <span id={FINAL_SCORES_ID} ref={headingRef} tabIndex={-1}>
          Final scores: recomputed vs PRD claim
        </span>
      }
      subtitle={
        n > 0
          ? `MAE over all ${n} windows, at the PRD's printed precision.`
          : "MAE as recorded in the artifact, at the PRD's printed precision."
      }
      status={
        <div className="fc-badges">
          {/* No live flag: an artifact is replayed evidence, its provenance can never earn the LIVE pill. */}
          <StatusPill status={kind.status}>{kind.label}</StatusPill>
          <StatusPill status={VERIFICATION_STATUS[a.provenance.verification.outcome]} />
        </div>
      }
    >
      <div className="fc-fixtures" data-testid="final-scores">
        {ordered.map((f) => (
          <FixtureCheck key={f.id} fixture={f} unit={FLUX_UNIT} />
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
    </Panel>
  );
}

/** A score's PRD claim as printed ("0.0423"), or "—" when the artifact carries none. */
function claimText(a: ForecastArtifact, id: string): string {
  const f = a.fixtures.find((x) => x.id === id);
  return f && f.claimed !== null ? formatNumber(f.claimed, f.printedDecimals) : '—';
}

/** `steps: []` is schema-valid: say so instead of indexing into nothing. */
function NoSteps({ a, replay }: { a: ForecastArtifact; replay: string }) {
  return (
    <Panel
      eyebrow="Forecast replay"
      title="Predict the next local mean of the stella bean flux"
      subtitle={`Initialised on ${formatWindow(a.initWindow)}. Replayed archive data, not live.`}
      status={
        <div className="fc-badges">
          <StatusPill status="replay">{replay}</StatusPill>
          <ProvenanceBadge provenance={a.provenance} subject="forecast replay" />
        </div>
      }
    >
      <Callout tone="blocked" title="No forecast windows in artifacts/forecast.json">
        The artifact lists no steps, so there is nothing to step through. Regenerate it with{' '}
        <code className="lab-mono">python3 -m labyrinth_main.build_artifacts</code> (from{' '}
        <code className="lab-mono">main/</code>).
      </Callout>
    </Panel>
  );
}

/**
 * DS-4 with the replay first (DZ-9): while a PRD score is shown as a mismatch, the replay's first line says so
 * and points at the final scores below it, so the mismatch never sits only below the fold. The same count as
 * the rows marked Mismatch there (`mismatchedScores`); no numbers here, the claims and scores are in that panel.
 * "Final scores" is an in-page link (FC-R7) that scrolls to that panel and moves focus to its heading. Hash
 * routing owns location.hash, so, like the shell's skip link, it moves focus without following the href.
 */
function MismatchPointer({ a, scoresHeading }: { a: ForecastArtifact; scoresHeading: RefObject<HTMLSpanElement | null> }) {
  const m = mismatchedScores(a).length;
  if (m === 0) return null;
  const toScores = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const heading = scoresHeading.current;
    // The panel's top edge to the top of the view (instant: no motion to reduce), then focus without a second scroll.
    heading?.closest('section')?.scrollIntoView?.({ block: 'start' });
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
        <a href={`#${FINAL_SCORES_ID}`} onClick={toScores}>
          Final scores
        </a>
        , below the replay.
      </span>
    </p>
  );
}

function Replay({ a, replay, scoresHeading }: { a: ForecastArtifact; replay: string; scoresHeading: RefObject<HTMLSpanElement | null> }) {
  const [s, setS] = useState<ReplayState>(INITIAL);
  const [forecaster, setForecaster] = useState<Forecaster>('persistence');
  const primaryRef = useRef<HTMLButtonElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);
  const runHintId = `${useId()}-run-hint`;
  const theme = useResolvedTheme();
  const n = a.steps.length;
  const action = nextAction(s, n);
  const current = a.steps[Math.min(s.index, n - 1)];
  const scored = scoredCount(s);
  const mae = runningMae(a.steps, scored);
  const vis = visibility(s, s.index);
  const first = a.steps[0]!;
  const last = a.steps[n - 1]!;
  // Memoised so the chart redraws only when what it shows changes.
  const chart = useMemo(() => forecastChartSpec(a, s, forecaster, theme), [a, s, forecaster, theme]);

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
    <Panel
      eyebrow="Forecast replay"
      title={`Predict the next ${formatNumber(a.windowWidth, 0)}-unit mean of the stella bean flux`}
      subtitle={`Initialised on ${formatWindow(a.initWindow)}; ${n} windows from ${formatWindow([first.window[0], last.window[1]])}. Replayed archive data, not live.`}
      status={
        <div className="fc-badges">
          {/* "Replay · $0" only while the header shows it: never "$0" beside a bill that may be running. */}
          <StatusPill status="replay">{replay}</StatusPill>
          <ProvenanceBadge provenance={a.provenance} subject="forecast replay" />
        </div>
      }
      footer={
        <details className="fc-details">
          <summary>Method (from the artifact)</summary>
          <p>{a.method}</p>
          {a.errorStats?.definition && <p>Error statistics: {a.errorStats.definition}</p>}
        </details>
      }
    >
      <MismatchPointer a={a} scoresHeading={scoresHeading} />
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
            onClick={() => {
              const next = advance(s, n);
              flushSync(() => setS(next));
              // FC-R6: the last Update disables this button; focus moves to Reset, as after Run to end, while the
              // live region announces "Replay complete".
              if (nextAction(next, n) === 'done') resetRef.current?.focus();
            }}
            disabled={action === 'done'}
          >
            {buttonText}
          </button>
          {/* DZ-9: the step button pressed until the replay is complete (runToEnd = advance repeated), done at
              once, so there is no motion to reduce. It disables at the end; focus moves to Reset, the one control
              left that acts (the step button's last Update does the same, FC-R6). */}
          <button
            type="button"
            className="fc-btn"
            onClick={() => {
              flushSync(() => setS((x) => runToEnd(x, n)));
              resetRef.current?.focus();
            }}
            disabled={action === 'done'}
            aria-describedby={runHintId}
          >
            Run to end
          </button>
          <span id={runHintId} className="lab-visually-hidden">
            Predicts, reveals and scores every remaining window in turn, as the step button does.
          </span>
          <button
            ref={resetRef}
            type="button"
            className="fc-btn"
            onClick={() => {
              // Flushed first: at the end of the replay the step button is still disabled until this renders.
              flushSync(() => setS(INITIAL));
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

      <div className="fc-chart-block">
        <div className="fc-chart-head">
          <span className="fc-chart-head__label" aria-hidden="true">
            Predicted line
          </span>
          <SegmentedControl<Forecaster>
            label="Predicted line: forecaster"
            options={FORECASTER_OPTIONS}
            value={forecaster}
            onChange={setForecaster}
            size="sm"
          />
        </div>
        <PlotlyChart data={chart.data} layout={chart.layout} label={chart.label} caption={chart.caption} />
      </div>

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

      <ErrorStatistics a={a} scored={scored} forecaster={forecaster} />

      {/* F7: the table is no longer the primary display; it stays for exact values (keyboard, screen readers). */}
      <details className="fc-steps">
        <summary>Show the steps table</summary>
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
      </details>
      <p className="fc-note" data-testid="forecast-note">
        Means in <Unit unit={FLUX_UNIT} />. Persistence forecasts the mean of the previous completed window, computed
        without look-ahead (its right edge is held at the last sample inside the window), so it can differ from that
        window's revealed observed mean in the last digits. Frozen keeps the {formatWindow(a.initWindow)} initialisation
        mean for every window.
      </p>
    </Panel>
  );
}

/**
 * F8 (D-026): MSE, RMSE, range of MSE and range of errors of the forecaster drawn as Predicted, over the
 * windows scored so far (a window counts at its Update, like the running MAE). Only once every window is scored
 * are they compared with the artifact's `errorStats`: a difference beyond the steps' rounding is shown, never
 * hidden; one within it (a value at a printed rounding boundary) is named with the artifact's printed value.
 */
function ErrorStatistics({ a, scored, forecaster }: { a: ForecastArtifact; scored: number; forecaster: Forecaster }) {
  const n = a.steps.length;
  const stat = runningErrorStat(a.steps, scored, forecaster);
  const { mse, rmse, squaredErrorRange, errorRange } = stat;
  const note = `after ${scored} of ${n} windows`;
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
