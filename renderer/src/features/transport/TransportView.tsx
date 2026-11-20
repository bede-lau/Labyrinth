// Check transport (task 02, T8–T12): the verdict first (late means, Δ, the PRD-reported reduced run
// beside the archive means, the saturated-agreement gate), then the archived stella + GENE bean
// traces, the discrepancy and triangular cards, window statistics and fixtures. A GX overlay appears
// ONLY when /api/live/status reports mode "live".
import { useId, useMemo } from 'react';
import {
  Callout,
  FixtureCheck,
  Panel,
  ProvenanceBadge,
  Stat,
  StatusPill,
  Unit,
  formatNumber,
  formatSigned,
  formatWindow,
  provenanceStatus,
  useResolvedTheme,
  type Source,
} from '../../design';
import { useArtifact } from '../../lib/artifacts';
import { useLiveStatus } from '../../lib/liveStatus';
import {
  FLUX_UNIT,
  MEAN_DECIMALS,
  TIME_UNIT,
  beanArchiveTraces,
  buildTransportFigure,
  claimSummary,
  discrepancy,
  gapSentence,
  lateComparison,
  liveGxSamples,
  parseWindowDetail,
  referenceWindowNote,
  windowList,
  windowRows,
  type ClaimSummary,
  type Discrepancy,
  type LateComparison,
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

/** A source is a link only when it is a web address; a repository path (PRD.md) is not served by this app. */
function SourceRef({ source }: { source: Source }) {
  if (/^https?:\/\//i.test(source.url)) {
    return (
      <a href={source.url} target="_blank" rel="noreferrer noopener">
        {source.label}
      </a>
    );
  }
  return <span className="tr-source">{source.label}</span>;
}

function NEffRange({ claims }: { claims: ClaimSummary }) {
  if (claims.nEffMin === null || claims.nEffMax === null) return null;
  return (
    <>
      reported N<sub>eff</sub> ≈ <span className="lab-num">{formatNumber(claims.nEffMin, 1)}</span>–
      <span className="lab-num">{formatNumber(claims.nEffMax, 1)}</span>
    </>
  );
}

/** First panel: what the evidence supports, readable without scrolling. */
function Verdict({ a, claims, late, disc }: { a: TransportArtifact; claims: ClaimSummary; late: LateComparison | null; disc: Discrepancy }) {
  const id = useId();
  // The kind of the 5.79 figure comes from the artifact (prd-reported today); no live flag, so it can never read LIVE.
  const reduced = provenanceStatus(a.reducedModalRun.provenance.kind);
  const approx = (w: LateComparison['stella']) => w.stderr !== null && parseWindowDetail(w.stationarityDetail).stderrApproximate;
  return (
    <Panel
      eyebrow="Check transport"
      title="Verdict: what the archived evidence supports"
      status={
        claims.allowed === 0 ? (
          <StatusPill status="blocked" size="md">
            Saturated claim: not allowed
          </StatusPill>
        ) : (
          <StatusPill status="passed" size="md">
            {`Saturated claim allowed: ${claims.allowed} of ${claims.total} windows`}
          </StatusPill>
        )
      }
    >
      <div className="tr-verdict-wrap">
        <p className="tr-verdict__gate">
          {claims.allowed === 0 ? (
            <>
              No window meets the claim gate (covered, stationary, finite sampling uncertainty, N<sub>eff</sub> ≥ 20)
              {claims.nEffMin !== null && (
                <>
                  : <NEffRange claims={claims} />
                </>
              )}
              . Means are reported; agreement is not claimed.
            </>
          ) : (
            <>
              {claims.allowed} of {claims.total} windows meet the claim gate (covered, stationary, finite sampling
              uncertainty, N<sub>eff</sub> ≥ 20). Every other window reports a mean without a claim.
            </>
          )}
        </p>
        <div className="tr-verdict">
          {late && (
            <div className="tr-verdict__block" role="group" aria-labelledby={`${id}-late`}>
              <h3 id={`${id}-late`} className="tr-verdict__title">
                Late-window means: stella and GENE are not shown to agree
              </h3>
              <div className="tr-verdict__stats">
                <Stat
                  label="stella late-window mean"
                  value={late.stella.mean}
                  unit={FLUX_UNIT}
                  decimals={MEAN_DECIMALS}
                  uncertainty={late.stella.stderr}
                  window={late.stella.window}
                  windowUnit={TIME_UNIT}
                />
                <Stat
                  label="GENE late-window mean"
                  value={late.gene.mean}
                  unit={FLUX_UNIT}
                  decimals={MEAN_DECIMALS}
                  uncertainty={late.gene.stderr}
                  window={late.gene.window}
                  windowUnit={TIME_UNIT}
                />
                <Stat label="Δ = stella − GENE" value={late.delta} unit={FLUX_UNIT} decimals={2} />
              </div>
              <p className="tr-verdict__note">
                <StatusPill status="derived" /> Recomputed from the archive.
                {(approx(late.stella) || approx(late.gene)) && ' ± is approximate (a lower bound).'}
                {late.sameWindow ? '' : ' The two windows are not identical.'} No equivalence claim is made.
              </p>
            </div>
          )}
          <div className="tr-verdict__block" role="group" aria-labelledby={`${id}-reduced`}>
            <h3 id={`${id}-reduced`} className="tr-verdict__title">
              Reduced Modal run against the archive means, t {formatWindow(disc.window)}
            </h3>
            <div className="tr-verdict__stats tr-verdict__stats--lead">
              <Stat
                label="Reduced Modal stella run"
                value={disc.value}
                unit={FLUX_UNIT}
                decimals={2}
                status={<StatusPill status={reduced.status}>{reduced.label}</StatusPill>}
              />
              {disc.rows.map((r) => (
                <Stat
                  key={r.code}
                  label={`${r.code} archive mean`}
                  value={r.archive}
                  unit={FLUX_UNIT}
                  decimals={2}
                  uncertainty={r.window?.stderr ?? null}
                  note={
                    <>
                      Δ <span className="lab-num tr-delta">{r.deltaText}</span> (reduced run − {r.code})
                    </>
                  }
                />
              ))}
            </div>
            <p className="tr-verdict__note">
              <StatusPill status="derived" /> Archive means recomputed
              {disc.rows.some((r) => r.window?.stderr != null && r.detail?.stderrApproximate) && '; ± is approximate (a lower bound)'}.
              The reduced run is {reduced.label}: no trace or uncertainty in this repo.
            </p>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function TransportBody({ a, gx }: { a: TransportArtifact; gx: ReturnType<typeof liveGxSamples> }) {
  const theme = useResolvedTheme();
  const fig = useMemo(() => buildTransportFigure(a, theme, gx), [a, theme, gx]);
  const rows = useMemo(() => windowRows(a), [a]);
  const claims = useMemo(() => claimSummary(a), [a]);
  const late = lateComparison(a);
  const disc = discrepancy(a);
  const method = parseWindowDetail(a.windows[0]?.stationarityDetail).method;
  const bean = beanArchiveTraces(a);
  const conv = a.unitConversion;
  const archiveFixtures = a.fixtures.filter((f) => f.computed !== null);
  const reportedFixtures = a.fixtures.filter((f) => f.computed === null);
  const reduced = provenanceStatus(a.reducedModalRun.provenance.kind);

  return (
    <div className="tr-view">
      <Verdict a={a} claims={claims} late={late} disc={disc} />

      <Panel
        eyebrow="Check transport"
        title="Bean tube ion heat flux: stella and GENE archives"
        subtitle="Both archived traces on one time axis and one flux unit. Shaded bands are the comparison windows; horizontal segments are the time-weighted window means."
        status={
          <div className="tr-badges">
            {fig.hasGx && <StatusPill status="live">LIVE · GX bean</StatusPill>}
            {bean.map((t) => (
              <span key={t.id} className="tr-badge" data-testid="trace-badge">
                <span className="tr-badge__name" data-testid="trace-badge-name">
                  {t.code}
                </span>
                <ProvenanceBadge provenance={t.provenance} subject={`${t.code} ${t.tube} trace`} />
              </span>
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
          ariaLabel={`Line chart of bean-tube ion heat flux versus time for stella and GENE archives${fig.hasGx ? ' with the live GX run' : ''}, with windows ${windowList(fig.windows)} shaded`}
          summary={fig.summary}
        />
        {late && (
          <Callout tone="info" title="stella and GENE are not shown to agree with each other">
            Late-window means differ: stella − GENE ={' '}
            <span className="lab-num">{formatSigned(late.delta, 2)}</span> <Unit unit={FLUX_UNIT} /> (stella{' '}
            {formatWindow(late.stella.window)}: <span className="lab-num">{formatNumber(late.stella.mean, MEAN_DECIMALS)}</span>;
            GENE {formatWindow(late.gene.window)}:{' '}
            <span className="lab-num">{formatNumber(late.gene.mean, MEAN_DECIMALS)}</span>
            {late.sameWindow ? '' : '; the windows are not identical'}). No equivalence claim is made between them; read
            them as two independent references.
          </Callout>
        )}
      </Panel>

      <div className="tr-grid">
        <Panel
          eyebrow="Discrepancy"
          title={`Reduced Modal stella run vs archives, ${formatWindow(disc.window)}`}
          subtitle={`${reduced.label} figure beside recomputed archive means. Not a trace; not recomputable here.`}
          status={<ProvenanceBadge provenance={a.reducedModalRun.provenance} subject="reduced Modal stella run" />}
          headingLevel={3}
        >
          <div className="tr-stats-wrap">
            <div className="tr-stats">
              <div className="tr-stats__col">
                <Stat
                  label="Reduced Modal stella run"
                  value={disc.value}
                  unit={FLUX_UNIT}
                  decimals={2}
                  window={disc.window}
                  windowUnit={TIME_UNIT}
                  status={<StatusPill status={reduced.status}>{reduced.label}</StatusPill>}
                  size="lg"
                />
              </div>
              {disc.rows.map((r) => (
                <div key={r.code} className="tr-stats__col">
                  <Stat
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
                  <p className="tr-delta-line" data-testid={`delta-${r.code}`}>
                    <span className="tr-delta-line__k">Δ (reduced run − {r.code})</span>{' '}
                    <span className="lab-num tr-delta">{r.deltaText}</span> <Unit unit={FLUX_UNIT} />
                    <span className="tr-muted lab-num"> ({r.ratioText} the archive)</span>
                    <span className="tr-ref-note">
                      {r.code} {formatWindow(disc.window)} archive window: {referenceWindowNote(r.window, r.detail)}.
                    </span>
                  </p>
                </div>
              ))}
            </div>
          </div>
          <Callout
            tone="warn"
            title={`Reduced run is ${disc.rows.map((r) => `${r.ratioText} the ${r.code}`).join(' and ')} archive mean`}
          >
            <span data-testid="gap-sentence">{gapSentence(disc)}</span> {formatNumber(disc.value, 2)} has no trace or
            uncertainty in this repo, so the cause of any gap (resolution, setup or transient) cannot be checked here.
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
              Source: <SourceRef source={a.triangular.source} />
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
        {claims.allowed === 0 && claims.nEffLimited ? (
          <Callout tone="warn" title="Saturated agreement claim: not allowed for any archive window">
            A claim needs a covered, stationary window with finite sampling uncertainty and at least 20 effective
            samples (N<sub>eff</sub> ≥ 20, D-017). The archive's autocorrelation time leaves every covered window below
            that
            {claims.nEffMin !== null && claims.nEffMax !== null && (
              <>
                {' '}
                (<NEffRange claims={claims} />)
              </>
            )}
            , so means are reported but agreement is not claimed.
            <ReasonOnce claims={claims} />
          </Callout>
        ) : claims.allowed === 0 ? (
          // Not every covered window is short of effective samples: the reasons are the rows' own (FF-2).
          <Callout tone="warn" title="Saturated agreement claim: not allowed for any archive window">
            A claim needs a covered, stationary window with finite sampling uncertainty and at least 20 effective
            samples (N<sub>eff</sub> ≥ 20, D-017). No archive window meets it, so means are reported but agreement is
            not claimed. Reasons recorded:
            <ul className="tr-reasons" data-testid="claim-reasons">
              {claims.reasons.map((r) => (
                <li key={r.reason}>
                  <Unit unit={r.reason} /> ({r.count} of {claims.total} windows)
                </li>
              ))}
            </ul>
          </Callout>
        ) : (
          <Callout tone="info" title={`Saturated agreement claim allowed for ${claims.allowed} of ${claims.total} windows`}>
            Only rows marked "Claim allowed" meet the covered, stationary, finite-uncertainty, N<sub>eff</sub> ≥ 20 gate
            (D-017).
            <ReasonOnce claims={claims} />
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
                  <td data-label="Window (t)" className="lab-num">
                    {r.windowText}
                  </td>
                  <td data-label="Coverage" data-covered={r.covered}>
                    {r.coverageText}
                  </td>
                  <td data-label="Mean" className="tr-num lab-num">
                    {r.meanText}
                    {r.mean !== null && <Unit unit={FLUX_UNIT} className="tr-cell-unit" />}
                  </td>
                  <td data-label="± stderr" className="tr-num lab-num" aria-label={`stderr ${r.stderrSpoken}`}>
                    {r.stderrText}
                  </td>
                  <td data-label="Effective samples" className="tr-num lab-num">
                    {r.nEffText}
                  </td>
                  <td data-label="Stationarity">{r.stationarityText}</td>
                  <td data-label="Saturated agreement claim" className="tr-cell-claim">
                    <StatusPill status={r.claimAllowed ? 'passed' : 'blocked'}>{r.claimText}</StatusPill>
                    {r.claimReason && r.claimReason !== claims.commonReason && (
                      <Unit unit={r.claimReason} className="tr-claim__why" />
                    )}
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
        <p className="tr-key" data-testid="window-key">
          “≈” marks a small-sample value: a stderr shown with it is a lower bound on the sampling uncertainty. “—” means
          the value is not finite or not available. “Undecidable” means the stationarity test could not decide; it is
          not a finding of stationarity.
        </p>
      </Panel>

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

/** The reason most rows share, stated once above the table instead of once per row. */
function ReasonOnce({ claims }: { claims: ClaimSummary }) {
  if (!claims.commonReason) return null;
  return (
    <p className="tr-reason">
      Reason recorded for {claims.commonReasonCount} of {claims.total} windows: <Unit unit={claims.commonReason} />. A
      row with a different reason states it.
    </p>
  );
}
