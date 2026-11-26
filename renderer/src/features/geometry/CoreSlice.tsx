import { useEffect, useMemo, useRef } from 'react';
import { rampColor } from '../../design/sceneTheme';
import { plasmaMaterials } from '../../design/tokens';
import { linearFraction, rgbToHex } from '../heatfield/scene';
import type { Simulation } from '../heatfield/sim';
import { cellMean, sliceLayout } from '../heatfield/slice';
import type { HeatfieldArtifact } from '../heatfield/types';

/** Magnify the same moving section in R/Z without distorting its proportions. */
export function CoreSlice({ art, sim, plane, range }: {
  art: HeatfieldArtifact; sim: Simulation; plane: number; range: readonly number[];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const layout = useMemo(() => sliceLayout(art, plane, { width: 160, height: 140, padLeft: 2, padBottom: 2, pad: 2 }), [art, plane]);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const paths = layout.cells.map(c => new Path2D(c.d));
    const lut = Array.from({ length: 256 }, (_, i) => rgbToHex(rampColor(plasmaMaterials.temperature, i / 255)));
    const draw = () => {
      const xs = sim.model.crossSection(sim.state, sim.coils, plane);
      const values = xs.T;
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      ctx.clearRect(0, 0, 160, 140);
      ctx.lineWidth = 0.55;
      layout.cells.forEach((c, i) => {
        const value = cellMean(values, c.m, c.i, art.grid.nTheta);
        const t = linearFraction(value, range);
        ctx.fillStyle = ctx.strokeStyle = lut[Math.round(t * 255)]!;
        ctx.fill(paths[i]!);
        ctx.stroke(paths[i]!);
      });
    };
    draw();
    return sim.subscribe(draw);
  }, [art, sim, plane, range, layout]);
  return <figure className="plasma-lens">
    <figcaption>Core slice <b>{Math.round(360 * plane / art.grid.nPhi)}°</b></figcaption>
    <canvas width={320} height={280} ref={canvas} role="img" aria-label="Magnified cross-section of model temperature" />
  </figure>;
}
