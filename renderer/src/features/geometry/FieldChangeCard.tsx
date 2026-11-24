import { useEffect, useState } from 'react';
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

export function FieldChangeCard({sim}: {sim: Simulation}) {
  const [frame, setFrame] = useState(() => sampleFieldChange(sim));
  const [log, setLog] = useState<Entry[]>([]);
  useEffect(() => {
    let lastFrame = -Infinity;
    let lastEntry = -Infinity;
    return sim.subscribe(() => {
      if (sim.time > lastFrame && sim.time - lastFrame < 1 / 30) return;
      lastFrame = sim.time;
      const next = sampleFieldChange(sim);
      setFrame(next);
      if (!next.peaks.length || next.time - lastEntry < 0.18) return;
      lastEntry = next.time;
      const rows = next.peaks.map(peak => ({...peak, time: next.time}));
      setLog(old => [...rows, ...old].slice(0, 8));
    });
  }, [sim]);

  const bound = Math.max(sim.model.params.epsilon, ...frame.profile.map(p => Math.abs(p.change)));
  const y = (change: number) => midline - halfHeight * change / bound;
  const points = [...frame.profile, {...frame.profile[0]!, angle: 360}];
  const trace = points.map(p => x(p.angle).toFixed(2) + ',' + y(p.change).toFixed(2)).join(' ');
  return <section className="calc-log field-change" aria-label="Magnetic field change">
    <div className="calc-log__head"><h2>Magnetic field change</h2><time>{frame.time.toFixed(2)} s</time></div>
    <svg viewBox="0 0 352 166" role="img" aria-label="Signed fractional change in edge field by toroidal angle">
      <text x="4" y="15">ΔB/B₀</text>
      {sim.model.phiK.map((phi, k) => <g key={k}>
        <line className="field-change__guide" x1={x(degrees(phi))} x2={x(degrees(phi))} y1="34" y2="129" />
        <text x={x(degrees(phi))} y="30" textAnchor="middle">D{k + 1}</text>
      </g>)}
      {[-bound, 0, bound].map(tick => <g key={tick}>
        <line className={tick === 0 ? 'field-change__zero' : 'field-change__guide'} x1={left} x2={right} y1={y(tick)} y2={y(tick)} />
        <text x={left - 6} y={y(tick) + 4} textAnchor="end">{tick === 0 ? '0' : (tick > 0 ? '+' : '−') + Math.abs(tick).toFixed(2)}</text>
      </g>)}
      <polygon points={left + ',' + midline + ' ' + trace + ' ' + right + ',' + midline} />
      <polyline points={trace} />
      {frame.peaks.map(p => <circle key={p.angle} cx={x(p.angle)} cy={y(p.change)} r="3.5" />)}
      {[0, 90, 180, 270, 360].map(tick => <text key={tick} x={x(tick)} y="145" textAnchor="middle">{tick}°</text>)}
      <text x={(left + right) / 2} y="163" textAnchor="middle">Toroidal angle φ</text>
    </svg>
    <div className="field-change__log"><table aria-label="Field change log"><thead><tr><th>Time</th><th>Peak φ</th><th>ΔB/B₀</th></tr></thead>
      <tbody>{log.length ? log.map(row => <tr key={row.time + '/' + row.angle}>
        <td>{row.time.toFixed(2)} s</td><td>{Math.round(row.angle)}°</td><td>{signed(row.change)}</td>
      </tr>) : <tr><td>—</td><td>—</td><td>—</td></tr>}</tbody>
    </table></div>
  </section>;
}
