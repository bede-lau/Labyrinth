// TypeScript mirror of contracts/heatfield.schema.json (D-027) and the structural check the view's
// artifact gate runs on it. JSON Schema cannot compare array lengths with the grid, so this does.
import type { Provenance } from '../../design';

export const PARAMETER_NAMES = [
  'Tped',
  'Tcore0',
  'rhoBlend',
  'tauE',
  'Dpar',
  'Dperp0',
  'B0',
  'tauDiv',
  'Ttarget',
  'sigmaPhi',
  'sigmaTheta',
  'sweepAmplitude',
  'sweepFrequency',
  'epsilon',
  'sigmaCoilPhi',
  'sigmaCoilTheta',
  'heatFluxScale',
  'tileGain',
  'Tcool',
  'tauTile',
  'tileLimit',
  'dt',
  'spinup',
] as const;
export type ParameterName = (typeof PARAMETER_NAMES)[number];

export interface ModelParameter {
  value: number;
  unit: string;
  symbol: string;
  description: string;
}

export interface Source {
  label: string;
  url: string;
  sha256: string;
  path?: string;
}

export interface HeatSurface {
  rho: number;
  s: number;
  iota: number;
  /** m, flat c = j*nTheta + i */
  R: number[];
  /** m */
  Z: number[];
  /** |B| in T */
  B: number[];
}

export interface FieldLine {
  alpha: number;
  phi: number[];
  x: number[];
  y: number[];
  z: number[];
  B: number[];
}

export const DIVERTER_IDS = ['D1', 'D2', 'D3', 'D4'] as const;
export type DiverterId = (typeof DIVERTER_IDS)[number] | 'D5';

export interface Diverter {
  id: DiverterId;
  phi: number;
  label: string;
}

export interface CoilScheduleEntry {
  fromStep: number;
  coils: number[];
}

export interface Checkpoint {
  step: number;
  t: number;
  probesT: number[];
  meanT: number;
  peakTileC: number[];
  peakHeatFlux: number[];
}

export interface GoldenScenario {
  id: string;
  description: string;
  coilSchedule: CoilScheduleEntry[];
  checkpoints: Checkpoint[];
}

export interface ModelEquation {
  id: string;
  text: string;
  meaning: string;
}

