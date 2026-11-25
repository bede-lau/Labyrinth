// @vitest-environment node
// H8: the TypeScript port of tasks/10-heat-field/MODEL.md reads every input from the committed artifact and
// reproduces every golden checkpoint of the Python reference to model.golden.relativeTolerance.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { coilsAt, createModel, gauss, paramsOf, spunUpState, stepsFor, wrap, type Diagnostics } from './model';
import { Simulation } from './sim';
import { PARAMETER_NAMES, type HeatfieldArtifact } from './types';

const ART = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8')) as HeatfieldArtifact;
const MODEL_SRC = readFileSync(resolve(__dirname, 'model.ts'), 'utf8');
const model = createModel(ART);
const P = model.params;
const OFF = [0, 0, 0, 0];
const ALL_ON = [1, 1, 1, 1];

/** Relative error, with a tiny absolute floor only for exact zeros. */
const relErr = (got: number, want: number) => Math.abs(got - want) / Math.max(Math.abs(want), 1e-300);

test('H8 the port reproduces every golden checkpoint of the Python reference to relativeTolerance', () => {
  const tol = ART.model.golden.relativeTolerance;
  expect(tol).toBe(2e-6);
  expect(ART.model.golden.scenarios.map((s) => s.id)).toEqual(['coils-off', 'coils-D1-D3', 'switch-at-1s']);
  let compared = 0;
  let worst = 0;
  for (const sc of ART.model.golden.scenarios) {
    const { checkpoints } = model.run(
      sc.coilSchedule,
      sc.checkpoints.map((c) => c.step),
    );
    expect(checkpoints.map((c) => c.step)).toEqual(sc.checkpoints.map((c) => c.step));
    sc.checkpoints.forEach((want, n) => {
      const got = checkpoints[n] as Diagnostics;
      const where = `${sc.id} step ${want.step}`;
      expect(got.t, where).toBeCloseTo(want.t, 12);
      const pairs: [string, number, number][] = [
        ['meanT', got.meanT, want.meanT],
        ...want.probesT.map((v, k): [string, number, number] => [`probesT[${k}]`, got.probesT[k]!, v]),
        ...want.peakTileC.map((v, k): [string, number, number] => [`peakTileC[${k}]`, got.peakTileC[k]!, v]),
        ...want.peakHeatFlux.map((v, k): [string, number, number] => [`peakHeatFlux[${k}]`, got.peakHeatFlux[k]!, v]),
      ];
      for (const [name, g, v] of pairs) {
        const e = relErr(g, v);
        worst = Math.max(worst, e);
        expect(e, `${where} ${name}: got ${g}, golden ${v}`).toBeLessThanOrEqual(tol);
        compared++;
      }
    });
  }
  // 3 scenarios × 3 checkpoints × (1 mean + 8 probes + 4 tiles + 4 fluxes).
  expect(compared).toBe(3 * 3 * 17);
  expect(worst).toBeLessThan(tol);
});

test('H8 every input comes from the artifact: grid, |B|, ι, θ_d, φ_k and every parameter as written there', () => {
  const lcfs = ART.surfaces[ART.surfaces.length - 1]!;
  expect(model.nTheta).toBe(ART.grid.nTheta);
  expect(model.nPhi).toBe(ART.grid.nPhi);
  expect(Array.from(model.Bs)).toEqual(lcfs.B);
  expect(model.iota).toBe(lcfs.iota);
  expect(model.thetaD).toBe(ART.diverters.thetaCentre);
  expect(model.phiK).toEqual(ART.diverters.items.map((d) => d.phi));
  expect(model.probes).toEqual(ART.model.probes);
  for (const name of PARAMETER_NAMES) expect(P[name]).toBe(ART.model.parameters[name].value);
  expect(paramsOf(ART).tileGain).toBe(100);
  expect(paramsOf(ART).nSep).toBe(6e19); // the tuned high-power case (D-031)

  // A changed parameter in the artifact changes the result: nothing is cached in the code.
  const hotter = structuredClone(ART);
  hotter.model.parameters.tileGain.value = 2 * ART.model.parameters.tileGain.value;
  const a = createModel(ART).advance(createModel(ART).initialState(), OFF, 200);
  const b = createModel(hotter).advance(createModel(hotter).initialState(), OFF, 200);
  const rise = (x: Float64Array) => Math.max(...x) - ART.model.parameters.Tcool.value;
  expect(rise(b.tiles) / rise(a.tiles)).toBeCloseTo(2, 10);
  const shifted = structuredClone(ART);
  shifted.diverters.thetaCentre = ART.diverters.thetaCentre + 0.2;
  expect(createModel(shifted).strikeLines(OFF, 0)[0]).toBeCloseTo(ART.diverters.thetaCentre + 0.2, 12);
});

