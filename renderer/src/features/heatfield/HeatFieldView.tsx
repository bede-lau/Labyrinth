// Heat & field (D-027, task 10): the real W7-X LCFS geometry and |B| (VMEC, derived) with the illustrative edge heat
// model of tasks/10-heat-field/MODEL.md running in the browser (labelled model everywhere). Owner requirement
// 2026-11-21: heat map, hover read-outs, cross-section with an angle slider, four schematic diverters with a side
// panel and field-adjustment toggles, a moving |B|-against-angle graph with a frozen snapshot, the control loop and
// the governing equation.
import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  Callout,
  Panel,
  ProvenanceBadge,
  SegmentedControl,
  StatusPill,
  fieldGradientCss,
  formatNumber,
  heatGradientCss,
  trimNumber,
  useResolvedTheme,
  type ThemeName,
} from '../../design';
import { useArtifact } from '../../lib/artifacts';
import { ArtifactGate } from '../../shell/ArtifactGate';
import { curveRange, fieldCurve, strikeIndex, type Snapshot } from './chart';
import { ColorBar } from './ColorBar';
import { ControlLoop } from './ControlLoop';
import { CrossSection, type EdgeStrip, type SliceHover } from './CrossSection';
import { cellMean, diverterAtPlane, diverterPlanes, sliceExtremes, sliceLayout } from './slice';
import { DiverterPanel, type DiverterRow } from './DiverterPanel';
import { EquationPanel, UNSTABLE_TITLE, isStable } from './EquationPanel';
import { SubscriptText } from './SubscriptText';
import { FieldChart } from './FieldChart';
import { HeatScene, type HoverPoint } from './HeatScene';
import { modelFor, spunUpState, type Diagnostics } from './model';
import { SPEEDS, usePlayback, usePrefersReducedMotion, type Speed } from './playback';
import { buildSceneGeometry, colourRanges, type ColorBy } from './scene';
import { Simulation } from './sim';
import { checkHeatfield, type HeatfieldArtifact } from './types';
import './heatfield.css';

const VIEW = 'Heat & field';
const FILE = 'artifacts/heatfield.json';
/** Model time the control loop's Predict and New heat map run ahead (s). A UI choice, not a model parameter. */
export const HORIZON_S = 2;
/** Model time the "Advance" button steps (s). */
const NUDGE_S = 0.1;

export function HeatFieldView() {
  const state = useArtifact<HeatfieldArtifact>('heatfield');
  return (
    <ArtifactGate state={state} view={VIEW} file={FILE} validate={checkHeatfield}>
      {(a) => <HeatFieldContent art={a} />}
    </ArtifactGate>
  );
}

const COLOR_OPTIONS = [
  { value: 'temperature', label: 'Temperature', ariaLabel: 'Temperature (model)' },
  { value: 'field', label: '|B|', ariaLabel: '|B| (VMEC)' },
] as const;

const SPEED_OPTIONS = SPEEDS.map((s) => ({ value: String(s), label: `${s}×`, ariaLabel: `${s} times model speed` }));

const deg = (rad: number) => (rad * 180) / Math.PI;
const fmtDeg = (v: number) => `${formatNumber(v, 0)}°`;

interface Frame {
  n: number;
  time: number;
  coils: number[];
  T: Float64Array;
  B: Float64Array;
  diag: Diagnostics;
  strike: Float64Array;
}

function ReadOut({ x, y, rows, testId }: { x: number; y: number; rows: { k: string; v: string; status?: ReactNode }[]; testId: string }) {
  return (
    <div className="hf-readout" data-testid={testId} style={{ left: `min(${Math.round(x + 14)}px, calc(100% - 15rem))`, top: `${Math.round(y + 14)}px` }}>
      {rows.map((r) => (
        <p key={r.k} className="hf-readout__row">
          <span className="hf-readout__k">{r.k}</span> <span className="hf-readout__v lab-num">{r.v}</span>
          {r.status && <> {r.status}</>}
        </p>
      ))}
    </div>
  );
}

/**
 * Key swatch of a mark drawn in 3D as a color.text core on a scene-background halo (DZ3-1, DZ3-2), over `ground`
 * (the surface's colour ramp), where the halo is what keeps it readable.
 */