export interface HeatfieldArtifact {
  schemaVersion: 1;
  equilibrium: { name: string; configuration: string; nfp: number; source: Source };
  grid: { nTheta: number; nPhi: number; layout: string; angles: string };
  surfaces: HeatSurface[];
  fieldLines: FieldLine[];
  diverters: { note: string; thetaCentre: number; halfWidthTheta: number; items: Diverter[] };
  model: {
    name: string;
    version: number;
    summary: string;
    equations: ModelEquation[];
    discretization: string;
    parameters: Record<ParameterName, ModelParameter>;
    probes: [number, number][];
    golden: { relativeTolerance: number; scenarios: GoldenScenario[] };
    limitations: string;
  };
  geometryProvenance: Provenance;
  provenance: Provenance;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const allFinite = (a: unknown): boolean => Array.isArray(a) && a.every(isNum);

/**
 * Structural check beyond the schema version: grid sizes, every array length against the grid, field
 * lines of equal-length arrays, the four diverters, finite parameters, probes inside the grid, and the two
 * provenance kinds the contract pins (model output `model`, geometry `derived`).
 * Returns a message naming the problem, or null when the artifact can be drawn and modelled.
 */
export function checkHeatfield(a: HeatfieldArtifact): string | null {
  const grid = a?.grid;
  if (!grid || !isInt(grid.nTheta) || !isInt(grid.nPhi) || grid.nTheta < 8 || grid.nPhi < 8) {
    return 'grid.nTheta and grid.nPhi must be integers of at least 8';
  }
  const { nTheta, nPhi } = grid;
  if (nPhi % 4 !== 0) return `grid.nPhi = ${nPhi} is not a multiple of 4 (the four diverters must lie on grid planes)`;
  const cells = nTheta * nPhi;

  if (!Array.isArray(a.surfaces) || a.surfaces.length < 2) return 'surfaces must hold at least the magnetic axis and the LCFS';
  for (const [m, s] of a.surfaces.entries()) {
    if (!isNum(s?.rho) || !isNum(s?.iota)) return `surfaces[${m}] has no finite rho or iota`;
    for (const key of ['R', 'Z', 'B'] as const) {
      const arr = s[key];
      if (!Array.isArray(arr) || arr.length !== cells) {
        return `surfaces[${m}].${key} has ${Array.isArray(arr) ? arr.length : 'no'} values, expected nTheta × nPhi = ${nTheta} × ${nPhi} = ${cells}`;
      }
      if (!allFinite(arr)) return `surfaces[${m}].${key} holds a value that is not a finite number`;
    }
    if (s.B.some((b) => b <= 0)) return `surfaces[${m}].B holds a non-positive |B|`;
  }
  if (a.surfaces[0]!.rho !== 0) return 'surfaces[0] must be the magnetic axis (rho 0)';
  if (a.surfaces[a.surfaces.length - 1]!.rho !== 1) return 'the last surface must be the LCFS (rho 1)';

  if (!Array.isArray(a.fieldLines) || a.fieldLines.length < 1) return 'fieldLines is empty';
  for (const [k, f] of a.fieldLines.entries()) {
    const n = Array.isArray(f?.phi) ? f.phi.length : -1;
    if (n < 2) return `fieldLines[${k}].phi needs at least 2 samples`;
    for (const key of ['phi', 'x', 'y', 'z', 'B'] as const) {
      const arr = f[key];
      if (!Array.isArray(arr) || arr.length !== n) {
        return `fieldLines[${k}].${key} has ${Array.isArray(arr) ? arr.length : 'no'} values, expected ${n} (as phi)`;
      }
      if (!allFinite(arr)) return `fieldLines[${k}].${key} holds a value that is not a finite number`;
    }
    if (!isNum(f.alpha)) return `fieldLines[${k}].alpha is not a finite number`;
  }

  const d = a.diverters;
  if (!d || !Array.isArray(d.items) || d.items.length !== 4) {
    return `expected exactly four diverters D1–D4, found ${Array.isArray(d?.items) ? d.items.length : 'none'}`;
  }
  const ids = d.items.map((x) => x?.id).join(',');
  if (ids !== DIVERTER_IDS.join(',')) return `diverters must be D1, D2, D3, D4 in order, found ${ids}`;
  if (d.items.some((x) => !isNum(x.phi))) return 'a diverter has no finite phi';
  if (!isNum(d.thetaCentre) || !isNum(d.halfWidthTheta) || d.halfWidthTheta <= 0) {
    return 'diverters.thetaCentre and diverters.halfWidthTheta (> 0) must be finite numbers';
  }

  const m = a.model;
  if (!m || !m.parameters) return 'model.parameters is missing';
  for (const name of PARAMETER_NAMES) {
    if (!isNum(m.parameters[name]?.value)) return `model.parameters.${name}.value is missing or not finite`;
  }
  if (!(m.parameters.dt.value > 0)) return 'model.parameters.dt must be positive';
  if (!Array.isArray(m.probes) || m.probes.length < 1) return 'model.probes is empty';
  for (const [k, p] of m.probes.entries()) {
    const [i, j] = Array.isArray(p) ? p : [];
    if (!isInt(i) || !isInt(j) || i < 0 || i >= nTheta || j < 0 || j >= nPhi) {
      return `model.probes[${k}] = [${String(i)}, ${String(j)}] is outside the grid (i < ${nTheta}, j < ${nPhi})`;
    }
  }
  const golden = m.golden;
  if (!golden || !isNum(golden.relativeTolerance) || golden.relativeTolerance <= 0 || !Array.isArray(golden.scenarios)) {
    return 'model.golden needs a positive relativeTolerance and a scenarios array';
  }
  for (const sc of golden.scenarios) {
    for (const c of sc.checkpoints ?? []) {
      if (!Array.isArray(c.probesT) || c.probesT.length !== m.probes.length) {
        return `golden scenario ${sc.id}, step ${c.step}: probesT has ${c.probesT?.length ?? 'no'} values, expected ${m.probes.length}`;
      }
      if (c.peakTileC?.length !== 4 || c.peakHeatFlux?.length !== 4) {
        return `golden scenario ${sc.id}, step ${c.step}: peakTileC and peakHeatFlux need four values`;
      }
    }
  }
  if (!a.provenance?.kind || !a.geometryProvenance?.kind) return 'provenance or geometryProvenance is missing';
  // Pinned by contracts/heatfield.schema.json: model output can never be labelled as data, and the VMEC geometry
  // and |B| are derived (D-027, RV-HF-B1).
  if (a.provenance.kind !== 'model') return `provenance.kind must be "model" (the illustrative model's output), found "${String(a.provenance.kind)}"`;
  if (a.geometryProvenance.kind !== 'derived') {
    return `geometryProvenance.kind must be "derived" (VMEC geometry and |B|), found "${String(a.geometryProvenance.kind)}"`;
  }
  return null;
}
