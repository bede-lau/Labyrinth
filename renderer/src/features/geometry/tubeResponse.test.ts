// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createModel } from '../heatfield/model';
import { Simulation } from '../heatfield/sim';
import type { HeatfieldArtifact } from '../heatfield/types';
import type { GeometryArtifact } from './types';
import { createTubeField } from './tubeResponse';

const artifact = (id: string) =>
  JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/' + id + '.json'), 'utf8'));
test('the selected tube and scene agree at a VMEC node across a sweep and return to equilibrium', () => {
  const art: HeatfieldArtifact = artifact('heatfield');
  const geometry: GeometryArtifact = artifact('geometry');
  const model = createModel(art);
  const sim = new Simulation(model, model.initialState());
  const surface = art.surfaces[6]!;
  const i = Math.round(model.thetaD / model.dTheta);
  const sample = {
    ...geometry.tubes[0]!.samples[0]!,
    R: surface.R[i]!,
    Z: surface.Z[i]!,
    zeta: 0,
    bmag: surface.B[i]!,
  };
  const tube = { ...geometry.tubes[0]!, samples: [sample] };
  const response = createTubeField(art, sim, tube, surface.rho);
  const check = () =>
    expect(response.read().field[0]).toBeCloseTo(
      model.crossSection(sim.state, sim.coils, 0).B[6 * model.nTheta + i]!,
      11,
    );
  check();
  sim.setCoil(0, true);
  check();
  expect(response.read().changes[0]).toBeGreaterThan(0);
  sim.advance(Math.round(0.5 / (model.params.sweepFrequency * model.params.dt)));
  check();
  expect(response.read().changes[0]).toBeLessThan(0);
  sim.setCoil(0, false);
  check();
  expect(response.read().field[0]).toBe(sample.bmag);
});
