import { useEffect, useMemo, useRef } from 'react';
import { rampColor } from '../../design/sceneTheme';
import { plasmaMaterials } from '../../design/tokens';
import { heatFraction, rgbToHex } from '../heatfield/scene';
import { cellMean } from '../heatfield/slice';
import type { Simulation } from '../heatfield/sim';
import type { HeatfieldArtifact } from '../heatfield/types';
import type { InsetLayout } from './model';

export interface SectionFrame {
  art: HeatfieldArtifact;
  sim: Simulation;
  plane: number;
  range: readonly [number, number];
}
const palette = Array.from({ length: 256 }, (_, i) => rgbToHex(rampColor(plasmaMaterials.temperature, i / 255)));

export function SectionHeat({ frame, layout }: { frame: SectionFrame; layout: InsetLayout }) {
  const group = useRef<SVGGElement>(null);
  const { art, sim, plane, range } = frame;
  const n = art.grid.nTheta;
  const paths = useMemo(() => {
    const xt = layout.xTicks[0]!,
      yt = layout.yTicks[0]!;
    const rings = art.surfaces.map((surface) =>
      Array.from({ length: n }, (_, i) => {
        const cell = plane * n + i;
        return (
          (xt.pos + (surface.R[cell]! - xt.value) * layout.scale).toFixed(2) +
          ',' +
          (yt.pos - (surface.Z[cell]! - yt.value) * layout.scale).toFixed(2)
        );
      }),
    );
    return rings.slice(1).flatMap((outer, m) =>
      outer.map((point, i) => {
        const j = (i + 1) % n,
          inner = rings[m]!;
        return 'M' + inner[i] + ' L' + point + ' ' + outer[j] + ' ' + inner[j] + ' Z';
      }),
    );
  }, [art, plane, n, layout]);
  useEffect(() => {
    const nodes = group.current?.children;
    if (!nodes) return;
    const painted = new Int16Array(nodes.length).fill(-1);
    let last = -1;
    const paint = () => {
      if (last === sim.state.n) return;
      last = sim.state.n;
      const { T } = sim.model.crossSection(sim.state, sim.coils, plane);
      for (let k = 0; k < nodes.length; k++) {
        const value = cellMean(T, Math.floor(k / n), k % n, n);
        const t = heatFraction(value, range);
        const bin = Math.round(t * 255);
        if (bin !== painted[k]) {
          (nodes[k] as SVGElement).style.color = palette[bin]!;
          painted[k] = bin;
        }
      }
    };
    paint();
    return sim.subscribe(paint);
  }, [paths, range, sim, plane, n]);
  return (
    <g ref={group} data-layer="section-temperature" fill="currentColor" stroke="currentColor" strokeWidth=".4">
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </g>
  );
}
