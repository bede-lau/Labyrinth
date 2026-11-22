// Locate the tubes (replay): W7-X high-mirror geometry at rho 0.8 from artifacts/geometry.json.
import { Popover } from '@base-ui/react/popover';
import { useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, Panel, formatNumber, useResolvedTheme } from '../../design';
import { useArtifact } from '../../lib/artifacts';
import { ArtifactGate } from '../../shell/ArtifactGate';
import { checkHeatfield, type HeatfieldArtifact } from '../heatfield/types';
import { diverterPlanes } from '../heatfield/slice';
import { plasmaMaterials } from '../../design/tokens';
import { fiveTargetScenario, startupSimulation, heatedRanges } from './heatedEdge';
import { FluxScene } from './FluxScene';
import { createTubeField } from './tubeResponse';
import { createParticleTracks } from './particleTracks';
import { ParticleReadout } from './ParticleReadout';
import { CalculationLog } from './CalculationLog';
import type { LoopDecision } from '../heatfield/ControlLoop';
import { ColorBar } from './ColorBar';
import { CrossSectionInset } from './CrossSectionInset';
import { PlasmaExplorer } from './PlasmaExplorer';
import { buildSceneModel, tubeById, tubeMarkers } from './model';
import { checkGeometry, type GeometryArtifact, type TubeId } from './types';
import { TubePlan } from './TubePlan';
import './geometry.css';

const VIEW = 'W7-X Model';
const FILE = 'artifacts/geometry.json';

interface GeometryViewProps {
  assignmentsAnchor?: HTMLElement | null;
}

export function GeometryView({ assignmentsAnchor }: GeometryViewProps) {
  const state = useArtifact<GeometryArtifact>('geometry');
  return (
    <ArtifactGate state={state} view={VIEW} file={FILE} validate={checkGeometry}>
      {(g) => <GeometryContent g={g} assignmentsAnchor={assignmentsAnchor ?? null} />}
    </ArtifactGate>
  );
}

