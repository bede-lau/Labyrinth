// Locate the tubes (replay): W7-X high-mirror geometry at rho 0.8 from artifacts/geometry.json.
import { useId, useMemo, useState } from 'react';
import {
  Panel,
  ProvenanceBadge,
  SegmentedControl,
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
import { bmagChartSpec, buildSceneModel, tubeById, tubeMarkers } from './model';
import { PlotlyChart } from './PlotlyChart';
import { checkGeometry, type GeometryArtifact, type TubeId } from './types';
import { ValidationPanel } from './ValidationPanel';
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

const TUBE_OPTIONS = [
  { value: 'bean', label: 'Bean · ζ 0°', ariaLabel: 'Bean tube, ζ 0 degrees' },
  { value: 'triangular', label: 'Triangular · ζ 36°', ariaLabel: 'Triangular tube, ζ 36 degrees' },
] as const;

export function GeometryContent({ g }: { g: GeometryArtifact }) {
  const [selected, setSelected] = useState<TubeId>('bean');
  const theme = useResolvedTheme();
  const ids = { scene: useId(), chart: useId() };
  const tube = tubeById(g, selected);
  const other = tubeById(g, selected === 'bean' ? 'triangular' : 'bean');
  const model = useMemo(() => buildSceneModel(g, selected, theme), [g, selected, theme]);
  const chart = useMemo(() => bmagChartSpec(tube, theme), [tube, theme]);
  const [start, centre, end] = tubeMarkers(tube);
  const s = g.surface;
  const n = tube.samples.length;
  // Eyebrows are uppercased by CSS, which would turn ζ into a capital zeta that reads as "Z".
  const eyebrow = selected === 'bean' ? 'Bean tube' : 'Triangular tube';
  const range = tube.bmagRange;
  const tracerOk = g.validation.stellaReference.allWithinPrintedPrecision;
  const acceptance = g.validation.acceptance129.outcome;
  // The artifact's own provenance kind marks every panel of numbers. provenanceStatus() without the live
  // flag: an artifact is replayed evidence, so even a "live" kind is drawn as a recorded run, never LIVE.
  const kind = provenanceStatus(g.provenance.kind);
  const kindPill = <StatusPill status={kind.status}>{kind.label}</StatusPill>;

  return (
    <div className="geo-layout" data-selected={selected}>
      <Panel
        className="geo-layout__scene"
        eyebrow={`${VIEW} · replay`}
        title={`Field lines on the ρ = ${formatNumber(s.rho, 1)} flux surface`}
        subtitle={`${g.equilibrium.configuration} VMEC equilibrium, ${g.equilibrium.nfp} field periods, ι = ${formatNumber(s.iota, 3)}. Gray is the flux surface (context, not data); the selected line is coloured by |B|.`}
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
        actions={
          <SegmentedControl<TubeId> label="Field line" options={TUBE_OPTIONS} value={selected} onChange={setSelected} />
        }
        footer={
          <>
            Equilibrium:{' '}
            <a href={g.equilibrium.source.url} target="_blank" rel="noreferrer noopener">
              {g.equilibrium.source.label}
            </a>{' '}
            <span className="lab-mono" title={`sha256 ${g.equilibrium.source.sha256}`}>
              sha256 {g.equilibrium.source.sha256.slice(0, 10)}…
            </span>
          </>
        }
      >
        <FluxScene model={model} label={`3D view of the ${tube.label} field line on the gray ρ ${formatNumber(s.rho, 1)} surface`} describedBy={ids.scene} />
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
        <p id={ids.scene} className="geo-summary">
          {`Selected: ${tube.label}, ${n} samples along one poloidal turn (θ* −π to π), α = ${formatNumber(tube.alpha, 4)} rad, ` +
            `coloured by |B| / B_ref from ${formatNumber(range[0], 3)} to ${formatNumber(range[1], 3)}. ` +
            `Start at ζ ${formatNumber(start!.sample.zeta, 3)} rad, centre on the outboard midplane at ζ ${formatNumber(centre!.sample.zeta, 3)} rad ` +
            `(R ${formatNumber(centre!.sample.R, 3)} m), end at ζ ${formatNumber(end!.sample.zeta, 3)} rad. ` +
            `The ${other.label} line is drawn muted for context.`}
        </p>
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
        subtitle={`${n} samples over one poloidal turn. |B| in units of stella’s B_ref; θ* is the straight-field-line angle (stella zed).`}
        status={kindPill}
      >
        <figure className="geo-chart">
          <PlotlyChart className="geo-chart__plot" data={chart.data} layout={chart.layout} ariaLabel={chart.ariaLabel} describedBy={ids.chart} />
          <figcaption id={ids.chart} className="geo-summary">
            {chart.summary}
          </figcaption>
        </figure>
      </Panel>

      <div className="geo-layout__validation">
        <ValidationPanel g={g} />
      </div>
    </div>
  );
}
