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

export interface FixtureCheckData {
  id: string;
  label: string;
  claimed: number;
  computed: number | null;
  printedDecimals: number;
  matches: boolean | null;
  note?: string;
}
