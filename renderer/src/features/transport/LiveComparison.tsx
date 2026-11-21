// Check transport, T13 (D-024): the backend's comparison of this session's GX bean samples with the
// archived stella and GENE traces on 200–300 and 300–400. Rendered by TransportView ONLY for a fresh,
// valid snapshot with mode "live" that carries `comparison` (model.ts liveComparison). The archive
// table's honesty rules apply: "Undecidable" for null stationarity, "Not covered" and "—" for nulls, an
// approximate stderr marked as a lower bound, the claim "not allowed" with its reason, signed deltas, and
// stella and GENE never presented as agreeing with each other.
import { useId } from 'react';
import { Callout, Panel, StatusPill, Unit } from '../../design';
import type { LiveComparison } from '../../lib/liveStatus';
import { FLUX_UNIT, MIN_N_EFF, TIME_UNIT, comparisonClaim, liveWindowRows, marginText, spanText } from './model';

export function LiveComparisonPanel({ comparison: c }: { comparison: LiveComparison }) {
  const id = useId();
  const claim = comparisonClaim(c);
  const rows = liveWindowRows(c);
  const span = spanText(c);
  const computed = rows.length > 0;

  return (
    <Panel
      eyebrow="Check transport"
      title="Live comparison: new GX bean samples vs the stella and GENE archives"
      subtitle={`Computed by the backend from every bean sample of this session (archive units), with the archive table's window statistics plus a TOST equivalence test against each archive trace, on ${
        computed ? rows.map((r) => r.windowText).join(' and ') : 'the PRD windows 200–300 and 300–400'
      }.`}
      className="tr-live"
      status={
        <div className="tr-badges">
          <StatusPill status="live">LIVE · this session</StatusPill>
          <StatusPill status={claim.allowed ? 'passed' : 'blocked'} size="md">
            {claim.allowed ? 'Saturated agreement: claim allowed' : 'Saturated agreement: claim not allowed'}
          </StatusPill>
        </div>
      }
      footer={
        <details className="tr-details">
          <summary>Method (from the backend)</summary>
          <p>{c.method}</p>
        </details>
      }
    >
      <dl className="tr-facts" data-testid="comparison-facts">
        <div>
          <dt>Bean samples received</dt>
          <dd className="lab-num" data-testid="comparison-samples">
            {c.nSamples}
          </dd>
        </div>
        <div>
          <dt>Span (t)</dt>
          <dd className="lab-num" data-testid="comparison-span">
            {span === null ? (
              'no bean samples yet'
            ) : (
              <>
                {span} <Unit unit={TIME_UNIT} />
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Equivalence margin (TOST)</dt>
          <dd data-testid="comparison-margin">{marginText(c.marginFraction)}</dd>
        </div>
        {computed && (
          <div className="tr-facts__wide">
            <dt>Reason (backend)</dt>
            <dd data-testid="comparison-reason">{c.reason}</dd>
          </div>
        )}
      </dl>

      {claim.inconsistency && (
        <Callout tone="warn" title="Inconsistent comparison: the claim flag and the verdicts disagree">
          <span data-testid="comparison-inconsistency">{claim.inconsistency}</span> No saturated-agreement claim is shown.
        </Callout>
      )}

      {!computed ? (
        <Callout tone="info" title="Live comparison could not be computed">
          <span data-testid="comparison-reason">{c.reason}</span>
        </Callout>
      ) : (
        <>
          <h3 id={`${id}-live`} className="tr-subhead">
            Live GX bean trace on each window
          </h3>
          <div className="tr-table-wrap" role="region" aria-labelledby={`${id}-live`} tabIndex={0}>
            <table className="tr-table" data-testid="live-window-table">
              <caption className="lab-visually-hidden">
                Live GX bean trace per window: coverage, mean, standard error, effective samples at the tau upper bound
                against the gate of {MIN_N_EFF}, stationarity and whether the live trace itself allows a saturated
                agreement claim
              </caption>
              <thead>
                <tr>
                  <th scope="col">Window (t)</th>
                  <th scope="col">Coverage</th>
                  <th scope="col" className="tr-num">
                    Mean (<Unit unit={FLUX_UNIT} />)
                  </th>
                  <th scope="col" className="tr-num">
                    ± stderr
                  </th>
                  <th scope="col" className="tr-num">
                    N<sub>eff</sub> at τ upper bound
                  </th>
                  <th scope="col">Stationarity</th>
                  <th scope="col">Live trace claim</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} data-testid={`live-row-${r.key}`}>
                    <th scope="row" className="lab-num">
                      {r.windowText}
                    </th>
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
                    <td data-label={`Effective samples (gate ${MIN_N_EFF})`} className="tr-num lab-num">
                      {r.nEffText}
                    </td>
                    <td data-label="Stationarity">{r.stationarityText}</td>
                    <td data-label="Live trace claim" className="tr-cell-claim">
                      <StatusPill status={r.claimAllowed ? 'passed' : 'blocked'}>{r.claimText}</StatusPill>
                      {r.claimReason && <span className="tr-claim__why">{r.claimReason}</span>}
                      {r.detail && (
                        <details className="tr-details tr-details--row">
                          <summary>
                            Detail<span className="lab-visually-hidden"> for the live trace on {r.windowText}</span>
                          </summary>
                          <p>{r.detail}</p>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 id={`${id}-archive`} className="tr-subhead">
            Live trace against each archive trace
          </h3>
          <div className="tr-table-wrap" role="region" aria-labelledby={`${id}-archive`} tabIndex={0}>
            <table className="tr-table" data-testid="live-verdict-table">
              <caption className="lab-visually-hidden">
                Live mean minus each archive mean per window, with the equivalence verdict of the live trace against that
                archive trace
              </caption>
              <thead>
                <tr>
                  <th scope="col">Archive trace</th>
                  <th scope="col">Window (t)</th>
                  <th scope="col" className="tr-num">
                    Archive mean (<Unit unit={FLUX_UNIT} />)
                  </th>
                  <th scope="col" className="tr-num">
                    Δ = live − archive
                  </th>
                  <th scope="col">Verdict (live vs archive)</th>
                </tr>
              </thead>
              <tbody>
                {rows.flatMap((r) =>
                  r.archive.map((v) => (
                    <tr key={v.key} data-testid={`verdict-row-${v.key}`}>
                      <th scope="row">{v.code}</th>
                      <td data-label="Window (t)" className="lab-num">
                        {v.windowText}
                      </td>
                      <td data-label="Archive mean" className="tr-num lab-num">
                        {v.meanText}
                        {v.mean !== null && <Unit unit={FLUX_UNIT} className="tr-cell-unit" />}
                      </td>
                      <td data-label="Δ = live − archive" className="tr-num lab-num">
                        {v.deltaText}
                      </td>
                      <td data-label="Verdict (live vs archive)" className="tr-cell-claim">
                        <StatusPill status={v.verdictStatus}>{v.verdictText}</StatusPill>
                        {v.inconsistency && <span className="tr-claim__why">{v.inconsistency}</span>}
                        {v.reason && (
                          <details className="tr-details tr-details--row">
                            <summary>
                              Reason<span className="lab-visually-hidden"> for the {v.code} {v.windowText} verdict</span>
                            </summary>
                            <p>{v.reason}</p>
                          </details>
                        )}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          <p className="tr-key" data-testid="live-key">
            Each verdict compares the live trace with one archive trace on one window (equivalence within the margin above);
            it says nothing about stella against GENE, which are not shown to agree with each other. “≈” marks a stderr
            that is a lower bound on the sampling uncertainty. “—” means the value is not finite or not available.
            “Undecidable” means the stationarity test could not decide; it is not a finding of stationarity.
          </p>
        </>
      )}
    </Panel>
  );
}