test('H8 model.ts holds no duplicated model constant: its only numeric literals are 0, 1, 2 and 0.5', () => {
  const code = MODEL_SRC.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g, '""');
  const literals = [...code.matchAll(/(?<![\w.])(\d+(?:\.\d+)?(?:e-?\d+)?)(?![\w.])/g)].map((m) => Number(m[1]));
  expect(literals.length).toBeGreaterThan(10);
  expect([...new Set(literals)].sort()).toEqual(expect.arrayContaining([0, 1, 2]));
  expect(literals.filter((v) => ![0, 0.5, 1, 2].includes(v))).toEqual([]);
  // Every parameter name is read through `p.<name>` / params, never typed in as a number.
  for (const v of [165, 1200, 0.03, 0.3, 0.06, 0.12, 2.5, 0.02, 0.001, 3000, 48, 72]) expect(literals).not.toContain(v);
});

test('H8 with no sink and no coils a uniform T_ped stays exactly uniform; the step is deterministic', () => {
  const noSink = structuredClone(ART);
  noSink.model.parameters.tauDiv.value = Number.POSITIVE_INFINITY;
  const m = createModel(noSink);
  const st = m.advance(m.initialState(), OFF, 50);
  expect(new Set(st.T).size).toBe(1); // exactly uniform
  expect(st.T[0]).toBeCloseTo(P.Tped, 12);
  // Same inputs, same bits.
  const x = model.advance(model.initialState(), [1, 0, 1, 0], 300);
  const y = model.advance(model.initialState(), [1, 0, 1, 0], 300);
  expect(Buffer.from(x.T.buffer).equals(Buffer.from(y.T.buffer))).toBe(true);
  expect(Buffer.from(x.tiles.buffer).equals(Buffer.from(y.tiles.buffer))).toBe(true);
  // step() and advance() agree, and neither changes its input.
  const s0 = model.initialState();
  const one = model.step(s0, OFF);
  expect(one.n).toBe(1);
  expect(Array.from(model.advance(s0, OFF, 1).T)).toEqual(Array.from(one.T));
  expect(s0.T.every((v) => v === P.Tped)).toBe(true);
});

test('H8 T stays within [T_t, T_ped] and the stability condition holds (≤ 1, maximum over every coil state)', () => {
  const k = model.stabilityNumber();
  expect(k).toBeGreaterThan(0.5);
  expect(k).toBeLessThanOrEqual(1);
  expect(k).toBeCloseTo(0.7355, 3); // the value model.discretization states
  expect(ART.model.discretization).toContain('0.7355');
  const sched = ART.model.golden.scenarios.find((s) => s.id === 'switch-at-1s')!.coilSchedule;
  let st = model.initialState();
  for (let n = 0; n < 1600; n += 100) {
    st = model.advance(st, coilsAt(sched, n), 100);
    for (const v of st.T) {
      expect(v).toBeGreaterThanOrEqual(P.Ttarget);
      expect(v).toBeLessThanOrEqual(P.Tped);
    }
  }
});

test('H8 a coil moves the strike line by A_s·cos(2πft) and changes |B| by ε at its centre; coils follow the schedule convention', () => {
  const f = P.sweepFrequency;
  for (const n of [0, 60, 125, 250, 400]) {
    const t = model.time(n);
    const lines = model.strikeLines([1, 0, 0, 0], n);
    expect(lines[0]).toBeCloseTo(model.thetaD + P.sweepAmplitude * Math.cos(2 * Math.PI * f * t), 12);
    expect(lines[1]).toBe(model.thetaD); // a coil that is off leaves its strike line alone
  }
  // At t = 0 (cos = 1) the D1 coil raises |B| at its centre by ε·h, h = 1 at (θ_d, φ_1) up to the grid's offset from θ_d.
  const iD = Math.round(model.thetaD / model.dTheta);
  const c = 0 * model.nTheta + iD;
  const B = model.field([1, 0, 0, 0], 0);
  const hCentre = gauss(wrap(model.theta[iD]! - model.thetaD), P.sigmaCoilTheta) * gauss(wrap(model.phi[0]! - model.phiK[0]!), P.sigmaCoilPhi);
  expect(hCentre).toBeGreaterThan(1 - 1e-9);
  expect(B[c]! / model.Bs[c]! - 1).toBeCloseTo(P.epsilon * hCentre, 12);
  // Half a period later (cos = −1) it lowers it by the same amount; with every coil off, |B| is VMEC's.
  const half = Math.round(1 / (2 * f) / P.dt);
  expect(model.field([1, 0, 0, 0], half)[c]! / model.Bs[c]! - 1).toBeCloseTo(-P.epsilon * hCentre, 9);
  expect(Array.from(model.field(OFF, 123))).toEqual(Array.from(model.Bs));
  // Schedule: the entry with the largest fromStep ≤ n.
  const sched = [
    { fromStep: 1000, coils: ALL_ON },
    { fromStep: 0, coils: OFF },
  ];
  expect(coilsAt(sched, 0)).toEqual(OFF);
  expect(coilsAt(sched, 999)).toEqual(OFF);
  expect(coilsAt(sched, 1000)).toEqual(ALL_ON);
  expect(() => coilsAt([{ fromStep: 5, coils: OFF }], 10)).toThrow(/starts at step 0/);
});