export function GeometryContent({ g, assignmentsAnchor }: { g: GeometryArtifact; assignmentsAnchor: HTMLElement | null }) {
  const [selected, setSelected] = useState<TubeId>('bean');
  const heat = useArtifact<HeatfieldArtifact>('heatfield');
  const saved = heat.status === 'ready' ? heat.data : null;
  const art = useMemo(() => saved && !checkHeatfield(saved) ? fiveTargetScenario(saved) : null, [saved]);
  const [run, setRun] = useState(0);
  const sim = useMemo(() => art ? startupSimulation(art) : null, [art, run]);
  const ranges = useMemo(() => (art && sim ? heatedRanges(art, sim) : null), [art, sim]);
  const tracks = useMemo(() => art && sim ? createParticleTracks(art, sim) : null, [art,sim]);
  const [manualPlane, setManualPlane] = useState<number | null>(null);
  const theme = useResolvedTheme();
  const tube = tubeById(g, selected);
  const other = tubeById(g, selected === 'bean' ? 'triangular' : 'bean');
  const model = useMemo(() => buildSceneModel(g, selected, theme), [g, selected, theme]);
  const [, centre] = tubeMarkers(tube);
  const s = g.surface;
  const [followed, setFollowed] = useState<number | null>(null);
  const [feedback, setFeedback] = useState(false);
  const [decision, setDecision] = useState<LoopDecision | null>(null);
  const lanes = useMemo(() => art && sim
    ? (['bean','triangular'] as const).map(id => createTubeField(art, sim, tubeById(g,id), s.rho))
    : null, [art,sim,g,s.rho]);
  const response = lanes?.find(lane => lane.tube.id === selected);
  // Eyebrows are uppercased by CSS, which would turn ζ into a capital zeta that reads as "Z".
  const eyebrow = selected === 'bean' ? 'Bean tube' : 'Triangular tube';
  const range = tube.bmagRange;

  const plane = manualPlane ?? (art ? Math.round((tube.zetaCenterDeg * art.grid.nPhi) / 360) % art.grid.nPhi : 0);
  const angle = art ? (360 * plane) / art.grid.nPhi : tube.crossSection.zetaDeg;
  const atCentre = Math.abs(angle - tube.crossSection.zetaDeg) < 0.0001;
  const section = useMemo(() => {
    if (!art || atCentre) return tube.crossSection;
    const phi = (angle * s.nPhi) / 360;
    const j = Math.floor(phi),
      f = phi - j;
    const R: number[] = [],
      Z: number[] = [];
    for (let i = 0; i < s.nTheta; i++) {
      const a = (j * s.nTheta + i) * 3,
        b = (((j + 1) % s.nPhi) * s.nTheta + i) * 3;
      const radius = (k: number) => Math.hypot(s.positions[k]!, s.positions[k + 1]!);
      R.push((1 - f) * radius(a) + f * radius(b));
      Z.push((1 - f) * s.positions[a + 2]! + f * s.positions[b + 2]!);
    }
    return { R, Z, zetaDeg: angle };
  }, [s, art, atCentre, angle, tube]);
  const lastSurface = art?.surfaces.at(-1);
  const boundary = atCentre
    ? s.boundary?.[tube.id]
    : art && lastSurface
      ? {
          R: lastSurface.R.slice(plane * art.grid.nTheta, (plane + 1) * art.grid.nTheta),
          Z: lastSurface.Z.slice(plane * art.grid.nTheta, (plane + 1) * art.grid.nTheta),
        }
      : undefined;
  const pickTube = (id: TubeId) => {
    setSelected(id);
    setManualPlane(null);
  };

  const renderModelControls = (toolbar?: ReactNode) => (
    <details className="geo-model-controls">
      <summary>Model controls</summary>
      {toolbar}
      <div className="geo-scene__keys">
        <ColorBar range={range} theme={theme} tubeLabel={tube.label} />
        <ul className="geo-markers" aria-label="Scene key">
          <li className="geo-key">
            <span className={`geo-glyph geo-glyph--square geo-glyph--${selected}`} aria-hidden="true" /> start θ* =
            −π
          </li>
          <li className="geo-key">
            <span className={`geo-glyph geo-glyph--circle geo-glyph--${selected}`} aria-hidden="true" /> centre θ* =
            0
          </li>
          <li className="geo-key">
            <span className={`geo-glyph geo-glyph--triangle geo-glyph--${selected}`} aria-hidden="true" /> end θ* =
            π
          </li>
          <li className="geo-key">
            <span className={`geo-swatch geo-swatch--${other.id}`} aria-hidden="true" /> {other.label}, muted
          </li>
          <li className="geo-key">
            <span className="geo-swatch geo-swatch--surface" aria-hidden="true" /> surface, unsampled context
          </li>
        </ul>
      </div>
    </details>
  );

  return (
    <div className="geo-layout" data-selected={selected}>
      <div className="geo-primary">
      <section className="lab-panel lab-panel--regular geo-layout__scene" aria-label="3D plasma scene">
        <div className="lab-panel__body">
          {art && sim && response && tracks ? (
            <PlasmaExplorer key={run}
              onPowerOff={() => {
                setFeedback(false);
                setFollowed(null);
                setDecision(null);
                setRun(n => n + 1);
              }}
              tracks={tracks}
              followed={followed}
              feedback={feedback}
              onFeedback={setFeedback}
              response={response}
              onDecision={setDecision}
              theme={theme}
              model={model}
              label={`3D view of the ${tube.label} field line`}
              art={art}
              sim={sim}
              slice={plane}
              setSlice={setManualPlane}
              renderControls={renderModelControls}
            />
          ) : (
            <>
              <FluxScene
                model={model}
                label={`3D view of the ${tube.label} field line on the ρ ${formatNumber(s.rho, 1)} surface`}
              />
              {renderModelControls()}
            </>
          )}
        </div>
      </section>

      <Panel
        className="geo-layout__inset"
        eyebrow={eyebrow}
        title={`Cross-section at ζ = ${formatNumber(angle, 0)}°`}
        density="compact"
      >
        <CrossSectionInset
          tube={tube}
          section={section}
          boundary={boundary}
          showCentre={atCentre}
          centre={{ R: centre!.sample.R, Z: centre!.sample.Z }}
          heat={art && sim && ranges ? { art, sim, plane, range: ranges.sliceT } : undefined}
          controls={
            art && (
              <div className="geo-section-tools">
                <label>
                  Toroidal angle{' '}
                  <input
                    type="range"
                    min="0"
                    max={art.grid.nPhi - 1}
                    value={plane}
                    aria-valuetext={angle + ' degrees'}
                    onChange={(e) => setManualPlane(Number(e.target.value))}
                  />
                </label>
                <div role="group" aria-label="Go to divertor">
                  {diverterPlanes(art).map((j, k) => (
                    <button
                      type="button"
                      key={j}
                      className="hf-btn"
                      aria-label={'Go to D' + (k + 1)}
                      aria-pressed={plane === j}
                      onClick={() => setManualPlane(j)}
                    >
                      D{k + 1}
                    </button>
                  ))}
                </div>
                {ranges && (
                  <div className="plasma-scale">
                    <span>{ranges.sliceT[0].toFixed(2)}</span>
                    <i
                      style={{ background: 'linear-gradient(to right,' + plasmaMaterials.temperature.join(',') + ')' }}
                    />
                    <span>{ranges.sliceT[1].toFixed(2)} keV</span>
                  </div>
                )}
              </div>
            )
          }
        />

      </Panel>

      </div>
      <div className="geo-comparison">
        {lanes && sim && <CalculationLog key={run} tubes={lanes} decision={decision} sim={sim} enabled={feedback} />}
        {tracks && sim && <ParticleReadout tracks={tracks} sim={sim} followed={followed} onFollow={setFollowed} />}
      </div>
      {assignmentsAnchor && createPortal(
        <Popover.Root>
          <Popover.Trigger className="geo-assignments__trigger" aria-label="GPU assignments">
            GPU<span className="geo-assignments__trigger-detail"> assignments</span>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner className="geo-assignments__positioner" align="end" sideOffset={8}>
              <Popover.Popup className="geo-assignments__popup" aria-label="GPU assignments">
                <Panel title="GPU assignments" density="compact" actions={
                  <Popover.Close className="geo-assignments__close" aria-label="Close GPU assignments">
                    <Icon name="cross" size={16} />
                  </Popover.Close>
                }>
                  <TubePlan geometry={g} selected={selected} onSelect={pickTube} />
                </Panel>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>,
        assignmentsAnchor,
      )}
    </div>
  );
}
