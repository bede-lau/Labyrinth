// TS mirror of contracts/spatial.schema.json (artifact: artifacts/spatial.json).
import type { FixtureCheckData, Provenance } from '../../design';

export interface SpatialArtifact {
  schemaVersion: 1;
  geometry: 'Dommaschk';
  code: 'GENE-X';
  nPlanes: number;
  ranks: { rank: number; device: string; planes: number[] }[];
  /** Halo exchanges; `planes` is [from plane, to plane]. Both directions are listed per boundary. */
  exchanges: { fromRank: number; toRank: number; planes: number[] }[];
  fieldSolve: { device: 'CPU' };
  runs: { controlled: number; passedReference: number };
  timing: { cpuMeanS: number; gpuMeanS: number; speedup: number; speedupRecomputed: number };
  independenceNote: string;
  /** PRD figures checked here (D-023): the speedup (arithmetic only), the run tally and the two means. */
  fixtures: FixtureCheckData[];
  provenance: Provenance;
}

export function checkSpatial(a: SpatialArtifact): string | null {
  if (!Array.isArray(a.ranks) || a.ranks.length === 0) return 'ranks is empty';
  const owned = a.ranks.flatMap((r) => r.planes);
  for (let p = 1; p <= a.nPlanes; p++) if (!owned.includes(p)) return `plane ${p} is not owned by any rank`;
  if (!Array.isArray(a.exchanges)) return 'exchanges is missing';
  for (const e of a.exchanges) if (e.planes.length !== 2) return 'each exchange must name [from plane, to plane]';
  if (!a.timing || !a.runs) return 'timing or runs is missing';
  if (!Array.isArray(a.fixtures)) return 'fixtures is missing (contract D-023)';
  return null;
}