test('H8 diagnostics: probes, mean, tile peaks and heat-flux peaks of a state; sweeping lowers the tile peak', () => {
  const st = model.advance(model.initialState(), OFF, 500);
  const d = model.diagnostics(st, OFF);
  expect(d.step).toBe(500);
  expect(d.t).toBeCloseTo(0.5, 12);
  expect(d.probesT).toEqual(model.probes.map(([i, j]) => st.T[j * model.nTheta + i]));
  expect(d.meanT).toBeCloseTo(st.T.reduce((s, v) => s + v, 0) / st.T.length, 14);
  const loads = model.stripLoads(st, OFF);
  for (let k = 0; k < 4; k++) {
    expect(d.peakTileC[k]).toBe(Math.max(...st.tiles.subarray(k * model.nTheta, (k + 1) * model.nTheta)));
    expect(d.peakHeatFlux[k]).toBe(Math.max(...loads.subarray(k * model.nTheta, (k + 1) * model.nTheta)));
  }
  // The view's start: every coil off for parameters.spinup; it equals the golden coils-off checkpoint at that step.
  const start = spunUpState(model);
  expect(start.n).toBe(stepsFor(model, P.spinup));
  const golden = ART.model.golden.scenarios[0]!.checkpoints.find((c) => c.step === start.n)!;
  model.diagnostics(start, OFF).peakTileC.forEach((v, k) => expect(relErr(v, golden.peakTileC[k]!)).toBeLessThan(2e-6));
  expect(spunUpState(model)).toBe(start); // computed once per model
  // Sweeping a diverter's strike line (its coil on) lowers that diverter's peak tile temperature.
  const sim = new Simulation(model, start);
  const off = sim.predict(1000, OFF);
  const on = sim.predict(1000, [1, 0, 0, 0]);
  expect(on.peakTileC[0]).toBeLessThan(off.peakTileC[0]! - 100);
  expect(on.peakTileC[1]).toBeCloseTo(off.peakTileC[1]!, 0);
  expect(sim.state.n).toBe(start.n); // predict never moves the running state
});

test('H8 heat-flow vector and cross-section fields follow MODEL.md', () => {
  const st = spunUpState(model);
  const { fPhi, fTheta } = model.heatFlow(st, OFF);
  // Uniform temperature carries no heat flow.
  const flat = model.heatFlow(model.initialState(), OFF);
  expect(flat.fPhi.every((v) => v === 0) && flat.fTheta.every((v) => v === 0)).toBe(true);
  expect(fPhi.some((v) => Math.abs(v) > 1e-3)).toBe(true);
  // Heat flows towards the cold D1 footprint (φ = 0, θ = θ_d): just before it in φ, F_φ > 0; just after, F_φ < 0.
  const iD = Math.round(model.thetaD / model.dTheta);
  expect(fPhi[(model.nPhi - 1) * model.nTheta + iD]).toBeGreaterThan(0);
  expect(fPhi[1 * model.nTheta + iD]).toBeLessThan(0);
  expect(Number.isFinite(fTheta[0]!)).toBe(true);

  const xs = model.crossSection(st, ALL_ON, 0);
  const nT = model.nTheta;
  const last = ART.surfaces.length - 1;
  // ρ = 1: the LCFS values; ρ = 0: the core temperature T_0 on the axis.
  const B = model.field(ALL_ON, st.n);
  for (let i = 0; i < nT; i++) {
    expect(xs.T[last * nT + i]).toBeCloseTo(st.T[i]!, 12);
    expect(xs.B[last * nT + i]).toBeCloseTo(B[i]!, 12);
    expect(xs.T[i]).toBeCloseTo(P.Tcore0, 12);
    expect(xs.B[i]).toBe(ART.surfaces[0]!.B[i]); // ρ² = 0: no perturbation on the axis
  }
  // Inside ρ_b the core profile alone.
  const m = ART.surfaces.findIndex((s) => s.rho === 0.5);
  expect(xs.T[m * nT]).toBeCloseTo(P.Tped + (P.Tcore0 - P.Tped) * (1 - 0.25) ** 2, 12);
});