function MarkSwatch({ kind, ground }: { kind: 'arrow' | 'slice'; ground: string }) {
  return (
    <span className={`hf-swatch hf-swatch--mark hf-swatch--${kind}`} style={{ background: ground }} aria-hidden="true" data-mark={kind}>
      <svg viewBox="0 0 30 14" focusable="false">
        {kind === 'arrow' ? (
          <>
            <path className="hf-mark__halo" d="M4 7 H18" />
            <polygon className="hf-mark__head-halo" points="17,2.5 26,7 17,11.5" />
            <path className="hf-mark__core" d="M4 7 H18" />
            <polygon className="hf-mark__head" points="17.5,3.5 25,7 17.5,10.5" />
          </>
        ) : (
          <>
            <path className="hf-mark__halo" d="M3 11 Q15 1 27 11" />
            <path className="hf-mark__core" d="M3 11 Q15 1 27 11" />
          </>
        )}
      </svg>
    </span>
  );
}

export interface HeatFieldContentProps {
  art: HeatfieldArtifact;
  /** Start playing at once. Default: yes, unless the user prefers reduced motion. */
  autoPlay?: boolean;
}

export function HeatFieldContent({ art, autoPlay }: HeatFieldContentProps) {
  const theme: ThemeName = useResolvedTheme();
  const reduced = usePrefersReducedMotion();
  const ids = { scene: useId(), slice: useId() };
  const model = useMemo(() => modelFor(art), [art]);
  const sim = useMemo(() => new Simulation(model, spunUpState(model)), [model]);
  const geom = useMemo(() => {
    const off = new Array<number>(model.nDiverters).fill(0);
    return buildSceneGeometry(art, model, model.heatFlow(sim.start, off));
  }, [art, model, sim]);
  const ranges = useMemo(() => colourRanges(art, model, sim.start.T), [art, model, sim]);
  const stability = useMemo(() => model.stabilityNumber(), [model]);
  const planes = useMemo(() => diverterPlanes(art), [art]);
  const iStrike = strikeIndex(model);
  const yRange = useMemo(() => curveRange(model, iStrike), [model, iStrike]);
  const p = model.params;
  const divIds = art.diverters.items.map((d) => d.id);

  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const playback = usePlayback(sim, autoPlay ?? !reduced, refresh);
  const [colorBy, setColorBy] = useState<ColorBy>('temperature');
  const [showLines, setShowLines] = useState(true);
  const [showArrows, setShowArrows] = useState(false);
  const [sliceJ, setSliceJ] = useState(planes[0] ?? 0);
  const [sceneHover, setSceneHover] = useState<HoverPoint | null>(null);
  const [sliceHover, setSliceHover] = useState<SliceHover | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [sliceSay, setSliceSay] = useState('');

  // What React shows, refreshed at ~10 Hz while playing and on every action (the scene and the |B| chart redraw
  // every frame themselves).
  const frame: Frame = useMemo(
    () => ({
      n: sim.state.n,
      time: sim.time,
      coils: [...sim.coils],
      T: Float64Array.from(sim.state.T),
      B: Float64Array.from(sim.field()),
      diag: sim.diagnostics(),
      strike: model.strikeLines(sim.coils, sim.state.n),
    }),
    [sim, model, tick],
  );
  const xs = useMemo(() => model.crossSection(sim.state, sim.coils, sliceJ), [model, sim, sliceJ, frame]);
  const layout = useMemo(() => sliceLayout(art, sliceJ), [art, sliceJ]);
  // The LCFS row of the slice (ρ = 1 is the LCFS temperature itself) on the 3D surface's range (DZ3-3).
  const edge: EdgeStrip | null = useMemo(
    () =>
      colorBy === 'temperature'
        ? { values: xs.T.slice((art.surfaces.length - 1) * model.nTheta, art.surfaces.length * model.nTheta), range: ranges.lcfsT }
        : null,
    [colorBy, xs, art, model, ranges],
  );
  const sliceDeg = (360 * sliceJ) / model.nPhi;
  const hoverDeg = sceneHover ? (360 * Math.floor(sceneHover.cell / model.nTheta)) / model.nPhi : null;
  const diverterMarks = useMemo(() => art.diverters.items.map((d) => ({ id: d.id, deg: deg(d.phi) })), [art]);
  const nSurf = art.surfaces.length;
  const startCell = useMemo(() => ({ m: nSurf - 2, i: iStrike }), [nSurf, iStrike]);

  const setCoil = useCallback(
    (k: number, on: boolean) => {
      sim.setCoil(k, on);
      refresh();
    },
    [sim, refresh],
  );
  const allOff = () => {
    sim.setCoils(sim.coils.map(() => 0));
    refresh();
  };
  const reset = () => {
    sim.reset();
    refresh();
  };
  const nudge = () => {
    playback.setPlaying(false);
    sim.advance(Math.round(NUDGE_S / p.dt));
    refresh();
  };
  // The curve the chart draws now (it redraws faster than `frame` refreshes), read from the running model.
  const freeze = () => setSnapshot({ ...fieldCurve(model, sim.field(), iStrike), t: sim.time, coils: [...sim.coils] });

  const rows: DiverterRow[] = art.diverters.items.map((d, k) => ({
    id: d.id,
    label: d.label,
    peakTileC: frame.diag.peakTileC[k]!,
    peakHeatFlux: frame.diag.peakHeatFlux[k]!,
    strikeDeg: deg(frame.strike[k]!),
    on: frame.coils[k] === 1,
  }));
  const coilsOn = divIds.filter((_, k) => frame.coils[k] === 1);
  const sliceDiv = diverterAtPlane(art, sliceJ);

  const modelPill = <StatusPill status="model" />;
  const vmecPill = <StatusPill status="derived">Derived (VMEC)</StatusPill>;
  const coilPill = <StatusPill status="model">Model (coil perturbation)</StatusPill>;
  // While a coil is on, |B| is VMEC × (1 + ε Σ a_k h_k): the illustrative perturbation is model (D-027 §3, HF-R1).
  const perturbed = coilsOn.length > 0;
  const fieldStatus = perturbed ? (
    <span className="hf-badges" data-testid="field-status">
      {vmecPill}
      {coilPill}
    </span>
  ) : (
    vmecPill
  );
  const fieldWords = perturbed ? `VMEC with the illustrative coil perturbation of ${coilsOn.join(', ')} (model)` : 'VMEC';

  // Scene summary (also the WebGL fallback's text equivalent).
  const ext = (arr: Float64Array) => {
    let lo = 0;
    let hi = 0;
    arr.forEach((v, c) => {
      if (v < arr[lo]!) lo = c;
      if (v > arr[hi]!) hi = c;
    });
    const where = (c: number) => `φ ${fmtDeg((360 * Math.floor(c / model.nTheta)) / model.nPhi)}, θ ${fmtDeg((360 * (c % model.nTheta)) / model.nTheta)}`;
    return { lo: arr[lo]!, hi: arr[hi]!, loAt: where(lo), hiAt: where(hi) };
  };
  const tEx = ext(frame.T);
  const bEx = ext(frame.B);
  const summary =
    `Last closed flux surface of the ${art.equilibrium.configuration} VMEC equilibrium (${art.equilibrium.nfp} field periods), ` +
    `${model.nTheta} θ × ${model.nPhi} φ cells, coloured by ${colorBy === 'temperature' ? 'model temperature' : '|B|'}. ` +
    `At model time t = ${formatNumber(frame.time, 2)} s the model temperature runs from ${formatNumber(tEx.lo, 3)} keV (${tEx.loAt}) ` +
    `to ${formatNumber(tEx.hi, 3)} keV (${tEx.hiAt}), mean ${formatNumber(frame.diag.meanT, 3)} keV; |B| (${fieldWords}) runs from ${formatNumber(bEx.lo, 3)} T ` +
    `(${bEx.loAt}) to ${formatNumber(bEx.hi, 3)} T (${bEx.hiAt}). Diverter plates ${divIds.join(', ')} at φ ` +
    `${art.diverters.items.map((d) => fmtDeg(deg(d.phi))).join(', ')}, θ ${fmtDeg(deg(art.diverters.thetaCentre))} ± ` +
    `${fmtDeg(deg(art.diverters.halfWidthTheta))}. Field adjustments on: ${coilsOn.length ? coilsOn.join(', ') : 'none'}. ` +
    `${showLines ? `${art.fieldLines.length} field lines shown, coloured by |B|` : 'Field lines hidden'}; heat-flow arrows ${showArrows ? 'shown' : 'hidden'}. ` +
    `A ${theme === 'dark' ? 'light ring on a dark' : 'dark ring on a light'} casing, labelled “Slice φ ${fmtDeg(sliceDeg)}”, marks the cross-section at φ ${fmtDeg(sliceDeg)}.`;

  const sceneReadOut = sceneHover && (
    <ReadOut
      testId="scene-readout"
      x={sceneHover.x}
      y={sceneHover.y}
      rows={[
        { k: 'Temperature', v: `${formatNumber(frame.T[sceneHover.cell]!, 3)} keV`, status: modelPill },
        { k: '|B|', v: `${formatNumber(frame.B[sceneHover.cell]!, 3)} T`, status: fieldStatus },
        {
          k: 'Angles',
          v: `φ ${fmtDeg((360 * Math.floor(sceneHover.cell / model.nTheta)) / model.nPhi)} · θ ${fmtDeg((360 * (sceneHover.cell % model.nTheta)) / model.nTheta)}`,
        },
      ]}
    />
  );
  const sliceValues = (h: { m: number; i: number }) => ({
    T: formatNumber(cellMean(xs.T, h.m, h.i, model.nTheta), 3),
    B: formatNumber(cellMean(xs.B, h.m, h.i, model.nTheta), 3),
    where: `φ ${fmtDeg(sliceDeg)} · θ ${fmtDeg((360 * (h.i + 0.5)) / model.nTheta)} · ρ ${formatNumber(xs.rho[h.m]!, 3)}–${formatNumber(xs.rho[Math.min(nSurf - 1, h.m + 1)]!, 3)}`,
  });
  const sliceNow = sliceHover && sliceValues(sliceHover);
  const sliceReadOut = sliceHover && sliceNow && (
    <ReadOut
      testId="slice-readout"
      x={sliceHover.x}
      y={sliceHover.y}
      rows={[
        { k: 'Temperature', v: `${sliceNow.T} keV`, status: modelPill },
        { k: '|B|', v: `${sliceNow.B} T`, status: fieldStatus },
        { k: 'Where', v: sliceNow.where },
      ]}
    />
  );
  // Screen readers hear the keyboard cursor's read-out once per move (not on every refresh while playing).
  const sliceKey = sliceHover?.source === 'keyboard' ? `${sliceJ}:${sliceHover.m}:${sliceHover.i}` : '';
  useEffect(() => {
    if (!sliceKey || !sliceNow) {
      setSliceSay('');
      return;
    }
    setSliceSay(
      `Temperature ${sliceNow.T} keV (model), |B| ${sliceNow.B} T (${fieldWords}), at ${sliceNow.where.replace(/ · /g, ', ')}.`,
    );
    // Only a cursor move (or a new plane) is announced; the values at that moment are read from this render.
  }, [sliceKey]);
  const xsT = sliceExtremes(xs.T, xs.rho, model.nTheta);
  const xsB = sliceExtremes(xs.B, xs.rho, model.nTheta);
  const at = (e: { rho: number; thetaDeg: number }) => (e.rho === 0 ? 'axis' : `ρ ${formatNumber(e.rho, 3)}, θ ${fmtDeg(e.thetaDeg)}`);

  // The key draws the arrow and the slice marks over the surface's own ramp, as they appear in 3D.
  const markGround = colorBy === 'temperature' ? heatGradientCss(theme) : fieldGradientCss(theme);
  const tempBar = (range: readonly [number, number], note: string) => (
    <ColorBar kind="temperature" range={range} theme={theme} title="Temperature" unit="keV" decimals={3} status={modelPill} note={note} />
  );
  const fieldBar = (
    <ColorBar
      kind="field"
      range={ranges.B}
      theme={theme}
      title="|B|"
      unit="T"
      decimals={2}
      status={fieldStatus}
      note="VMEC |B| over every flux surface, widened by the largest illustrative coil perturbation (model) so no coil state leaves the bar."
    />
  );

  return (
    <div className="hf-layout" data-playing={playback.playing ? 'true' : 'false'}>
      <div className="hf-layout__notes">
        <Callout tone="info" title="Illustrative model — not a W7-X simulation">
          <p>
            The geometry and |B| are real (VMEC {art.equilibrium.name}, derived). Temperatures, heat fluxes, tile temperatures and
            predictions come from a reduced model whose parameters are chosen for illustration, not fitted to measurements; they carry
            the Model label.
          </p>
          <details className="hf-details hf-details--note">
            <summary>What the model does</summary>
            <p>{art.model.summary}</p>
          </details>
        </Callout>
        <Callout tone="info" title="Schematic diverter positions">
          {art.diverters.note}
        </Callout>
        {!isStable(stability) && (
          <Callout tone="warn" title={<SubscriptText text={UNSTABLE_TITLE} />}>
            The explicit step of this artifact&apos;s model has stability number{' '}
            <span className="lab-num">{formatNumber(stability, 4)}</span>, above 1 (see the equation panel): read every model number in
            this view with care.
          </Callout>
        )}
      </div>

      <Panel
        className="hf-layout__scene"
        eyebrow={`${VIEW} · illustrative model`}
        title="W7-X last closed flux surface: model temperature and |B|"
        subtitle="Drag or use the arrow keys to turn the torus; hover the surface for a read-out. Diverter plates are black with a light edge."
        status={
          <span className="hf-badges">
            <ProvenanceBadge provenance={art.provenance} subject="temperatures, heat fluxes and tile temperatures" caption="Temperatures" />
            <ProvenanceBadge provenance={art.geometryProvenance} subject="geometry and |B|" caption="Geometry and |B|" />
          </span>
        }
        actions={<SegmentedControl<ColorBy> label="Colour by" options={COLOR_OPTIONS} value={colorBy} onChange={setColorBy} />}
        footer={
          <>
            Equilibrium: {art.equilibrium.source.label}{' '}
            <span className="lab-mono" title={`sha256 ${art.equilibrium.source.sha256}`}>
              sha256 {art.equilibrium.source.sha256.slice(0, 10)}…
            </span>
          </>
        }
      >
        <div className="hf-play" role="group" aria-label="Playback">
          <button
            type="button"
            className="hf-btn hf-btn--primary"
            onClick={() => playback.setPlaying(!playback.playing)}
            aria-describedby={`${ids.scene}-clock`}
          >
            {playback.playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="hf-btn" onClick={nudge}>
            Advance {formatNumber(NUDGE_S, 1)} s
          </button>
          <button type="button" className="hf-btn" onClick={reset}>
            Reset to start
          </button>
          <SegmentedControl<string>
            label="Playback speed"
            size="sm"
            options={SPEED_OPTIONS}
            value={String(playback.speed)}
            onChange={(v) => playback.setSpeed(Number(v) as Speed)}
          />
          <p className="hf-clock" id={`${ids.scene}-clock`} data-testid="model-time">
            Model time <span className="lab-num">t = {formatNumber(frame.time, 3)} s</span>
            <span className="hf-clock__note">
              after a {formatNumber(p.spinup, 1)} s spin-up with every coil off · {playback.playing ? 'playing' : 'paused'}
            </span>{' '}
            {modelPill}
          </p>
        </div>
        <div className="hf-options">
          <label className="hf-check">
            <input type="checkbox" checked={showLines} onChange={(e) => setShowLines(e.target.checked)} /> Magnetic field lines
          </label>
          <label className="hf-check">
            <input type="checkbox" checked={showArrows} onChange={(e) => setShowArrows(e.target.checked)} /> Heat-flow arrows
          </label>
        </div>
        <HeatScene
          geom={geom}
          model={model}
          sim={sim}
          colorBy={colorBy}
          ranges={ranges}
          showLines={showLines}
          showArrows={showArrows}
          sliceJ={sliceJ}
          theme={theme}
          label={`3D view of the W7-X last closed flux surface coloured by ${colorBy === 'temperature' ? 'model temperature' : '|B|'}, with diverters ${divIds.join(', ')}`}
          describedBy={ids.scene}
          onHover={setSceneHover}
          overlay={sceneReadOut}
        />
        <div className="hf-keys">
          {colorBy === 'temperature'
            ? tempBar(
                ranges.lcfsT,
                `One logarithmic scale for every temperature map: ${formatNumber(ranges.lcfsT[0], 3)} keV (below the two-point target temperature) to the core temperature T_0, so the edge at the upstream temperature T_u has the same colour here and at the rim of the cross-section; anything colder takes the coldest colour.`,
              )
            : fieldBar}
          <ul className="hf-key" aria-label="Scene key">
            <li>
              <span className="hf-swatch hf-swatch--plate" aria-hidden="true" /> Diverter plate (schematic)
            </li>
            {showLines && (
              <li>
                <span className="hf-swatch hf-swatch--line" style={{ background: fieldGradientCss(theme) }} aria-hidden="true" /> Field line,
                coloured by |B| (VMEC; coil perturbation is model)
              </li>
            )}
            {showArrows && (
              <li>
                <MarkSwatch kind="arrow" ground={markGround} /> Heat flow (model), length ∝ √magnitude
              </li>
            )}
            <li>
              <MarkSwatch kind="slice" ground={markGround} /> Cross-section slice at φ {fmtDeg(sliceDeg)}, labelled “Slice φ {fmtDeg(sliceDeg)}”
            </li>
          </ul>
        </div>
        <p id={ids.scene} className="hf-summary" data-testid="scene-summary">
          {summary}
        </p>
      </Panel>

      <div className="hf-layout__side">
        <Panel
          eyebrow={VIEW}
          title={`Cross-section at φ = ${fmtDeg(sliceDeg)}${sliceDiv ? ` (${sliceDiv.id})` : ''}`}
          subtitle={`Poloidal slice through every flux surface, equal R and Z scale. Inside ρ = ${trimNumber(p.rhoBlend)} the temperature is the model's core profile.`}
          status={
            <span className="hf-badges">
              {modelPill}
              {vmecPill}
            </span>
          }
          density="compact"
        >
          <div className="hf-slider">
            <label htmlFor={`${ids.slice}-phi`} className="hf-slider__label">
              Toroidal angle φ <span className="lab-num">{fmtDeg(sliceDeg)}</span>
            </label>
            <input
              id={`${ids.slice}-phi`}
              type="range"
              min={0}
              max={360 - 360 / model.nPhi}
              step={360 / model.nPhi}
              value={sliceDeg}
              onChange={(e) => setSliceJ(Math.round((Number(e.target.value) / 360) * model.nPhi) % model.nPhi)}
              aria-valuetext={`${fmtDeg(sliceDeg)}${sliceDiv ? `, diverter ${sliceDiv.id}` : ''}`}
            />
            <div className="hf-slider__jumps" role="group" aria-label="Go to a diverter">
              {art.diverters.items.map((d, k) => (
                <button
                  key={d.id}
                  type="button"
                  className="hf-btn hf-btn--sm"
                  aria-pressed={sliceJ === planes[k]}
                  onClick={() => setSliceJ(planes[k]!)}
                >
                  Go to {d.id}
                </button>
              ))}
            </div>
          </div>
          <CrossSection
            layout={layout}
            values={colorBy === 'temperature' ? xs.T : xs.B}
            nTheta={model.nTheta}
            colorBy={colorBy}
            range={colorBy === 'temperature' ? ranges.sliceT : ranges.B}
            theme={theme}
            phiDeg={sliceDeg}
            onHover={setSliceHover}
            startCell={startCell}
            announcement={sliceSay}
            overlay={sliceReadOut}
            edge={edge}
          />
          {colorBy === 'temperature' ? (
            <>
              {tempBar(
                ranges.sliceT,
                `The same logarithmic scale as the 3D surface: ${formatNumber(ranges.sliceT[0], 3)} keV to the core temperature T_0 on the axis; anything colder takes the coldest colour.`,
              )}
              <ColorBar
                kind="temperature"
                range={ranges.lcfsT}
                theme={theme}
                title="Edge (LCFS), same scale as the 3D view"
                unit="keV"
                decimals={3}
                status={modelPill}
                note="The strip just outside the last closed flux surface: its model temperature at this φ on the 3D surface's range, where the cold footprint under a diverter and its move with the field adjustments show."
              />
            </>
          ) : (
            fieldBar
          )}
          <div className="hf-table-wrap" role="region" aria-label={`Slice summary at φ ${fmtDeg(sliceDeg)}`} tabIndex={0}>
            <table className="hf-table" data-testid="slice-summary">
              <caption className="hf-loop__caption">
                Slice at φ {fmtDeg(sliceDeg)}
                {sliceDiv ? ` (${sliceDiv.label})` : ''}: lowest and highest values
              </caption>
              <thead>
                <tr>
                  <th scope="col">Quantity</th>
                  <th scope="col">Lowest</th>
                  <th scope="col">Highest</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Temperature (keV) {modelPill}</th>
                  <td className="lab-num">
                    {formatNumber(xsT.min.value, 3)} <span className="hf-where">at {at(xsT.min)}</span>
                  </td>
                  <td className="lab-num">
                    {formatNumber(xsT.max.value, 3)} <span className="hf-where">at {at(xsT.max)}</span>
                  </td>
                </tr>
                <tr>
                  <th scope="row">|B| (T) {fieldStatus}</th>
                  <td className="lab-num">
                    {formatNumber(xsB.min.value, 3)} <span className="hf-where">at {at(xsB.min)}</span>
                  </td>
                  <td className="lab-num">
                    {formatNumber(xsB.max.value, 3)} <span className="hf-where">at {at(xsB.max)}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <details className="hf-details hf-details--lcfs">
            <summary>Every θ on the last closed flux surface at φ {fmtDeg(sliceDeg)}</summary>
            <div className="hf-table-wrap" role="region" aria-label={`Last closed flux surface at φ ${fmtDeg(sliceDeg)}, every θ`} tabIndex={0}>
              <table className="hf-table" data-testid="lcfs-table">
                <caption className="lab-visually-hidden">
                  Model temperature and |B| at every θ of the last closed flux surface at φ {fmtDeg(sliceDeg)}, the values the 3D read-out
                  shows there
                </caption>
                <thead>
                  <tr>
                    <th scope="col">θ</th>
                    <th scope="col">Temperature (keV) {modelPill}</th>
                    <th scope="col">|B| (T) {fieldStatus}</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: model.nTheta }, (_, i) => {
                    const c = sliceJ * model.nTheta + i;
                    const thetaDeg = (360 * i) / model.nTheta;
                    return (
                      <tr key={i} data-theta={i}>
                        <th scope="row" className="lab-num">
                          {fmtDeg(thetaDeg)}
                        </th>
                        <td className="lab-num">{formatNumber(frame.T[c]!, 3)}</td>
                        <td className="lab-num">{formatNumber(frame.B[c]!, 3)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </Panel>

        <Panel
          eyebrow={VIEW}
          title="Diverters D1–D4"
          subtitle={`Peak tile temperature and heat flux now (t = ${formatNumber(frame.time, 2)} s), against the illustrative tile limit.`}
          status={modelPill}
          density="compact"
        >
          <DiverterPanel rows={rows} limit={p.tileLimit} onToggle={setCoil} onAllOff={allOff} />
        </Panel>
      </div>

      <Panel
        className="hf-layout__chart"
        eyebrow={VIEW}
        title="|B| against toroidal angle at the strike line"
        subtitle={`|B| on the last closed flux surface at θ = ${fmtDeg((360 * iStrike) / model.nTheta)}, redrawn as the coils sweep. Markers link it to the 3D view.`}
        status={
          <span className="hf-badges">
            {vmecPill}
            <StatusPill status="model">Model (coil perturbation)</StatusPill>
          </span>
        }
        actions={
          <span className="hf-snap">
            <button type="button" className="hf-btn" onClick={freeze}>
              Freeze snapshot
            </button>
            <button type="button" className="hf-btn" onClick={() => setSnapshot(null)} disabled={!snapshot}>
              Clear snapshot
            </button>
          </span>
        }
      >
        <FieldChart
          sim={sim}
          iStrike={iStrike}
          yRange={yRange}
          snapshot={snapshot}
          sliceDeg={sliceDeg}
          hoverDeg={hoverDeg}
          diverters={diverterMarks}
          theme={theme}
          ticks={playback.chartTicks}
        />
      </Panel>

      <Panel
        className="hf-layout__loop"
        eyebrow={VIEW}
        title="Control loop: heat map → predict → adjust field → new heat map"
        subtitle={`Prediction horizon ${formatNumber(HORIZON_S, 1)} s of model time.`}
        status={modelPill}
      >
        <ControlLoop
          sim={sim}
          onChange={refresh}
          horizonS={HORIZON_S}
          playing={playback.playing}
          play={() => playback.setPlaying(true)}
        />
      </Panel>

      <Panel
        className="hf-layout__equation"
        eyebrow={VIEW}
        title="The equation used to predict heat movement"
        subtitle={`${art.model.name}. Parameters chosen for illustration, not fitted to measurements.`}
        status={modelPill}
      >
        <EquationPanel art={art} stability={stability} />
      </Panel>
    </div>
  );
}
