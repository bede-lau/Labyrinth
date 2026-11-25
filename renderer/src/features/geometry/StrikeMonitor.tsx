import { useEffect, useRef } from 'react';
import { peakOffset } from './divertorTargets';
import type { Simulation } from '../heatfield/sim';
import { rampColor } from '../../design/sceneTheme';
import { plasmaMaterials } from '../../design/tokens';
import { rgbToHex } from '../heatfield/scene';

const colours = Array.from({ length: 128 }, (_, i) => rgbToHex(rampColor(plasmaMaterials.temperature, i / 127)));

// Show the same poloidal load bins used by the 3D tiles, enlarged in a fixed
// frame. The cursor marks the highest deposition on this target at this step.
export function StrikeMonitor({ sim }: { sim: Simulation }) {
  const group = useRef<HTMLDivElement>(null);
  const { nTheta, nDiverters, dTheta, thetaD, params } = sim.model;
  const centre = Math.round(thetaD / dTheta);
  const span = Math.ceil((params.sweepAmplitude + 3 * params.sigmaTheta) / dTheta);
  const indices = Array.from({ length: 2 * span + 1 }, (_, i) => (centre - span + i + nTheta) % nTheta);
  useEffect(() => {
    const rows = group.current?.children;
    if (!rows) return;
    const limit = (params.tileLimit - params.Tcool) / params.tileGain;
    const samples = new Float64Array(indices.length);
    const render = () => {
      const loads = sim.model.stripLoads(sim.state, sim.coils);
      for (let k = 0; k < nDiverters; k++) {
        const row = rows[k]!;
        const bins = row.querySelectorAll<HTMLElement>('i');
        let peak = 0;
        indices.forEach((i, j) => {
          const q = loads[k * nTheta + i]!;
          samples[j] = q;
          bins[j]!.style.backgroundColor = colours[Math.round(127 * Math.max(0, Math.min(1, q / limit)))]!;
          if (q > loads[k * nTheta + indices[peak]!]!) peak = j;
        });
        row.querySelector('b')!.textContent = loads[k * nTheta + indices[peak]!]!.toFixed(1);
        row.querySelector<HTMLElement>('.geo-strike__cursor')!.style.left = (100 * (peak + peakOffset(samples, peak) + 0.5)) / indices.length + '%';
        row.setAttribute('data-coil', String(Boolean(sim.coils[k])));
      }
    };
    render();
    return sim.subscribe(render);
  }, [sim]);
  return (
    <figure className="geo-strike">
      <figcaption>
        Divertor heat footprint <span>Peak · MW/m²</span>
      </figcaption>
      <div ref={group} className="geo-strike__targets">
        {Array.from({ length: nDiverters }, (_, k) => (
          <div key={k}>
            <span>D{k + 1}</span>
            <div className="geo-strike__bins" aria-hidden="true">
              {indices.map((i) => (
                <i key={i} />
              ))}
              <span className="geo-strike__cursor" />
            </div>
            <b />
          </div>
        ))}
      </div>
    </figure>
  );
}
