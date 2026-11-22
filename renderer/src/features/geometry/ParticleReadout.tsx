import { useEffect, useState } from 'react';
import type { Simulation } from '../heatfield/sim';
import { particleColours, type ParticleTracks } from './particleTracks';

export function ParticleReadout({sim, tracks, followed, onFollow}: {sim: Simulation; tracks: ParticleTracks; followed: number | null; onFollow: (id: number | null) => void}) {
  const [rows,setRows] = useState(() => tracks.read());
  useEffect(() => {
    const refresh = () => setRows(tracks.read());
    refresh();
    return sim.subscribe(refresh);
  }, [sim,tracks]);
  return <section className="particle-readout" aria-label="Plasma particle data">
    <h2>Plasma particles</h2>
    <table><thead><tr><th>Tracer</th><th>Route</th><th>Peak flux<br/>MW/m²</th><th>|B| (T)</th><th>T (keV)</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id} data-steered={row.steered}>
        <th scope="row"><button type="button" className="tracer-pick" aria-label={'Follow particle P'+row.id}
          title={'Follow particle P'+row.id} aria-pressed={followed === row.id}
          onClick={() => onFollow(followed === row.id ? null : row.id)}>
          <i style={{background: particleColours[row.id-1]}}/>P{row.id}
        </button></th>
        <td>{row.steered ? 'D'+(row.from+1)+' → D'+(row.to+1) : 'D'+(row.to+1)}</td><td>{row.flux.toFixed(2)}</td>
        <td>{row.field.toFixed(2)}</td><td>{row.temperature.toFixed(2)}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}
