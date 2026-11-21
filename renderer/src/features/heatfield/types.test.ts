// @vitest-environment node
// H7: the structural check the artifact gate runs on artifacts/heatfield.json.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkHeatfield, type HeatfieldArtifact } from './types';

const ART = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8')) as HeatfieldArtifact;
const broken = (edit: (a: HeatfieldArtifact) => void) => {
  const a = structuredClone(ART);
  edit(a);
  return checkHeatfield(a);
};

test('H7 the committed artifact passes the check: 9 surfaces on 48 × 72, 8 field lines, D1–D4, probes inside the grid', () => {
  expect(checkHeatfield(ART)).toBeNull();
  expect(ART.grid).toMatchObject({ nTheta: 48, nPhi: 72 });
  expect(ART.surfaces).toHaveLength(9);
  expect(ART.fieldLines).toHaveLength(8);
  expect(ART.diverters.items.map((d) => d.id)).toEqual(['D1', 'D2', 'D3', 'D4']);
});

test('H7 every broken shape is rejected with a message that names the problem', () => {
  expect(broken((a) => (a.grid.nTheta = 7))).toMatch(/grid.nTheta and grid.nPhi must be integers of at least 8/);
  expect(broken((a) => (a.grid.nPhi = 70))).toMatch(/grid.nPhi = 70 is not a multiple of 4/);
  expect(broken((a) => a.surfaces[8]!.B.pop())).toBe('surfaces[8].B has 3455 values, expected nTheta × nPhi = 48 × 72 = 3456');
  expect(broken((a) => a.surfaces[3]!.R.push(1))).toMatch(/^surfaces\[3\]\.R has 3457 values/);
  expect(broken((a) => (a.surfaces[2]!.Z[5] = Number.NaN))).toMatch(/surfaces\[2\]\.Z holds a value that is not a finite number/);
  expect(broken((a) => (a.surfaces[8]!.B[0] = 0))).toMatch(/surfaces\[8\]\.B holds a non-positive \|B\|/);
  expect(broken((a) => (a.surfaces = a.surfaces.slice(0, 1)))).toMatch(/at least the magnetic axis and the LCFS/);
  expect(broken((a) => (a.surfaces = a.surfaces.slice(0, 8)))).toMatch(/the last surface must be the LCFS/);
  expect(broken((a) => a.fieldLines[4]!.z.pop())).toBe('fieldLines[4].z has 180 values, expected 181 (as phi)');
  expect(broken((a) => (a.fieldLines = []))).toMatch(/fieldLines is empty/);
  expect(broken((a) => a.diverters.items.pop())).toBe('expected exactly four diverters D1–D4, found 3');
  expect(broken((a) => (a.diverters.items[1]!.id = 'D3'))).toMatch(/diverters must be D1, D2, D3, D4 in order, found D1,D3,D3,D4/);
  expect(broken((a) => (a.diverters.halfWidthTheta = 0))).toMatch(/halfWidthTheta/);
  expect(broken((a) => delete (a.model.parameters as Partial<typeof a.model.parameters>).tileGain)).toBe(
    'model.parameters.tileGain.value is missing or not finite',
  );
  expect(broken((a) => (a.model.probes[2] = [48, 0]))).toBe('model.probes[2] = [48, 0] is outside the grid (i < 48, j < 72)');
  expect(broken((a) => (a.model.probes[0] = [0, -1]))).toMatch(/model.probes\[0\] = \[0, -1\] is outside the grid/);
  expect(broken((a) => a.model.golden.scenarios[1]!.checkpoints[0]!.probesT.pop())).toMatch(
    /golden scenario coils-D1-D3, step 250: probesT has 7 values, expected 8/,
  );
  expect(broken((a) => (a.model.golden.relativeTolerance = 0))).toMatch(/positive relativeTolerance/);
});

test('H7 the gate holds the provenance kinds the contract pins: model output "model", geometry and |B| "derived" (RV-HF-B1)', () => {
  expect(ART.provenance.kind).toBe('model');
  expect(ART.geometryProvenance.kind).toBe('derived');
  // Model output labelled as data, or geometry labelled as model: both rejected, naming the field and the value.
  expect(broken((a) => (a.provenance.kind = 'derived'))).toBe('provenance.kind must be "model" (the illustrative model\'s output), found "derived"');
  expect(broken((a) => (a.provenance.kind = 'live'))).toMatch(/^provenance\.kind must be "model".*found "live"$/);
  expect(broken((a) => (a.geometryProvenance.kind = 'model'))).toBe('geometryProvenance.kind must be "derived" (VMEC geometry and |B|), found "model"');
  expect(broken((a) => (a.geometryProvenance.kind = 'prd-reported'))).toMatch(/^geometryProvenance\.kind must be "derived".*found "prd-reported"$/);
  // A missing kind is still named as missing.
  expect(broken((a) => delete (a.provenance as Partial<typeof a.provenance>).kind)).toBe('provenance or geometryProvenance is missing');
});
