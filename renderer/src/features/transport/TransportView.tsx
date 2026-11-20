// Check transport (task 02, T8–T12): archived stella + GENE bean traces, window statistics with an
// explicit saturated-agreement gate, the reduced-Modal discrepancy, fixtures, the triangular
// published mean, and a GX overlay that appears ONLY when /api/live/status reports mode "live".
import { useMemo } from 'react';
import {
  Callout,
  FixtureCheck,
  Icon,
  Panel,
  ProvenanceBadge,
  Stat,
  StatusPill,
  Unit,
  formatNumber,
  formatSigned,
  formatWindow,
  useResolvedTheme,
} from '../../design';
import { useArtifact } from '../../lib/artifacts';
import { useLiveStatus } from '../../lib/liveStatus';
import {
  FLUX_UNIT,
  MEAN_DECIMALS,
  TIME_UNIT,
  buildTransportFigure,
  claimSummary,
  discrepancy,
  lateComparison,
  liveGxSamples,
  parseWindowDetail,
  referenceWindowNote,
  windowRows,
} from './model';
import { PlotlyChart } from './PlotlyChart';
import type { TransportArtifact } from './types';
import './transport.css';

export interface TransportViewProps {
  /** Poll interval for /api/live/status (ms). */
  livePollMs?: number;
}

export function TransportView({ livePollMs = 5000 }: TransportViewProps = {}) {
  const state = useArtifact<TransportArtifact>('transport');
  const live = useLiveStatus(livePollMs);

  if (state.status === 'loading') {
    return (
      <Panel eyebrow="Check transport" title="Loading transport evidence…">
        <p className="tr-muted">Reading artifacts/transport.json.</p>
      </Panel>
    );
  }
  if (state.status === 'error') {
    return (
      <Panel eyebrow="Check transport" title="Transport evidence could not be loaded">
        <Callout tone="warn" title={`${state.file} failed to load`}>
          {state.message}
        </Callout>
      </Panel>
    );
  }
  return <TransportBody a={state.data} gx={liveGxSamples(live)} />;
}

