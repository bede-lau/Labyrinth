// TS mirror of contracts/geometry.schema.json (artifact: artifacts/geometry.json).
import type { Provenance, Source, Verification } from '../../design';

export type TubeId = 'bean' | 'triangular';

export interface TubeSample {
  /** Straight-field-line poloidal angle (stella zed), rad. */
  thetaStar: number;
  /** Toroidal angle, rad (VMEC phi). */
  zeta: number;
  /** |B| / B_ref. */
  bmag: number;
  R: number;
  Z: number;
  x: number;
  y: number;
  z: number;
}

export interface Tube {
  id: TubeId;
  label: string;
  zetaCenterDeg: number;
  alpha: number;
  nSamples: number;
  bmagRange: [number, number];
  samples: TubeSample[];
  crossSection: { zetaDeg: number; R: number[]; Z: number[] };
}

export interface GeometryArtifact {
  schemaVersion: 1;
  equilibrium: { name: string; configuration: string; nfp: number; source: Source };
  surface: {
    rho: number;
    s: number;
    iota: number;
    nTheta: number;
    nPhi: number;
    /** Flat xyz, row-major over (phi, theta), periodic in both with no duplicated seam. */
    positions: number[];
    boundary?: Record<string, { R: number[]; Z: number[] }>;
  };
  tubes: Tube[];
  validation: {
    stellaReference: {
      samplesCompared: number;
      printedSignificantFigures: number;
      maxAbsError: number;
      maxRelError: number;
      allWithinPrintedPrecision: boolean;
      source: Source;
    };
    acceptance129: Verification;
  };
  provenance: Provenance;
}

/** Structural check beyond schemaVersion, so a malformed artifact is named instead of crashing the scene. */
export function checkGeometry(g: GeometryArtifact): string | null {
  const s = g.surface;
  if (!s || !Array.isArray(s.positions)) return 'surface.positions is missing';
  if (s.positions.length !== 3 * s.nTheta * s.nPhi)
    return `surface.positions has ${s.positions.length} numbers, expected 3 × nTheta × nPhi = ${3 * s.nTheta * s.nPhi}`;
  for (const id of ['bean', 'triangular'] as const) {
    const t = g.tubes?.find((x) => x.id === id);
    if (!t) return `tubes has no "${id}" tube`;
    if (!Array.isArray(t.samples) || t.samples.length < 2) return `tube "${id}" has fewer than 2 samples`;
  }
  if (!g.validation?.acceptance129 || !g.validation.stellaReference) return 'validation block is incomplete';
  return null;
}
