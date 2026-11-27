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
    {(() => {
      const live = rows.filter((r) => r.slowdown > 0);
      if (!live.length) return <p className="particle-readout__note">Each tracer follows a magnetic field line into its divertor (no plasma yet).</p>;
      const mean = (f: (r: (typeof live)[number]) => number) => live.reduce((a, r) => a + f(r), 0) / live.length;
      const flight = mean((r) => r.realFlight), slow = mean((r) => r.slowdown), drawn = mean((r) => r.drawnLength);
      return <p className="particle-readout__note" data-testid="particle-slowdown">
        Each tracer streams along a magnetic field line into its divertor (model). It shows the last
        ~{drawn.toFixed(0)} m of a ~200 m connection length that winds many times round the island; real ions take at
        least {(1000 * flight).toFixed(1)} ms for the whole length (they reach the sound speed only at the target). On
        screen they move about {Math.round(slow / 1000).toLocaleString('en-GB')} thousand times slower than the sound
        speed. Drawn on the last closed surface (the scrape-off layer lies just outside it), in one direction only, without
        gyration or drifts.
      </p>;
    })()}
    <table><thead><tr><th>Tracer</th><th>Diverter</th><th>Peak flux<br/>MW/m²</th><th>|B| (T)</th><th>T (keV)</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <th scope="row"><button type="button" className="tracer-pick" aria-label={'Follow particle P'+row.id}
          title={'Follow particle P'+row.id} aria-pressed={followed === row.id}
          onClick={() => onFollow(followed === row.id ? null : row.id)}>
          <i style={{background: particleColours[row.id-1]}}/>P{row.id}
        </button></th>
        <td>{'D'+(row.from+1)}</td><td>{row.flux.toFixed(2)}</td>
        <td>{row.field.toFixed(2)}</td><td>{row.temperature.toFixed(3)}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}
