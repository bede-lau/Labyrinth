// Inspect spatial parallelism (replay): GENE-X on the separate Dommaschk geometry, PRD-reported.
// The PRD figures (speedup, run tally, the two means) and what backs them come from the artifact's
// `fixtures` (D-023); the tally marks from `runs`.
import { useEffect, useId, useState } from 'react';
import {
  Callout,
  FixtureCheck,
  Icon,
  Panel,
  ProvenanceBadge,
  Stat,
  StatusPill,
  VERIFICATION_STATUS,
  type FixtureCheckData,
} from '../../design';
import { useArtifact } from '../../lib/artifacts';
import { ArtifactGate } from '../../shell/ArtifactGate';
import { SPATIAL_FIXTURE, fixtureById, fixtureUnit, otherFixtures, spatialBacking } from './model';
import { planeRange, ringLayout } from './ring';
import { checkSpatial, type SpatialArtifact } from './types';
import './spatial.css';

const VIEW = 'Spatial parallelism';
export const GEOMETRY_LABEL = 'Dommaschk geometry — not W7-X';

export function SpatialView() {
  const state = useArtifact<SpatialArtifact>('spatial');
  return (
    <ArtifactGate state={state} view={VIEW} file="artifacts/spatial.json" validate={checkSpatial}>
      {(a) => <SpatialContent a={a} />}
    </ArtifactGate>
  );
}

