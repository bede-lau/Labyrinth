import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, type ThemeName } from '../../design';
import { ControlLoop, type LoopDecision } from '../heatfield/ControlLoop';
import { HeatScene, type HeatSceneProps, type HoverPoint } from '../heatfield/HeatScene';
import { usePlayback, usePrefersReducedMotion } from '../heatfield/playback';
import { ARROWS, buildSceneGeometry } from '../heatfield/scene';
import { Simulation } from '../heatfield/sim';
import type { HeatfieldArtifact } from '../heatfield/types';
import '../heatfield/heatfield.css';
import type { TubeField } from './tubeResponse';
import { StrikeMonitor } from './StrikeMonitor';
import { heatedRanges } from './heatedEdge';
import type { ParticleTracks } from './particleTracks';
import { CoreSlice } from './CoreSlice';
import type { SceneModel } from './model';
import { HEAT_STOPS, mountPlasmaLayers, type Layers } from './plasmaLayers';

interface Props {
  onPowerOff: () => void;
  tracks: ParticleTracks;
  followed: number | null;
  feedback: boolean;
  onFeedback: (enabled: boolean) => void;
  onDecision: (decision: LoopDecision) => void;
  response: TubeField;
  model: SceneModel;
  theme: ThemeName;
  label: string;
  art: HeatfieldArtifact;
  sim: Simulation;
  slice: number;
  setSlice: (v: number) => void;
  renderControls: (toolbar: ReactNode) => ReactNode;
}

const sceneLayers: { id: keyof Layers; label: string; icon: string }[] = [
  { id: 'heat', label: 'Heat map', icon: 'M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-2 1-4 3-6 0 3 1 4 2 4 2-3 2-6 1-9Z M12 15c-1 1-2 2-2 3a2 2 0 0 0 4 0c0-1-1-2-2-3Z' },
  { id: 'particles', label: 'Plasma particles', icon: 'M6 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0 M14 6a2 2 0 1 0 4 0 2 2 0 1 0-4 0 M13 18a2 2 0 1 0 4 0 2 2 0 1 0-4 0' },
  { id: 'lines', label: 'Magnetic field lines', icon: 'M3 10c3 0 3-5 8-5s5 5 10 5 M3 14c3 0 3-5 8-5s5 5 10 5 M3 18c3 0 3-5 8-5s5 5 10 5' },
  { id: 'hardware', label: 'W7-X hardware', icon: 'M3 12c0-4 4-7 9-7s9 3 9 7-4 7-9 7-9-3-9-7Z M8 12c0-2 2-3 4-3s4 1 4 3-2 3-4 3-4-1-4-3Z M6 7l3 3m6 4 3 3m0-10-3 3m-6 4-3 3' },
];
const initial: Layers = { heat: true, particles: true, lines: false, hardware: false };

function Scale({ label, range, gradient, unit }: { label: string; range: readonly number[]; gradient: string; unit: string }) {
  return <div className="plasma-scale"><span>{label}</span><i style={{ background: gradient }} />
    <span>{range[0]!.toFixed(2)}–{range[1]!.toFixed(2)} {unit}</span></div>;
}

function SurfaceReading({hit, sim, plane}: {hit: HoverPoint; sim: Simulation; plane: number}) {
  const output = useRef<HTMLOutputElement>(null);
  useEffect(() => {
    const draw = () => {
      const section = hit.section ? sim.model.crossSection(sim.state,sim.coils,plane) : null;
      const sample = (grid: Float64Array) => hit.interpolation
        ? hit.interpolation.cells.reduce((sum, cell, k) => sum + grid[cell]! * hit.interpolation!.weights[k]!, 0)
        : grid[hit.cell]!;
      const t = sample(section?.T ?? sim.state.T);
      const b = sample(section?.B ?? sim.field());
      if (output.current) output.current.value = t.toFixed(3) + ' keV  ·  ' + b.toFixed(3) + ' T';
    };
    draw();
    return sim.subscribe(draw);
  }, [sim,hit,plane]);
  return <output ref={output} className="geo-probe" aria-label="Plasma temperature and magnetic field strength"
    style={{left: `clamp(5rem, ${hit.x}px, calc(100% - 5rem))`, top: Math.max(0,hit.y-38)}} />;
}

