// @vitest-environment node
// The LCFS field lines are the VMEC equilibrium's (PEST tracer, checked against stella). Their coil colouring now reads the
// model's envelope at each sample's VMEC θ, found from its position, instead of θ ≈ α + ι·φ (which drops λ).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createModel } from './model';
import { fieldLineGeometry, sampleRZ, vmecTheta } from './scene';
import type { HeatfieldArtifact } from './types';

const ART = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8')) as HeatfieldArtifact;
const model = createModel(ART);
const { nTheta, nPhi } = ART.grid;
const lcfs = ART.surfaces[ART.surfaces.length - 1]!;
const wrap = (x: number) => x - 2 * Math.PI * Math.floor(x / (2 * Math.PI) + 0.5);

test('vmecTheta finds each traced point on the LCFS, and λ (VMEC θ vs α + ι·φ) is not negligible', () => {
  let worst = 0;
  let lambdaMax = 0;
  for (const f of ART.fieldLines)
    for (let s = 0; s < f.phi.length; s += 7) {
      const R = Math.hypot(f.x[s]!, f.y[s]!);
      const th = vmecTheta(lcfs, nTheta, nPhi, R, f.z[s]!, f.phi[s]!);
      const [r, z] = sampleRZ(lcfs, nTheta, nPhi, th, f.phi[s]!);
      worst = Math.max(worst, Math.hypot(r - R, z - f.z[s]!));
      lambdaMax = Math.max(lambdaMax, Math.abs(wrap(th - (f.alpha + model.iota * f.phi[s]!))));
    }
  // Bilinear interpolation of the 48 × 72 grid limits how close the surface passes to the exact trace.
  expect(worst).toBeLessThan(0.02);
  expect(lambdaMax).toBeGreaterThan(0.05);
});

test('a line sample at a grid node takes the model envelope of that cell', () => {
  const lines = fieldLineGeometry(ART, model);
  // The first sample of each line is at φ = 0 (plane 0); its envelope must equal h_k interpolated in θ on plane 0.
  for (const [m, line] of lines.entries()) {
    const f = ART.fieldLines[m]!;
    const th = vmecTheta(lcfs, nTheta, nPhi, Math.hypot(f.x[0]!, f.y[0]!), f.z[0]!, 0);
    const u = (((th / ((2 * Math.PI) / nTheta)) % nTheta) + nTheta) % nTheta;
    const i0 = Math.floor(u);
    const w = u - i0;
    for (let k = 0; k < model.nDiverters; k++) {
      const hk = model.h[k]!;
      const expected = (1 - w) * hk[i0]! + w * hk[(i0 + 1) % nTheta]!;
      expect(line.h[k * f.phi.length]).toBeCloseTo(expected, 12);
    }
  }
});