/** A PRD figure checked against this repo, exactly as the artifact records it (range, basis and all). */
function Check({ f }: { f: FixtureCheckData }) {
  return <FixtureCheck fixture={f} unit={fixtureUnit(f)} />;
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
  const compact = useMedia('(max-width: 640px)');
  const L = ringLayout(a, compact ? { width: 400, height: 400 } : undefined);
  const boundaries = new Map<string, { x: number; y: number; planes: [number, number] }>();
  for (const ar of L.arrows) {
    const key = [ar.fromPlane, ar.toPlane].sort((p, q) => p - q).join('-');
    if (!boundaries.has(key)) boundaries.set(key, { x: ar.labelX, y: ar.labelY, planes: [ar.fromPlane, ar.toPlane] });
  }
  const t = a.timing;
  const maxS = Math.max(t.cpuMeanS, t.gpuMeanS);
  const prov = a.provenance;
  // Each side panel's pill, wording and dashed outlines say what backs its own PRD figures, read from
  // their fixtures (D-023): a panel cannot keep saying "PRD-reported" once the artifact recomputes its
  // numbers, or stop saying it while it does not. The provenance record keeps its own badge above.
  const backed = spatialBacking(a);
  const speedup = fixtureById(a, SPATIAL_FIXTURE.speedup);
  const runsCheck = fixtureById(a, SPATIAL_FIXTURE.runs);
  const means = [fixtureById(a, SPATIAL_FIXTURE.cpuMean), fixtureById(a, SPATIAL_FIXTURE.gpuMean)].filter(
    (f): f is FixtureCheckData => f !== null,
  );
  const others = otherFixtures(a);
  const outcome = prov.verification.outcome;
  const failedRuns = a.runs.controlled - a.runs.passedReference;

  return (
    <div className="sp-layout">
      <Panel
        className="sp-layout__ring"
        eyebrow={`${VIEW} · replay`}
        title={`${a.code} on ${GEOMETRY_LABEL}`}
        subtitle={`Two GPUs advance coupled toroidal regions of one ${a.code} case: ${a.nPlanes} planes split across ${a.ranks.length} MPI ranks, halo exchanges at the rank boundaries, field solve on the CPU.`}
        status={<ProvenanceBadge provenance={prov} subject={`${a.code} spatial-parallelism replay`} />}
      >
        <p className="sp-geometry-label" data-testid="geometry-label">
          <Icon name="info" size={14} /> {GEOMETRY_LABEL}
        </p>
        <figure className={compact ? 'sp-ring sp-ring--compact' : 'sp-ring'}>
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
            {[...boundaries.values()].map((b) => (
              <text key={b.planes.join('-')} x={b.x} y={b.y} textAnchor="middle" className="sp-ring__boundary">
                <tspan x={b.x} dy="0">MPI halo exchange</tspan>
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
                <tspan x={arc.labelX} dy="0" className="sp-ring__rank-name">{`Rank ${arc.rank} · ${arc.device}`}</tspan>
                <tspan x={arc.labelX} dy="15">{`planes ${planeRange(arc.planes)}`}</tspan>
              </text>
            ))}
            <g data-testid="cpu-node" className="sp-cpu">
              <rect x={L.cx - 56} y={L.cy - 22} width={112} height={44} rx={6} className="sp-cpu__box" />
              <text x={L.cx} y={L.cy - 3} textAnchor="middle" className="sp-cpu__title">
                Field solve
              </text>
              <text x={L.cx} y={L.cy + 13} textAnchor="middle" className="sp-cpu__device">
                {a.fieldSolve.device}
              </text>
            </g>
          </svg>
          <figcaption className="sp-ring__caption">
            <ul className="sp-key" aria-label="Diagram key">
              {a.ranks.map((rk) => (
                <li key={rk.rank} className="sp-key__item">
                  <svg width="14" height="14" aria-hidden="true" className={`sp-rank--${rk.rank % 2}`}>
                    {rk.rank % 2 === 0 ? <circle cx="7" cy="7" r="6" className="sp-node__shape" /> : <rect x="1" y="1" width="12" height="12" rx="2" className="sp-node__shape" />}
                  </svg>
                  {`Rank ${rk.rank} on ${rk.device}: planes ${planeRange(rk.planes)}`}
                </li>
              ))}
              <li className="sp-key__item">
                <svg width="22" height="10" aria-hidden="true">
                  <line x1="1" x2="21" y1="5" y2="5" className="sp-ring__arrow" />
                </svg>
                {`MPI halo exchange, both directions at each rank boundary (${a.exchanges.length} transfers)`}
              </li>
              <li className="sp-key__item">
                <svg width="14" height="10" aria-hidden="true">
                  <rect x="1" y="1" width="12" height="8" rx="2" className="sp-cpu__box" />
                </svg>
                {`Field solve on the ${a.fieldSolve.device}, shared by both ranks`}
              </li>
            </ul>
          </figcaption>
        </figure>
        <Callout tone="info" title="The live W7-X tubes are independent">
          <p>{a.independenceNote}</p>
        </Callout>
      </Panel>

      <div className="sp-layout__side">
        <Panel
          eyebrow={GEOMETRY_LABEL}
          title="CPU vs GPU runtime"
          subtitle={`Mean wall-clock time per controlled run${backed.timing.reported ? ', as stated in the PRD' : ''}.`}
          status={<StatusPill status={backed.timing.status} />}
          density="compact"
        >
          <div className="sp-timing" data-testid="timing" data-kind={backed.timing.status}>
            <div className="sp-timing__row">
              <Stat label="CPU mean" value={t.cpuMeanS} unit="s" decimals={2} />
              <span className="sp-timing__bar" aria-hidden="true">
                <span className="sp-timing__fill sp-timing__fill--cpu" style={{ width: `${(t.cpuMeanS / maxS) * 100}%` }} />
              </span>
            </div>
            <div className="sp-timing__row">
              <Stat label="GPU mean" value={t.gpuMeanS} unit="s" decimals={2} />
              <span className="sp-timing__bar" aria-hidden="true">
                <span className="sp-timing__fill sp-timing__fill--gpu" style={{ width: `${(t.gpuMeanS / maxS) * 100}%` }} />
              </span>
            </div>
          </div>
          {/* Own container: the fixture rows reflow by the width of this side card, not the viewport.
              Basis, range and outcome are the artifact's: an arithmetic-only speedup reads as such. */}
          <div className="sp-fixture" data-testid="timing-checks">
            {speedup ? <Check f={speedup} /> : <p className="sp-small">The artifact carries no check of the speedup.</p>}
            {means.map((f) => (
              <Check key={f.id} f={f} />
            ))}
          </div>
          {backed.timing.reported && (
            <p className="sp-small">Dashed outlines: PRD-reported means that this repo cannot recompute.</p>
          )}
        </Panel>

        <Panel
          eyebrow={GEOMETRY_LABEL}
          title="Controlled runs"
          subtitle={`Runs compared against the ${a.code} reference${backed.runs.reported ? ', as stated in the PRD' : ''}.`}
          status={<StatusPill status={backed.runs.status} />}
          density="compact"
        >
          <div className="sp-tally" data-testid="tally" data-kind={backed.runs.status}>
            <Stat
              label="Passed the reference"
              value={a.runs.passedReference}
              unit={`of ${a.runs.controlled} runs`}
              decimals={0}
            />
            <ol className="sp-tally__runs" aria-hidden="true">
              {Array.from({ length: a.runs.controlled }, (_, i) => (
                <li key={i} className={i < a.runs.passedReference ? 'sp-tally__run sp-tally__run--pass' : 'sp-tally__run'}>
                  <Icon name={i < a.runs.passedReference ? 'check' : 'dash'} size={12} />
                  {i + 1}
                </li>
              ))}
            </ol>
            {failedRuns > 0 && (
              <p className="sp-small sp-tally__fail">
                {failedRuns} of {a.runs.controlled} runs did not pass the reference.
              </p>
            )}
          </div>
          <div className="sp-fixture" data-testid="runs-check">
            {runsCheck ? <Check f={runsCheck} /> : <p className="sp-small">The artifact carries no check of the run tally.</p>}
          </div>
        </Panel>

        <Panel
          eyebrow="Verification"
          title={outcome === 'blocked' ? 'Why this is not verified here' : outcome === 'failed' ? 'Verification failed' : 'Verification'}
          density="compact"
          status={<StatusPill status={VERIFICATION_STATUS[outcome]} />}
        >
          {outcome === 'blocked' ? (
            <Callout
              tone="blocked"
              title={`Plane ownership, the ${a.runs.passedReference}/${a.runs.controlled} passes and the timings cannot be checked`}
              action={
                <span>
                  <strong>To unblock:</strong> add the saved Dommaschk {a.code} checkpoints and timing logs to data/raw/ so
                  the replay can be rebuilt from data instead of the PRD.
                </span>
              }
            >
              <p>{prov.verification.details}</p>
            </Callout>
          ) : (
            <Callout
              tone={outcome === 'failed' ? 'warn' : 'info'}
              title={
                outcome === 'failed'
                  ? 'The verification recorded in the artifact failed'
                  : outcome === 'passed'
                    ? 'The artifact records a passed verification'
                    : 'No verification applies to this replay'
              }
            >
              <p>{prov.verification.details}</p>
            </Callout>
          )}
        </Panel>

        {others.length > 0 && (
          <Panel eyebrow={GEOMETRY_LABEL} title="Other PRD checks" density="compact">
            <div className="sp-fixture" data-testid="other-checks">
              {others.map((f) => (
                <Check key={f.id} f={f} />
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
