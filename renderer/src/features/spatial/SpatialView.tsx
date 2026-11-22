import { useEffect, useId, useState } from 'react';
import { Panel } from '../../design';
import { SpatialReplay } from './SpatialReplay';
import { ScaleComparison } from './ScaleComparison';
import { useArtifact } from '../../lib/artifacts';
import { ArtifactGate } from '../../shell/ArtifactGate';
import { planeRange, ringLayout } from './ring';
import { checkSpatial, type SpatialArtifact } from './types';
import './spatial.css';

const VIEW = 'Spatial parallelism';
export function SpatialView() {
  const state = useArtifact<SpatialArtifact>('spatial');
  return (
    <ArtifactGate state={state} view={VIEW} file="artifacts/spatial.json" validate={checkSpatial}>
      {(a) => <SpatialContent a={a} />}
    </ArtifactGate>
  );
}

/** True while the media query matches (false where matchMedia is unavailable, e.g. jsdom). */
function useMedia(query: string): boolean {
  const get = () => typeof globalThis.matchMedia === 'function' && globalThis.matchMedia(query).matches;
  const [match, setMatch] = useState(get);
  useEffect(() => {
    if (typeof globalThis.matchMedia !== 'function') return;
    const mq = globalThis.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export function SpatialContent({ a }: { a: SpatialArtifact }) {
  const ids = { t: useId(), d: useId() };
  // Narrow screens: a square ring without side labels (the key below names the ranks), so text stays legible.
  const compact = useMedia('(max-width: 1040px)');
  const L = ringLayout(a, compact ? { width: 400, height: 400 } : undefined);
  const boundaries = new Map<string, { x: number; y: number; planes: [number, number] }>();
  for (const ar of L.arrows) {
    const key = [ar.fromPlane, ar.toPlane].sort((p, q) => p - q).join('-');
    if (!boundaries.has(key)) boundaries.set(key, { x: ar.labelX, y: ar.labelY, planes: [ar.fromPlane, ar.toPlane] });
  }
  const { cpuMeanS, gpuMeanS } = a.timing;
  const saved = cpuMeanS - gpuMeanS;
  const longest = Math.max(cpuMeanS, gpuMeanS);
  return (
    <div className="sp-atlas">
      <Panel title="One ring, two GPUs" className="sp-ring-panel">
        <SpatialReplay>{(phase) => (
          <figure data-ring-phase={phase} className={compact ? 'sp-ring sp-ring--compact' : 'sp-ring'}>
            <svg viewBox={`0 0 ${L.width} ${L.height}`} className="sp-ring__svg" role="img" aria-labelledby={ids.t} aria-describedby={ids.d}>
              <title id={ids.t}>{`Ring of ${a.nPlanes} toroidal planes on the Dommaschk geometry, coloured by MPI rank, with halo-exchange arrows and a CPU field solve`}</title>
              <desc id={ids.d}>
                {a.ranks.map((rk) => `Rank ${rk.rank} on ${rk.device} owns planes ${planeRange(rk.planes)}.`).join(' ') +
                  ' ' +
                  a.exchanges.map((e) => `Rank ${e.fromRank} sends plane ${e.planes[0]} data to rank ${e.toRank} (plane ${e.planes[1]}).`).join(' ') +
                  ` The field solve runs on the ${a.fieldSolve.device}.`}
              </desc>
              <defs>
                <marker id={`${ids.t}-head`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" className="sp-ring__head" />
                </marker>
              </defs>
              <circle cx={L.cx} cy={L.cy} r={L.r} className="sp-ring__track" />
              {L.arcs.map((arc) => (
                <path key={arc.rank} d={arc.d} className={`sp-ring__arc sp-rank--${arc.rank % 2}`} data-rank-arc={arc.rank} />
              ))}
              {phase === 'compute' && L.arcs.map(arc => (
                <path key={arc.rank} aria-hidden="true" d={arc.d} pathLength="100" className="sp-work-trail" data-sender={arc.rank} />
              ))}
              {L.spokes.map((s) => (
                <line key={s.rank} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} className="sp-ring__spoke" />
              ))}
              {L.arrows.map((ar) => (
                <path
                  key={`${ar.fromPlane}-${ar.toPlane}`}
                  d={ar.d}
                  className={`sp-ring__arrow sp-ring__arrow--${ar.track}`}
                  markerEnd={`url(#${ids.t}-head)`}
                  data-exchange={`${ar.fromPlane}->${ar.toPlane}`}
                  data-from-rank={ar.fromRank}
                  data-to-rank={ar.toRank}
                />
              ))}
              {phase === 'exchange' && L.arrows.map(ar => (
                <path key={ar.d} aria-hidden="true" d={ar.d} pathLength="100" className="sp-packet" data-sender={ar.fromRank} />
              ))}
              {[...boundaries.values()].map((b) => (
                <text key={b.planes.join('-')} x={b.x} y={b.y} textAnchor="middle" className="sp-ring__boundary">
                  <tspan x={b.x} dy="0">Share edge data</tspan>
                  <tspan x={b.x} dy="14">{`planes ${b.planes[0]} ↔ ${b.planes[1]}`}</tspan>
                </text>
              ))}
              {L.nodes.map((nd) => (
                <g key={nd.plane} data-plane={nd.plane} data-rank={nd.rank} className={`sp-node sp-rank--${nd.rank % 2}`}>
                  {nd.rank % 2 === 0 ? (
                    <circle cx={nd.x} cy={nd.y} r={L.nodeR} className="sp-node__shape" />
                  ) : (
                    <rect x={nd.x - L.nodeR * 0.9} y={nd.y - L.nodeR * 0.9} width={L.nodeR * 1.8} height={L.nodeR * 1.8} rx={4} className="sp-node__shape" />
                  )}
                  <text x={nd.x} y={nd.y + 4} textAnchor="middle" className="sp-node__label">
                    {nd.plane}
                  </text>
                </g>
              ))}
              {!compact && L.arcs.map((arc) => (
                <text key={arc.rank} x={arc.labelX} y={arc.labelY - 6} textAnchor={arc.anchor} className="sp-ring__rank">
                  <tspan x={arc.labelX} dy="0" className="sp-ring__rank-name">{arc.device}</tspan>
                  <tspan x={arc.labelX} dy="15">{`planes ${planeRange(arc.planes)}`}</tspan>
                </text>
              ))}
              <g data-testid="cpu-node" className="sp-cpu">
                <rect x={L.cx - 56} y={L.cy - 22} width={112} height={44} rx={6} className="sp-cpu__box" />
                <text x={L.cx} y={L.cy - 3} textAnchor="middle" className="sp-cpu__title">
                  Shared field
                </text>
                <text x={L.cx} y={L.cy + 13} textAnchor="middle" className="sp-cpu__device">
                  {a.fieldSolve.device}
                </text>
              </g>
            </svg>
            {compact && <figcaption className="sp-mobile-key">{[...L.arcs].sort((left, right) => left.labelX - right.labelX).map(r =>
              <span key={r.rank}>{r.device} · planes {planeRange(r.planes)}</span>)}</figcaption>}
          </figure>
        )}</SpatialReplay>
      </Panel>
      <section className="sp-race" aria-label="Runtime comparison">
        <h2>Time to finish</h2>
        <div className="sp-result"><strong>{(cpuMeanS / gpuMeanS).toFixed(2)}×</strong> speedup</div>
        <div className="sp-lanes">
          {([['CPU only', cpuMeanS], ['CPU + 2 GPUs', gpuMeanS]] as const).map(([label, seconds], i) =>
            <div className="sp-lane" key={label}>
              <div><b>{label}</b><span>{seconds.toFixed(2)} s</span></div>
              <div className="sp-track" aria-hidden="true"><i className={i ? 'sp-twin' : ''} style={{ width: `${100 * seconds / longest}%` }} /></div>
            </div>)}
        </div>
        <p className="sp-delta"><strong>{Math.abs(saved).toFixed(2)} s</strong> {saved >= 0 ? 'saved' : 'longer'} per run</p>
      </section>
      <ScaleComparison />
    </div>
  );
}
