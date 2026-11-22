import { sampleRZ } from '../heatfield/scene';
import type { HeatModel } from '../heatfield/model';
import type { HeatfieldArtifact } from '../heatfield/types';
import type { Simulation } from '../heatfield/sim';
import type { Tube } from './types';

const tau = 2 * Math.PI;
const periodic = (v: number, n: number) => ((v % n) + n) % n;

// Map the traced R,Z samples onto the heat model's VMEC grid. Straight-field-line
// θ* and VMEC θ differ. Find the closest point on the enclosing radial interpolation.
export function tubeResponse(art: HeatfieldArtifact, model: HeatModel, tube: Tube, rho: number) {
  const { nTheta, nPhi } = art.grid;
  const upper = Math.max(
    1,
    art.surfaces.findIndex((s) => s.rho >= rho),
  );
  const a = art.surfaces[upper - 1]!,
    b = art.surfaces[upper]!;
  const wr = (rho - a.rho) / (b.rho - a.rho);
  return tube.samples.map((sample) => {
    const ring = Array.from({ length: nTheta }, (_, i) => {
      const theta = (tau * i) / nTheta;
      const [r, z] = sampleRZ(a, nTheta, nPhi, theta, sample.zeta);
      const [r2, z2] = sampleRZ(b, nTheta, nPhi, theta, sample.zeta);
      return [r + wr * (r2 - r), z + wr * (z2 - z)] as const;
    });
    let closest = Infinity,
      u = 0;
    ring.forEach(([r, z], i) => {
      const end = ring[(i + 1) % nTheta]!;
      const dr = end[0] - r,
        dz = end[1] - z;
      const t = Math.max(0, Math.min(1, ((sample.R - r) * dr + (sample.Z - z) * dz) / (dr * dr + dz * dz || 1)));
      const distance = Math.hypot(r + t * dr - sample.R, z + t * dz - sample.Z);
      if (distance < closest) {
        closest = distance;
        u = i + t;
      }
    });
    const v = periodic((sample.zeta * nPhi) / tau, nPhi);
    const i = Math.floor(u),
      j = Math.floor(v),
      x = u - i,
      y = v - j;
    return model.h.map((h) => {
      const cell = (dj: number, di: number) => h[((j + dj) % nPhi) * nTheta + ((i + di) % nTheta)]!;
      const envelope = (1 - y) * ((1 - x) * cell(0, 0) + x * cell(0, 1)) + y * ((1 - x) * cell(1, 0) + x * cell(1, 1));
      return rho * rho * model.params.epsilon * envelope;
    });
  });
}

/** One cached frame feeds the trace on the torus and its adjacent graph. */
export function createTubeField(art: HeatfieldArtifact, sim: Simulation, tube: Tube, rho: number) {
  const weights = tubeResponse(art, sim.model, tube, rho);
  const field = new Float64Array(tube.samples.length);
  const changes = new Float64Array(field.length);
  const amplitude = Math.max(0.0001, ...weights.map((row) => row.reduce((sum, weight) => sum + weight, 0)));
  let version = -1;
  return {
    tube,
    amplitude,
    weights,
    read() {
      if (version !== sim.version) {
        const drive = sim.model.drive(sim.coils, sim.absoluteTime);
        weights.forEach((row, i) => {
          changes[i] = row.reduce((sum, weight, k) => sum + weight * drive[k]!, 0);
          field[i] = tube.samples[i]!.bmag * (1 + changes[i]!);
        });
        version = sim.version;
      }
      return { field, changes };
    },
  };
}
export type TubeField = ReturnType<typeof createTubeField>;
