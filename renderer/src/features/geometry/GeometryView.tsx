// Locate the tubes (replay): W7-X high-mirror geometry at rho 0.8 from artifacts/geometry.json.
import { useMemo, useState } from 'react';
import {
  Panel,
  ProvenanceBadge,
  Stat,
  StatusPill,
  VERIFICATION_STATUS,
  formatNumber,
  provenanceStatus,
  useResolvedTheme,
  type VerificationOutcome,
} from '../../design';
import { useArtifact } from '../../lib/artifacts';
import { ArtifactGate } from '../../shell/ArtifactGate';
import { ColorBar } from './ColorBar';
import { CrossSectionInset } from './CrossSectionInset';
import { FluxScene } from './FluxScene';
import { bmagChartSpec, buildSceneModel, tracerPassed, tubeById, tubeMarkers } from './model';
import { PlotlyChart } from './PlotlyChart';
import { checkGeometry, type GeometryArtifact, type TubeId } from './types';
import { TubePlan } from './TubePlan';
import './geometry.css';

const VIEW = 'Locate the tubes';
const FILE = 'artifacts/geometry.json';

export function GeometryView() {
  const state = useArtifact<GeometryArtifact>('geometry');
  return (
    <ArtifactGate state={state} view={VIEW} file={FILE} validate={checkGeometry}>
      {(g) => <GeometryContent g={g} />}
    </ArtifactGate>
  );
}

/** How the acceptance-129 outcome reads in the first-panel verdict pill (from validation.acceptance129). */
const ACCEPTANCE_WORD: Record<VerificationOutcome, string> = {
  blocked: 'blocked',
  failed: 'failed',
  passed: 'verified',
  'not-applicable': 'not applicable',
};

export function GeometryContent({ g }: { g: GeometryArtifact }) {
  const [selected, setSelected] = useState<TubeId>('bean');
  const theme = useResolvedTheme();
  const tube = tubeById(g, selected);
  const other = tubeById(g, selected === 'bean' ? 'triangular' : 'bean');
  const model = useMemo(() => buildSceneModel(g, selected, theme), [g, selected, theme]);
  const chart = useMemo(() => bmagChartSpec(tube, theme), [tube, theme]);
  const [, centre] = tubeMarkers(tube);
  const s = g.surface;
  const n = tube.samples.length;
  // Eyebrows are uppercased by CSS, which would turn ζ into a capital zeta that reads as "Z".
  const eyebrow = selected === 'bean' ? 'Bean tube' : 'Triangular tube';
  const range = tube.bmagRange;
  // Both verdicts come from the artifact's validation block: the tracer's from its two rho 0.7 comparisons,
  // the acceptance from validation.acceptance129 (never from provenance.verification).
  const tracerOk = tracerPassed(g.validation);
  const acceptance = g.validation.acceptance129.outcome;
  // The artifact's own provenance kind marks every panel of numbers. provenanceStatus() without the live
  // flag: an artifact is replayed evidence, so even a "live" kind is drawn as a recorded run, never LIVE.
  const kind = provenanceStatus(g.provenance.kind);
  const kindPill = <StatusPill status={kind.status}>{kind.label}</StatusPill>;

  return (
    <div className="geo-layout" data-selected={selected}>
      <Panel
        className="geo-layout__scene"
        title={`Field lines on the ρ = ${formatNumber(s.rho, 1)} flux surface`}
        status={
          <>
            {/* Both validation verdicts, named, above the fold; the full record is in the Validation panel. */}
            <span className="geo-verdict" data-testid="geo-verdict">
              <StatusPill status={tracerOk ? 'passed' : 'failed'}>{`ρ 0.7 check ${tracerOk ? 'verified' : 'failed'}`}</StatusPill>
              <StatusPill status={VERIFICATION_STATUS[acceptance]}>{`129-sample acceptance ${ACCEPTANCE_WORD[acceptance]}`}</StatusPill>
            </span>
            <ProvenanceBadge provenance={g.provenance} subject="field-line geometry" />
          </>
        }
      >
        <FluxScene model={model} label={`3D view of the ${tube.label} field line on the gray ρ ${formatNumber(s.rho, 1)} surface`} />
        <div className="geo-scene__keys">
          <ColorBar range={range} theme={theme} tubeLabel={tube.label} />
          <ul className="geo-markers" aria-label="Scene key">
            <li className="geo-key">
              <span className={`geo-glyph geo-glyph--square geo-glyph--${selected}`} aria-hidden="true" /> start θ* = −π
            </li>
            <li className="geo-key">
              <span className={`geo-glyph geo-glyph--circle geo-glyph--${selected}`} aria-hidden="true" /> centre θ* = 0
            </li>
            <li className="geo-key">
              <span className={`geo-glyph geo-glyph--triangle geo-glyph--${selected}`} aria-hidden="true" /> end θ* = π
            </li>
            <li className="geo-key">
              <span className={`geo-swatch geo-swatch--${other.id}`} aria-hidden="true" /> {other.label}, muted
            </li>
            <li className="geo-key">
              <span className="geo-swatch geo-swatch--surface" aria-hidden="true" /> surface, unsampled context
            </li>
          </ul>
        </div>
      </Panel>

      <Panel
        className="geo-layout__inset"
        eyebrow={eyebrow}
        title={`Cross-section at ζ = ${formatNumber(tube.crossSection.zetaDeg, 0)}°`}
        subtitle="Sampled surface (solid) inside the plasma boundary (dashed), equal R and Z scale."
        status={kindPill}
        density="compact"
      >
        <CrossSectionInset tube={tube} boundary={s.boundary?.[tube.id]} centre={{ R: centre!.sample.R, Z: centre!.sample.Z }} />
        <div className="geo-stats">
          <Stat label="Centre R" value={centre!.sample.R} unit="m" decimals={3} />
          <Stat label="Centre Z" value={centre!.sample.Z} unit="m" decimals={3} />
          <Stat label="Field-line label α" value={tube.alpha} unit="rad" decimals={4} />
          <Stat label="Samples" value={n} unit="dimensionless" decimals={0} />
        </div>
      </Panel>

      <Panel
        className="geo-layout__chart"
        eyebrow={eyebrow}
        title="Field strength along the line, |B|(θ*)"
        status={kindPill}
      >
        <figure className="geo-chart">
          <PlotlyChart className="geo-chart__plot" data={chart.data} layout={chart.layout} ariaLabel={chart.ariaLabel} />
        </figure>
      </Panel>

      <Panel className="geo-layout__plan" title="GPU assignments" density="compact">
        <TubePlan geometry={g} selected={selected} onSelect={setSelected} />
      </Panel>
    </div>
  );
}
