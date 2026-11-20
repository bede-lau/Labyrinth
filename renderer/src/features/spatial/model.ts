// Spatial view data -> props logic (pure). Which panel shows which PRD figure, and what backs each
// figure, are read from the artifact's `fixtures` (D-023), never typed in here.
import { fixtureOutcome, type FixtureCheckData, type StatusKind } from '../../design';
import type { SpatialArtifact } from './types';

/** The fixture ids the backend emits for spatial (main/…/features/spatial/artifact.py). */
export const SPATIAL_FIXTURE = {
  speedup: 'speedup',
  runs: 'controlled-runs-passed',
  cpuMean: 'cpu-mean-s',
  gpuMean: 'gpu-mean-s',
} as const;

const PLACED: readonly string[] = Object.values(SPATIAL_FIXTURE);

export function fixtureById(a: SpatialArtifact, id: string): FixtureCheckData | null {
  return a.fixtures.find((f) => f.id === id) ?? null;
}

/** Fixtures no panel places: shown on their own, never dropped. */
export function otherFixtures(a: SpatialArtifact): FixtureCheckData[] {
  return a.fixtures.filter((f) => !PLACED.includes(f.id));
}

/** Unit of a spatial fixture, from its id: means are seconds; the speedup and the run tally are counts. */
export function fixtureUnit(f: FixtureCheckData): string {
  return /-s$/.test(f.id) ? 's' : 'dimensionless';
}

/** What backs the figures of one panel, as a status pill. */
export interface Backing {
  status: Extract<StatusKind, 'derived' | 'prd-reported' | 'mismatch' | 'unverified'>;
  /** True when the figures stand as the PRD states them: nothing in this repo recomputes them. */
  reported: boolean;
}

/**
 * The status of a panel's PRD figures, from their fixtures, most cautious first:
 * - a fixture missing from the artifact → "Unverified" (nothing checks that figure);
 * - any mismatch (by flag or by printed value) → "Mismatch";
 * - every one recomputed from data and matching → "Derived";
 * - otherwise (not recomputable, or only arithmetic on PRD-reported inputs) → "PRD-reported".
 */
export function backing(fixtures: (FixtureCheckData | null)[]): Backing {
  if (fixtures.length === 0 || fixtures.some((f) => f === null)) return { status: 'unverified', reported: false };
  const checks = fixtures as FixtureCheckData[];
  const outcomes = checks.map((f) => fixtureOutcome(f).outcome);
  if (outcomes.includes('mismatch')) return { status: 'mismatch', reported: false };
  if (outcomes.every((o) => o === 'match') && checks.every((f) => (f.basis ?? 'data') === 'data'))
    return { status: 'derived', reported: false };
  return { status: 'prd-reported', reported: true };
}

/** Panel backings: the timing panel by its two means, the run panel by its tally. */
export function spatialBacking(a: SpatialArtifact): { timing: Backing; runs: Backing } {
  return {
    timing: backing([fixtureById(a, SPATIAL_FIXTURE.cpuMean), fixtureById(a, SPATIAL_FIXTURE.gpuMean)]),
    runs: backing([fixtureById(a, SPATIAL_FIXTURE.runs)]),
  };
}
