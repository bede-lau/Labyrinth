import { Callout, Panel, Stat, StatusPill, VERIFICATION_STATUS, formatNumber, type Source } from '../../design';
import { isWebUrl, splitUnblock, tracerPassed } from './model';
import type { GeometryArtifact } from './types';

/** 2.9e-13 -> "2.9 × 10⁻¹³" as markup with a true minus sign. */
function Sci({ value }: { value: number }) {
  const [m, e] = value.toExponential(1).split('e');
  const exp = Number(e);
  return (
    <span className="lab-num">
      {m} × 10<sup>{exp < 0 ? `−${Math.abs(exp)}` : exp}</sup>
    </span>
  );
}

/** A reference file: a link only when it is a web address, with its pinned hash. */
function SourceRef({ source }: { source: Source }) {
  return (
    <p className="geo-check__source">
      Reference:{' '}
      {isWebUrl(source.url) ? (
        <a href={source.url} target="_blank" rel="noreferrer noopener">
          {source.label}
        </a>
      ) : (
        <span>
          {source.label} <span className="lab-mono">{source.url}</span>
        </span>
      )}{' '}
      <span className="lab-mono geo-check__hash" title={`sha256 ${source.sha256}`}>
        sha256 {source.sha256.slice(0, 10)}…
      </span>
    </p>
  );
}

export function ValidationPanel({ g }: { g: GeometryArtifact }) {
  const ref = g.validation.stellaReference;
  const f64 = g.validation.float64Reference;
  const acc = g.validation.acceptance129;
  const tracerOk = tracerPassed(g.validation);
  const { reason, unblock } = splitUnblock(acc.details);
  return (
    <Panel
      eyebrow="Locate the tubes"
      title="Validation"
      subtitle="Does the field-line tracer reproduce stella? Two checks, reported separately."
      density="compact"
      className="geo-validation"
    >
      <section className="geo-check" aria-labelledby="geo-check-ref">
        <div className="geo-check__head">
          <h3 id="geo-check-ref" className="geo-check__title">
            Tracer vs stella saved geometry (ρ 0.7)
          </h3>
          <StatusPill status={tracerOk ? 'passed' : 'failed'}>{tracerOk ? 'Verified' : 'Failed'}</StatusPill>
        </div>
        <p className="geo-check__text">
          {ref.allWithinPrintedPrecision
            ? `All ${ref.samplesCompared} saved samples agree to their printed ${ref.printedSignificantFigures} significant figures (within half a unit in the last printed place).`
            : `Not every sample agrees to the printed ${ref.printedSignificantFigures} significant figures.`}
        </p>
        <div className="geo-check__stats">
          <Stat label="Samples compared" value={ref.samplesCompared} unit="dimensionless" decimals={0} />
          <Stat label="Max |Δ| in |B|" value={ref.maxAbsError} unit="B_ref" decimals={6} />
          <Stat label="Max relative Δ" value={ref.maxRelError * 100} unit="%" decimals={4} />
        </div>
        <SourceRef source={ref.source} />
        {/* The same run against stella's float64 output, from validation.float64Reference (D-023). Its errors
            are rounded up by the backend, so "≤" is exact. */}
        <div className="geo-check__f64" data-testid="float64" data-within={f64.allWithinTolerance}>
          <p className="geo-check__text">
            Against stella’s float64 output (out.nc): max |Δ| in |B| ≤ <Sci value={f64.maxAbsError} /> B<sub>ref</sub>,
            relative ≤ <Sci value={f64.maxRelError} />, over {f64.samplesCompared} samples. Tolerance{' '}
            <Sci value={f64.tolerance} /> B<sub>ref</sub>:{' '}
            <strong>{f64.allWithinTolerance ? 'every sample is within it.' : 'NOT every sample is within it.'}</strong>
          </p>
          <SourceRef source={f64.source} />
        </div>
      </section>

      <section className="geo-check" aria-labelledby="geo-check-acc" data-testid="acceptance129">
        <div className="geo-check__head">
          <h3 id="geo-check-acc" className="geo-check__title">
            PRD acceptance: bean |B| vs all 129 saved stella samples (ρ 0.8)
          </h3>
          <StatusPill status={VERIFICATION_STATUS[acc.outcome]} />
        </div>
        <Callout
          tone="blocked"
          title="Not checked: the 129 saved samples are not available"
          action={unblock ? <span><strong>To unblock:</strong> {unblock}</span> : undefined}
        >
          <p>{reason}</p>
        </Callout>
      </section>
      <p className="geo-check__note">
        |B| is normalised by stella’s B<sub>ref</sub>; tolerances are printed at {formatNumber(ref.printedSignificantFigures, 0)}{' '}
        significant figures, as saved by stella.
      </p>
    </Panel>
  );
}
