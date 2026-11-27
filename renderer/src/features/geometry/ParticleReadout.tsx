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
      if (!live.length) return <p className="particle-readout__note">Each tracer streams along its own magnetic field line round the torus (no plasma yet).</p>;
      const mean = (f: (r: (typeof live)[number]) => number) => live.reduce((a, r) => a + f(r), 0) / live.length;
      const speed = mean((r) => r.screenSpeed), cs = mean((r) => r.soundSpeed), slow = mean((r) => r.slowdown);
      return <p className="particle-readout__note" data-testid="particle-slowdown">
        Each tracer streams along its own magnetic field line on the last closed surface, round and round the torus: on a
        closed surface a field line never ends, so the particle never stops (model, equilibrium field lines). A thermal ion
        moves at about the sound speed, {(cs / 1000).toFixed(0)} km/s (the net flow on closed surfaces is much slower,
        ions stream both ways); here the tracers move about {speed.toFixed(1)} m/s, about
        {' '}{Math.round(slow / 1000).toLocaleString('en-GB')} thousand times slower, in one direction only. Heat reaches
        the divertors in the scrape-off layer just outside (the glowing dots). No gyration or drifts are drawn. "Peak flux"
        is the load on the divertor each tracer is passing.
      </p>;
    })()}
    <table><thead><tr><th>Tracer</th><th>Near</th><th>Divertor peak flux<br/>MW/m²</th><th>|B| (T)</th><th>T (keV)</th></tr></thead>
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
