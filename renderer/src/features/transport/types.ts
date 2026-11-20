// TS mirror of contracts/transport.schema.json (structural; validated by src/lib/contracts.test.ts).
import type { FixtureCheckData, Provenance, Source } from '../../design';

export type Window = [number, number];

export interface TransportTrace {
  id: string;
  code: 'stella' | 'GENE' | 'GX';
  tube: 'bean' | 'triangular';
  t: number[];
  Q: number[];
  provenance: Provenance;
}

export interface TransportWindow {
  traceId: string;
  window: Window;
  covered: boolean;
  nSamples: number;
  mean: number | null;
  stderr: number | null;
  stationary: boolean | null;
  stationarityDetail?: string;
  saturatedClaimAllowed: boolean;
}

export interface TransportArtifact {
  schemaVersion: 1;
  units: { time: string; heatFlux: string };
  traces: TransportTrace[];
  windows: TransportWindow[];
  triangular: { publishedMean: number; window: Window; rawTraceStatus: 'unverified'; source: Source };
  reducedModalRun: {
    value: number;
    window: Window;
    archive: { stella: number; GENE: number };
    provenance: Provenance;
  };
  unitConversion: { timeMultiplier: number; heatFluxDivisor: number; validity: string };
  fixtures: FixtureCheckData[];
}