export function PlasmaExplorer({ onPowerOff, tracks, followed, feedback, onFeedback, art, model: tubes, theme, label, sim, slice, setSlice, response, onDecision, renderControls }: Props) {
  const model = sim.model;
  const openPredictor = useCallback(() => {
    const worker = new Worker(new URL('./thermalForecast.worker.ts', import.meta.url), {type: 'module'});
    worker.postMessage({art});
    return worker;
  }, [art]);
  const geom = useMemo(() => buildSceneGeometry(art, model, model.heatFlow(sim.start, sim.coils), { ...ARROWS, strideTheta: 8, stridePhi: 5 }), [art, model, sim]);
  const ranges = useMemo(() => heatedRanges(art, sim), [art, sim]);
  const [layers, setLayers] = useState(initial);
  useEffect(() => {
    if (followed != null) setLayers(current => current.particles ? current : {...current, particles: true});
  }, [followed]);
  const manualLines = useRef(false);
  const [plates, setPlates] = useState(() => art.diverters.items.map(() => true));
  const [hit, setHit] = useState<HoverPoint | null>(null);
  const temperatures = useRef<(HTMLOutputElement | null)[]>([]);
  useEffect(() => { setHit(null); }, [layers, slice, tubes]);
  const [temperaturesVisible, setTemperaturesVisible] = useState(true);
  const id = useId();
  const latest = useRef(layers);
  latest.current = layers;
  const extend = useCallback<NonNullable<HeatSceneProps['extend']>>(
    (three, content) => mountPlasmaLayers(three, content, art, tubes, response, theme, tracks, () => latest.current),
    [art, tubes, response, theme, tracks],
  );
  const reduced = usePrefersReducedMotion();
  const clock = useRef<HTMLOutputElement>(null);
  const [powered, setPowered] = useState(false);
  const playback = usePlayback(sim, false, () => {});
  useEffect(() => {
    const syncClock = () => {
      temperatures.current.forEach((el,k) => {
        if (!el) return;
        const peak = sim.peakTileC(k);
        const hot = peak >= model.params.tileLimit;
        el.value = peak.toFixed(1) + ' °C';
        const button = el.parentElement!;
        button.dataset.hot = String(hot);
        button.setAttribute('aria-description', [hot ? 'Overheating' : '', temperaturesVisible ? el.value : ''].filter(Boolean).join('. '));
      });
      if (clock.current) clock.current.value = sim.time.toFixed(3) + ' s';
    };
    syncClock();
    return sim.subscribe(syncClock);
  }, [sim, model, temperaturesVisible]);
  useEffect(() => { if (reduced) playback.setPlaying(false); }, [reduced, playback.setPlaying]);
  const deg = Math.round(360 * slice / model.nPhi);
  const heatGradient = 'linear-gradient(to right,' + HEAT_STOPS.join(',') + ')';
  return <div className="plasma-explorer" data-feedback={feedback}>
    <div className="plasma-layers" role="group" aria-label="Scene layers">
      {sceneLayers.map(({ id, label, icon }) => (
        <button type="button" key={id} title={id === 'hardware' ? 'Vessel and coils with a tokamak solenoid comparison' : undefined} aria-pressed={layers[id]}
          onClick={() => {
            if (id === 'lines') manualLines.current = !layers.lines;
            setLayers(current => ({ ...current, [id]: !current[id] }));
          }}>
          <svg className="plasma-layers__icon" viewBox="0 0 24 24" aria-hidden="true"><path d={icon} /></svg>
          <span>{label}</span>
          {layers[id] && <span className="plasma-layers__check"><Icon name="check" size={14} /></span>}
        </button>
      ))}
    </div>
    <HeatScene inspection initialOrbit={{ azimuth: -1.08, elevation: 0.52, distance: 3.4 }} geom={geom} model={model} sim={sim} theme={theme} ranges={ranges}
      colorBy="temperature" showArrows={false} showLines={layers.lines}
      showTemperatures={temperaturesVisible} followed={followed}
      sliceJ={slice} visiblePlates={plates} extend={extend} displayRevision={layers}
      onHover={setHit}
      overlay={<>{hit && <SurfaceReading hit={hit} plane={slice} sim={sim}/>}{powered && layers.heat && <CoreSlice art={art} sim={sim} plane={slice} range={ranges.sliceT} />}</>}
      label={label + '. Illustrative plasma heat and optional reactor hardware'} />
    <div className="reactor-controls">
      <button type="button" className="reactor-power" data-on={powered} onClick={() => {
        if (powered) { onPowerOff(); return; }
        setPowered(true);
        playback.setPlaying(true);
      }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v10M7 5a8 8 0 1 0 10 0"/></svg>
        {powered ? 'Power off' : 'Start reactor'}
      </button>
      <ControlLoop disabled={!powered} balanceHeat openPredictor={openPredictor} onDecision={onDecision} onToggle={enabled => {
        onFeedback(enabled);
        setLayers(current => ({...current, lines: enabled || manualLines.current}));
      }} sim={sim} horizonS={0.25} playing={playback.playing} play={() => playback.setPlaying(true)} />
      {/* TEMPORARY demo: force a heat transfer from the hottest diverter to the coolest, to see the animation. */}
      <button type="button" className="hf-btn" disabled={!powered} onClick={() => {
        if (sim.commandedTransfers.length) { sim.setCoils(sim.commandedCoils, []); return; }
        const peaks = sim.coils.map((_, k) => sim.peakTileC(k));
        const from = peaks.indexOf(Math.max(...peaks)), to = peaks.indexOf(Math.min(...peaks));
        sim.setCoils(sim.commandedCoils, [{from, to: to === from ? (from + 1) % peaks.length : to, fraction: 0.4}]);
      }}>Demo transfer</button>
    </div>
    <div className="plasma-transport">
      <button type="button" className="hf-btn" disabled={!powered} onClick={() => playback.setPlaying(!playback.playing)}>
        {playback.playing ? 'Pause flow' : 'Play flow'}
      </button><output aria-live="off" ref={clock}>0.0 s</output>
      <label className="plasma-speed">
        <input type="range" min="0.5" max="1" step="0.5" aria-label="Simulation speed"
          value={playback.speed} aria-valuetext={playback.speed + ' times normal speed'}
          onChange={e => playback.setSpeed(e.currentTarget.valueAsNumber)} />
        <b>{playback.speed === 0.5 ? '0.50×' : '1.0×'}</b>
      </label>
    </div>
    {feedback && <StrikeMonitor sim={sim}/>}
    {renderControls(
      <div className="plasma-toolbar">
        <div className="plasma-slice">
          <label htmlFor={id}>Toroidal angle <b>{deg}°</b></label>
          <input id={id} type="range" min={0} max={model.nPhi - 1} step={1} value={slice} aria-valuetext={deg + ' degrees'}
            onChange={e => setSlice(Number(e.target.value))} />
        </div>
        <label className="temperature-switch"><input type="checkbox" role="switch" checked={temperaturesVisible}
          onChange={e => setTemperaturesVisible(e.currentTarget.checked)} /> Temperature labels</label>
        <div className="plasma-plates" role="group" aria-label="Schematic divertors">
          <span>Divertors <small>(schematic)</small></span>
          {art.diverters.items.map(({ id }, k) => <button type="button" key={id} aria-label={id} aria-pressed={plates[k]}
            onClick={() => setPlates(v => v.map((on, i) => i === k ? !on : on))}><span>{id} <svg className="plate-warning" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 10 18H2Z"/><path d="M12 8v5m0 3v1"/></svg></span> <output hidden={!temperaturesVisible} ref={el => { temperatures.current[k] = el; }} aria-label={id + ' peak tile temperature'} aria-live="off" /></button>)}
        </div>
        <div className="plasma-scales">
          {layers.heat && <Scale label="Edge heat" unit="keV" range={ranges.lcfsT} gradient={heatGradient} />}
          {layers.heat && <Scale label="Core slice" unit="keV" range={ranges.sliceT} gradient={heatGradient} />}
        </div>
      </div>
    )}
  </div>;
}
