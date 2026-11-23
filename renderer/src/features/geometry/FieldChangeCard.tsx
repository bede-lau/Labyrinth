import { useEffect, useState, type CSSProperties } from 'react';
import { plasmaMaterials } from '../../design/tokens';
import { particleColours, type ParticleTracks } from './particleTracks';
import type { Simulation } from '../heatfield/sim';

const left = 47, right = 336, midline = 82, halfHeight = 45;
const degrees = (radians: number) => radians * 180 / Math.PI;
const x = (angle: number) => left + (right - left) * angle / 360;
const signed = (value: number) => (value < 0 ? '−' : '+') + Math.abs(value).toFixed(4);

// Follow the edge at the poloidal grid point nearest the divertor strike centre.
export function sampleFieldChange(sim: Simulation) {
  const { model } = sim;
  const i = (Math.round(model.thetaD / model.dTheta) % model.nTheta + model.nTheta) % model.nTheta;
  const field = sim.field();
  const profile = Array.from(model.phi, (phi, j) => {
    const cell = j * model.nTheta + i;
    const baseline = model.Bs[cell]!;
    return { angle: degrees(phi), change: (field[cell]! - baseline) / baseline };
  });
  // Skip the periodic duplicate at 360°. Keep each local peak, including negative changes.
  const peaks = profile.filter(({change}, j) => {
    const prev = profile[(j + profile.length - 1) % profile.length]!;
    const next = profile[(j + 1) % profile.length]!;
    return Math.abs(change) >= 0.00005 && Math.abs(change) > Math.abs(prev.change) &&
      Math.abs(change) >= Math.abs(next.change);
  }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  return { time: sim.time, profile, peaks };
}

type Entry = { time: number; angle: number; change: number };

function readFrame(sim: Simulation, tracks: ParticleTracks) {
  return { ...sampleFieldChange(sim), particles: tracks.read() };
}

export function FieldChangeCard({sim, tracks, followed}: {
  sim: Simulation; tracks: ParticleTracks; followed: number | null;
}) {
  const [frame, setFrame] = useState(() => readFrame(sim, tracks));
  const [log, setLog] = useState<Entry[]>([]);
  useEffect(() => {
    let lastEntry = -Infinity;
    return sim.subscribe(() => {
      const next = readFrame(sim, tracks);
      setFrame(next);
      if (!next.peaks.length || next.time - lastEntry < 0.18) return;
      lastEntry = next.time;
      const rows = next.peaks.map(peak => ({...peak, time: next.time}));
      setLog(old => [...rows, ...old].slice(0, 8));
    });
  }, [sim, tracks]);

  const bound = Math.max(sim.model.params.epsilon, ...frame.profile.map(p => Math.abs(p.change)));
  const y = (change: number) => midline - halfHeight * change / bound;
  const points = [...frame.profile, {...frame.profile[0]!, angle: 360}];
  const trace = points.map(p => x(p.angle).toFixed(2) + ',' + y(p.change).toFixed(2)).join(' ');
  const particle = frame.particles.find(row => row.id === followed);
  const angle = particle ? degrees(particle.phi) : 0;
  const markerX = x(angle);
  const badgeX = Math.max(left, Math.min(right - 6, markerX));
  const colour = particle && particleColours[particle.id - 1];
  // Interpolate the plotted profile, including its final segment back to 0°.
  const cell = angle * frame.profile.length / 360;
  const index = Math.min(Math.floor(cell), frame.profile.length - 1);
  const a = frame.profile[index]!.change;
  const b = frame.profile[(index + 1) % frame.profile.length]!.change;
  const markerY = y(a + (cell - index) * (b - a));
  const destination = particle?.steered ? particle.to : null;
  const summary = 'Signed fractional change in edge field by toroidal angle' +
    (particle ? `, P${particle.id} at ${angle.toFixed(1)}°` : '') +
    (destination !== null ? `, redirected to D${destination + 1}` : '');
  return <section className="calc-log field-change" aria-label="Magnetic field change">
    <div className="calc-log__head"><h2>Magnetic field change</h2><time>{frame.time.toFixed(2)} s</time></div>
    <svg style={{'--particle-ink': plasmaMaterials.targetCold} as CSSProperties} viewBox="0 0 352 166" role="img" aria-label={summary}>
      <text x="4" y="15">ΔB/B₀</text>
      {sim.model.phiK.map((phi, k) => <g key={k}>
        <line className="field-change__guide" x1={x(degrees(phi))} x2={x(degrees(phi))} y1="34" y2="129" />
        {k === destination && <g className="field-change__target" transform={`translate(${x(degrees(phi))} 0)`}>
          <rect x="-14" y="16" width="28" height="19" rx="5" style={{fill: colour}} />
          <path d="M-3 35 L0 39 L3 35" style={{fill: colour}} />
        </g>}
        <text className={k === destination ? 'field-change__target-label' : undefined} x={x(degrees(phi))} y="30" textAnchor="middle">D{k + 1}</text>
      </g>)}
      {[-bound, 0, bound].map(tick => <g key={tick}>
        <line className={tick === 0 ? 'field-change__zero' : 'field-change__guide'} x1={left} x2={right} y1={y(tick)} y2={y(tick)} />
        <text x={left - 6} y={y(tick) + 4} textAnchor="end">{tick === 0 ? '0' : (tick > 0 ? '+' : '−') + Math.abs(tick).toFixed(2)}</text>
      </g>)}
      <polygon points={left + ',' + midline + ' ' + trace + ' ' + right + ',' + midline} />
      <polyline points={trace} />
      {frame.peaks.map(p => <circle key={p.angle} cx={x(p.angle)} cy={y(p.change)} r="3.5" />)}
      {particle && <g className="field-change__cursor">
        <line x1={markerX} x2={markerX} y1="39" y2="130" stroke={colour} strokeDasharray="3 2" />
        <circle cx={markerX} cy={markerY} r="5" style={{fill: colour}} />
        <rect x={badgeX - 20} y="132" width="40" height="18" rx="4" style={{fill: colour}} />
        <text x={badgeX} y="145" textAnchor="middle">{Math.round(angle)}°</text>
      </g>}
      {[0, 90, 180, 270, 360].filter(tick => !particle || Math.abs(x(tick) - badgeX) > 36).map(tick => <text key={tick} x={x(tick)} y="145" textAnchor="middle">{tick}°</text>)}
      <text x={(left + right) / 2} y="163" textAnchor="middle">Toroidal angle φ</text>
    </svg>
    <div className="field-change__log"><table aria-label="Field change log"><thead><tr><th>Time</th><th>Peak φ</th><th>ΔB/B₀</th></tr></thead>
      <tbody>{log.length ? log.map(row => <tr key={row.time + '/' + row.angle}>
        <td>{row.time.toFixed(2)} s</td><td>{Math.round(row.angle)}°</td><td>{signed(row.change)}</td>
      </tr>) : <tr><td>—</td><td>—</td><td>—</td></tr>}</tbody>
    </table></div>
  </section>;
}
