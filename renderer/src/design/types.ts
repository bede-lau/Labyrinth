// Structural mirrors of contracts/common.schema.json $defs used by the primitives.
// Kept structural (no imports from contracts) so any loader type with the same shape fits.

export interface Source {
  label: string;
  url: string;
  sha256: string;
  path?: string;
}

export type VerificationOutcome = 'passed' | 'failed' | 'blocked' | 'not-applicable';

export interface Verification {
  outcome: VerificationOutcome;
  details: string;
}

export type ProvenanceKind = 'archive' | 'derived' | 'prd-reported' | 'live' | 'rehearsal';

export interface Provenance {
  kind: ProvenanceKind;
  solverRevision: string;
  units: string;
  coverage: { description: string; tStart?: number | null; tEnd?: number | null };
  runtime: string;
  verification: Verification;
  sources: Source[];
}

/**
 * contracts/common.schema.json#/$defs/fixtureCheck (decision D-023).
 * - `claimed` is the single value the claim's source prints, or null when it prints a range instead.
 * - `claimSource` is where the claim is printed: "prd" (PRD.md, also when absent) or "task" (only the
 *   feature's tasks/<NN>/TASK.md prints it; it is labelled a TASK.md figure, never a PRD one).
 * - `claimedRange` [lo, hi] is that range; then `matches` means lo ≤ computed ≤ hi, unrounded.
 * - `basis` "arithmetic" marks a check that only redid arithmetic on PRD-reported inputs; absent = "data".
 */
export interface FixtureCheckData {
  id: string;
  label: string;
  claimed: number | null;
  claimSource?: 'prd' | 'task';
  claimedRange?: readonly [number, number];
  computed: number | null;
  printedDecimals: number;
  matches: boolean | null;
  basis?: 'data' | 'arithmetic';
  note?: string;
}
