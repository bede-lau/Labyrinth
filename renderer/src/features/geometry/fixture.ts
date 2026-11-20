// Small synthetic geometry artifact for tests (same shape as artifacts/geometry.json).
import type { GeometryArtifact, Tube, TubeId } from './types';

const sha = 'a'.repeat(64);

/**
 * The two tubes differ in everything a tube switch must change: |B| values (and so the colour-bar
 * range), and the cross-section (bean: a 1.0 m circle; triangular: 0.84 m wide, 1.16 m tall, so an
 * unequal R/Z scale would show). A switch that leaves something stale is then visible to a test.
 */
function tube(id: TubeId, zetaCenterDeg: number, n = 9): Tube {
  const zc = (zetaCenterDeg * Math.PI) / 180;
  const bean = id === 'bean';
  const samples = Array.from({ length: n }, (_, i) => {
    const thetaStar = -Math.PI + (2 * Math.PI * i) / (n - 1);
    const zeta = zc + thetaStar / 0.91;
    const R = 5.5 + 0.5 * Math.cos(thetaStar);
    const Z = 0.5 * Math.sin(thetaStar);
    const bmag = bean ? 1 + 0.15 * Math.cos(thetaStar + i) : 1.05 + 0.22 * Math.cos(thetaStar + 2 * i);
    return { thetaStar, zeta, bmag, R, Z, x: R * Math.cos(zeta), y: R * Math.sin(zeta), z: Z };
  });
  const bm = samples.map((s) => s.bmag);
  const cs = Array.from({ length: 8 }, (_, k) => (2 * Math.PI * k) / 8);
  return {
    id,
    label: bean ? 'Bean (ζ = 0°)' : 'Triangular (ζ = 36°)',
    zetaCenterDeg,
    alpha: bean ? 0 : -0.5718682,
    nSamples: n,
    bmagRange: [Math.min(...bm), Math.max(...bm)],
    samples,
    crossSection: bean
      ? { zetaDeg: zetaCenterDeg, R: cs.map((t) => 5.5 + 0.5 * Math.cos(t)), Z: cs.map((t) => 0.5 * Math.sin(t)) }
      : { zetaDeg: zetaCenterDeg, R: cs.map((t) => 5.4 + 0.42 * Math.cos(t)), Z: cs.map((t) => 0.58 * Math.sin(t)) },
  };
}

export function geometryFixture(nPhi = 8, nTheta = 6): GeometryArtifact {
  const positions: number[] = [];
  for (let p = 0; p < nPhi; p++)
    for (let t = 0; t < nTheta; t++) {
      const phi = (2 * Math.PI * p) / nPhi;
      const th = (2 * Math.PI * t) / nTheta;
      const R = 5.5 + 0.5 * Math.cos(th);
      positions.push(R * Math.cos(phi), R * Math.sin(phi), 0.5 * Math.sin(th));
    }
  // Plasma-boundary rings. The inset scales to fit, so two circles would draw the same curve whatever
  // their radius: the triangular boundary is an ellipse (1.2 m wide, 1.5 m tall) to be a different shape.
  const ring = (a: number, b = a, r0 = 5.5) => {
    const k = Array.from({ length: 8 }, (_, i) => (2 * Math.PI * i) / 8);
    return { R: k.map((t) => r0 + a * Math.cos(t)), Z: k.map((t) => b * Math.sin(t)) };
  };
  const src = { label: 'stella EXPECTED_OUTPUT (test_2, rho 0.7, 25 samples)', url: 'https://example.org/stella', sha256: sha };
  return {
    schemaVersion: 1,
    equilibrium: { name: 'wout_test', configuration: 'W7-X high-mirror (KJM)', nfp: 5, source: { label: 'VMEC', url: 'https://example.org/vmec', sha256: sha } },
    surface: { rho: 0.8, s: 0.64, iota: 0.9101565, nTheta, nPhi, positions, boundary: { bean: ring(0.62), triangular: ring(0.6, 0.75, 5.45) } },
    tubes: [tube('bean', 0), tube('triangular', 36)],
    validation: {
      stellaReference: {
        samplesCompared: 25,
        printedSignificantFigures: 4,
        maxAbsError: 0.0004867958,
        maxRelError: 0.0004266396,
        allWithinPrintedPrecision: true,
        source: src,
      },
      float64Reference: {
        samplesCompared: 25,
        tolerance: 1e-10,
        maxAbsError: 3e-13,
        maxRelError: 3e-13,
        allWithinTolerance: true,
        source: { label: 'stella EXPECTED_OUTPUT.vmec_geometry.out.nc (float64 bmag)', url: 'https://example.org/stella/out.nc', sha256: 'b'.repeat(64) },
      },
      acceptance129: {
        outcome: 'blocked',
        details:
          'BLOCKED (decision D-007): the 129 saved stella samples at rho 0.8 are not in this repo or at the cited stella commit. Unblock: add the stella .geometry/.out.nc file holding the 129 samples to data/raw/.',
      },
    },
    provenance: {
      kind: 'derived',
      solverRevision: 'labyrinth_main 0.1.0',
      units: 'm, rad, |B|/B_ref',
      coverage: { description: 'rho 0.8', tStart: null, tEnd: null },
      runtime: 'not recorded',
      verification: {
        outcome: 'blocked',
        details:
          "PRD acceptance: BLOCKED (D-007). Tracer validated vs stella rho 0.7: passed (25 samples; vs stella's float64 out.nc bmag: max |error| 2.9e-13 over 25 samples).",
      },
      sources: [src],
    },
  };
}