function TransportBody({ a, gx }: { a: TransportArtifact; gx: ReturnType<typeof liveGxSamples> }) {
  const theme = useResolvedTheme();
  const fig = useMemo(() => buildTransportFigure(a, theme, gx), [a, theme, gx]);
  const rows = useMemo(() => windowRows(a), [a]);
  const claims = claimSummary(a);
  const late = lateComparison(a);
  const disc = discrepancy(a);
  const method = parseWindowDetail(a.windows[0]?.stationarityDetail).method;
  const bean = a.traces.filter((t) => t.tube === 'bean');
  const conv = a.unitConversion;
  const archiveFixtures = a.fixtures.filter((f) => f.computed !== null);
  const reportedFixtures = a.fixtures.filter((f) => f.computed === null);

  return (
    <div className="tr-view">
      <Panel
        eyebrow="Check transport"
        title="Bean tube ion heat flux: stella and GENE archives"
        subtitle="Both archived traces on one time axis and one flux unit. Shaded bands are the comparison windows; horizontal segments are the time-weighted window means."
        status={
          <div className="tr-badges">
            {fig.hasGx && <StatusPill status="live">LIVE · GX bean</StatusPill>}
            {bean.map((t) => (
              <ProvenanceBadge key={t.id} provenance={t.provenance} subject={`${t.code} ${t.tube} trace`} />
            ))}
          </div>
        }
        footer={
          <>
            Units: Q<sub>i</sub> in <Unit unit={FLUX_UNIT} />, t in <Unit unit={TIME_UNIT} /> ({a.units.heatFlux} vs {a.units.time}).
            Raw GX converts to archive units by t × {formatNumber(conv.timeMultiplier, 6)} (√2) and Q ÷{' '}
            {formatNumber(conv.heatFluxDivisor, 6)} (2√2). {conv.validity}
          </>
        }
      >
        <PlotlyChart
          data={fig.data}
          layout={fig.layout}
          ariaLabel={`Line chart of bean-tube ion heat flux versus time for stella and GENE archives${fig.hasGx ? ' with the live GX run' : ''}, with windows ${'200–300, 300–400 and 1500–1900'} shaded`}
          summary={fig.summary}
        />
        {late && (
          <Callout tone="info" title="stella and GENE are not shown to agree with each other">
            Late-window means differ by{' '}
            <span className="lab-num">{formatSigned(late.delta, 2)}</span> <Unit unit={FLUX_UNIT} /> (GENE{' '}
            {formatWindow(late.gene.window)}: <span className="lab-num">{formatNumber(late.gene.mean, MEAN_DECIMALS)}</span>;
            stella {formatWindow(late.stella.window)}:{' '}
            <span className="lab-num">{formatNumber(late.stella.mean, MEAN_DECIMALS)}</span>
            {late.sameWindow ? '' : '; the windows are not identical'}). No equivalence claim is made between them; read
            them as two independent references.
          </Callout>
        )}
      </Panel>

      <Panel
        eyebrow="Check transport"
        title="Window statistics"
        subtitle="Time-weighted means with autocorrelation-corrected sampling uncertainty, coverage, stationarity and the saturated-agreement gate per trace and window."
        status={<StatusPill status="derived" />}
        footer={
          method && (
            <details className="tr-details">
              <summary>Method (from the artifact)</summary>
              <p>{method}</p>
            </details>
          )
        }
      >
        {claims.allowed === 0 ? (
          <Callout tone="warn" title="Saturated agreement claim: not allowed for any archive window">
            A claim needs a covered, stationary window with finite sampling uncertainty and at least 20 effective
            samples (N<sub>eff</sub> ≥ 20, D-017). The archive's autocorrelation time leaves every window below that
            {claims.nEffMin !== null && claims.nEffMax !== null && (
              <>
                {' '}
                (reported N<sub>eff</sub> ≈ <span className="lab-num">{formatNumber(claims.nEffMin, 1)}</span>–
                <span className="lab-num">{formatNumber(claims.nEffMax, 1)}</span>)
              </>
            )}
            , so means are reported but agreement is not claimed. "≈" marks a small-sample stderr that is a lower bound;
            "—" means the stderr is not finite.
          </Callout>
        ) : (
          <Callout tone="info" title={`Saturated agreement claim allowed for ${claims.allowed} of ${claims.total} windows`}>
            Only rows marked "Claim allowed" meet the covered, stationary, finite-uncertainty, N<sub>eff</sub> ≥ 20 gate.
          </Callout>
        )}
        <div className="tr-table-wrap" role="region" aria-label="Window statistics table" tabIndex={0}>
          <table className="tr-table">
            <caption className="lab-visually-hidden">
              Window statistics per trace: mean, standard error, coverage, effective samples, stationarity and whether a
              saturated agreement claim is allowed
            </caption>
            <thead>
              <tr>
                <th scope="col">Trace</th>
                <th scope="col">Window (t)</th>
                <th scope="col">Coverage</th>
                <th scope="col" className="tr-num">
                  Mean (<Unit unit={FLUX_UNIT} />)
                </th>
                <th scope="col" className="tr-num">
                  ± stderr
                </th>
                <th scope="col" className="tr-num">
                  N<sub>eff</sub>
                </th>
                <th scope="col">Stationarity</th>
                <th scope="col">Saturated agreement claim</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-testid={`window-row-${r.key}`}>
                  <th scope="row">{r.code}</th>
                  <td className="lab-num">{r.windowText}</td>
                  <td data-covered={r.covered}>{r.coverageText}</td>
                  <td className="tr-num lab-num">{r.meanText}</td>
                  <td className="tr-num lab-num" aria-label={`stderr ${r.stderrSpoken}`}>
                    {r.stderrText}
                  </td>
                  <td className="tr-num lab-num">{r.nEffText}</td>
                  <td>{r.stationarityText}</td>
                  <td>
                    <span className="tr-claim" data-allowed={r.claimAllowed}>
                      <Icon name={r.claimAllowed ? 'check' : 'blocked'} size={12} />
                      {r.claimText}
                    </span>
                    {r.claimReason && <span className="tr-claim__why">{r.claimReason}</span>}
                    {r.detail.finding && (
                      <details className="tr-details tr-details--row">
                        <summary>
                          Detail<span className="lab-visually-hidden"> for {r.code} {r.windowText}</span>
                        </summary>
                        <p>{r.detail.finding}</p>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="tr-grid">
        <Panel
          eyebrow="Discrepancy"
          title={`Reduced Modal stella run vs archives, ${formatWindow(disc.window)}`}
          subtitle="A PRD-reported number beside recomputed archive means. Not a trace; not recomputable here."
          status={<ProvenanceBadge provenance={a.reducedModalRun.provenance} subject="reduced Modal stella run" />}
          headingLevel={3}
        >
          <div className="tr-stats">
            <Stat
              label="Reduced Modal stella run"
              value={disc.value}
              unit={FLUX_UNIT}
              decimals={2}
              window={disc.window}
              windowUnit={TIME_UNIT}
              status={<StatusPill status="prd-reported" />}
              size="lg"
            />
            {disc.rows.map((r) => (
              <Stat
                key={r.code}
                label={`${r.code} archive mean`}
                value={r.archive}
                unit={FLUX_UNIT}
                decimals={2}
                uncertainty={r.window?.stderr ?? null}
                window={disc.window}
                windowUnit={TIME_UNIT}
                status={<StatusPill status="derived" />}
                note={
                  r.window?.stderr != null && r.detail?.stderrApproximate ? '± is approximate (lower bound)' : undefined
                }
              />
            ))}
          </div>
          <ul className="tr-deltas" aria-label="Differences, reduced Modal run minus archive">
            {disc.rows.map((r) => (
              <li key={r.code} data-testid={`delta-${r.code}`}>
                <span>Δ vs {r.code}</span>
                <span className="lab-num tr-delta">{r.deltaText}</span> <Unit unit={FLUX_UNIT} />
                <span className="tr-muted lab-num"> ({r.ratioText} the archive)</span>
                <span className="tr-ref-note">
                  {r.code} {formatWindow(disc.window)} archive window: {referenceWindowNote(r.window, r.detail)}.
                </span>
              </li>
            ))}
          </ul>
          <Callout
            tone="warn"
            title={`Reduced run is ${disc.rows.map((r) => `${r.ratioText} the ${r.code}`).join(' and ')} archive mean`}
          >
            The gap is far larger than the reported archive sampling uncertainties, but {formatNumber(disc.value, 2)} has
            no trace or uncertainty in this repo, so its cause (resolution, setup or transient) cannot be checked here.
          </Callout>
        </Panel>

        <Panel
          eyebrow="Triangular tube"
          title="Triangular tube: published mean only"
          subtitle="Shown separately from the bean plot. No triangular trace is drawn."
          status={
            <div className="tr-badges">
              <StatusPill status="prd-reported" />
              <StatusPill status="unverified">Raw trace unverified</StatusPill>
            </div>
          }
          headingLevel={3}
          footer={
            <>
              Source: <a href={a.triangular.source.url}>{a.triangular.source.label}</a>
            </>
          }
        >
          <Stat
            label="Triangular published mean"
            value={a.triangular.publishedMean}
            unit={FLUX_UNIT}
            decimals={2}
            window={a.triangular.window}
            windowUnit={TIME_UNIT}
            status={<StatusPill status="prd-reported" />}
            size="lg"
          />
          <p className="tr-tri-label" data-testid="triangular-label">
            Published mean {formatNumber(a.triangular.publishedMean, 2)} over {formatWindow(a.triangular.window)} —
            PRD-reported, raw trace {a.triangular.rawTraceStatus}.
          </p>
        </Panel>
      </div>

      <Panel
        eyebrow="Check transport"
        title="PRD fixtures: claimed vs recomputed"
        subtitle="Each PRD number at its printed precision beside the value recomputed from the pinned archive."
        status={<StatusPill status="derived" />}
      >
        <div className="tr-fixtures">
          {archiveFixtures.map((f) => (
            <FixtureCheck key={f.id} fixture={f} unit={FLUX_UNIT} />
          ))}
          {reportedFixtures.map((f) => (
            <FixtureCheck key={f.id} fixture={f} unit={FLUX_UNIT} />
          ))}
        </div>
      </Panel>
    </div>
  );
}
