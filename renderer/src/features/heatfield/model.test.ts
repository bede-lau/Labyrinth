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
  expect(paramsOf(ART).kRef).toBe(350);
  expect(paramsOf(ART).Pheat).toBe(7.5); // the high-power operating point (D-033)

  // A changed parameter in the artifact changes the result: nothing is cached in the code.
  const hotter = structuredClone(ART);
  hotter.model.parameters.sinkResistance.value = 2 * ART.model.parameters.sinkResistance.value;
  const a = createModel(ART).advance(createModel(ART).initialState(), OFF, 200);
  const b = createModel(hotter).advance(createModel(hotter).initialState(), OFF, 200);
  const rise = (x: Float64Array) => Math.max(...x) - ART.model.parameters.Tcool.value;
  expect(rise(b.tiles)).toBeGreaterThan(rise(a.tiles));
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

test('H8 with no heating there is no plasma and no load; the step is deterministic', () => {
  const unheated = structuredClone(ART);
  unheated.model.parameters.Pheat.value = 0;
  const m = createModel(unheated);
  const st = m.advance(m.initialState(), OFF, 50);
  expect(st.T.every((v) => v === 0)).toBe(true);
  expect(st.tiles.every((v) => v === P.Tcool)).toBe(true);
  // Same inputs, same bits.
  const x = model.advance(model.initialState(), [1, 0, 1, 0], 300);
  const y = model.advance(model.initialState(), [1, 0, 1, 0], 300);
  expect(Buffer.from(x.T.buffer).equals(Buffer.from(y.T.buffer))).toBe(true);
  expect(Buffer.from(x.tiles.buffer).equals(Buffer.from(y.tiles.buffer))).toBe(true);
  // step() and advance() agree, and neither changes its input.
  const s0 = model.initialState();
  const copy = Float64Array.from(s0.T);
  const one = model.step(s0, OFF);
  expect(one.n).toBe(1);
  expect(Array.from(model.advance(s0, OFF, 1).T)).toEqual(Array.from(one.T));
  expect(Array.from(model.advance(s0, OFF, 1).tiles)).toEqual(Array.from(one.tiles));
  expect(Array.from(s0.T)).toEqual(Array.from(copy));
});

test('H8 energy is conserved: the power on the wetted areas is the heating power less the radiated part', () => {
  for (const coils of [OFF, ALL_ON]) {
    for (const n of [0, 77, 250]) {
      const e = model.edge(n, coils);
      expect(e.shares.reduce((a, b) => a + b, 0)).toBeCloseTo(P.Pheat * (1 - P.fRad), 9);
      // The two-point solution: Spitzer conduction T_u^ν − T_t^ν = ν q_∥ L/κ_0, and T_t < T_u.
      for (let k = 0; k < 4; k++) {
        const qPar = (e.qT[k]! * P.MW) / Math.sin(P.incidence);
        const nu = P.conductionExponent;
        expect(relErr(e.Tu[k]! ** nu - e.Tt[k]! ** nu, (nu * qPar * P.connectionLength) / P.kappa0)).toBeLessThan(1e-9);
        // The sheath with pressure balance (the iteration's other half; the line above holds whatever T_t is):
        // q_∥ = γ·n_t·e·T_t·c_s(T_t), n_t = n_u·T_u/(2·T_t), c_s = √(2·T_t·keV/(m_i·amu)).
        const nT = (P.nSep * e.Tu[k]!) / (2 * e.Tt[k]!);
        const cS = Math.sqrt((2 * e.Tt[k]! * P.keV) / (P.ionMass * P.amu));
        expect(relErr(P.sheathGamma * nT * e.Tt[k]! * P.keV * cS, qPar)).toBeLessThan(1e-6);
        expect(e.Tt[k]).toBeLessThan(e.Tu[k]!);
      }
    }
  }
});

test('H8 T stays between the target and upstream temperatures; the only explicit update (the tiles) is stable', () => {
  const k = model.stabilityNumber();
  const dz = P.tileThickness / P.tileCells;
  const back = P.kRef / dz + 1 / (dz / (2 * P.kRef) + P.sinkResistance);
  expect(k).toBe((P.dt * Math.max((2 * P.kRef) / dz, back)) / (P.tileDensity * P.cpRef * dz));
  expect(k).toBeLessThanOrEqual(1);
  expect(ART.model.discretization).toContain(`here ${k.toFixed(4)}`);
  const sched = ART.model.golden.scenarios.find((s) => s.id === 'switch-at-1s')!.coilSchedule;
  let st = model.initialState();
  for (let n = 0; n < 1600; n += 100) {
    const coils = coilsAt(sched, n);
    st = model.advance(st, coils, 100);
    const e = model.edge(st.n, coils);
    for (const v of st.T) {
      expect(v).toBeGreaterThanOrEqual(Math.min(...e.Tt) * (1 - 1e-12));
      expect(v).toBeLessThanOrEqual(Math.max(...e.Tu) * (1 + 1e-12));
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
  expect(on.peakTileC[1]).toBeGreaterThan(off.peakTileC[1]! + 20); // D1 sheds part of its power to the others (version 6)
  expect(sim.state.n).toBe(start.n); // predict never moves the running state
});

test('H8 heat-flow vector and cross-section fields follow MODEL.md', () => {
  const st = spunUpState(model);
  const { fPhi, fTheta } = model.heatFlow(st, OFF);
  // Uniform temperature carries no heat flow.
  const flat = model.heatFlow({ n: 0, T: new Float64Array(model.nCells).fill(0.1), tiles: st.tiles, slab: st.slab }, OFF);
  expect(flat.fPhi.every((v) => v === 0) && flat.fTheta.every((v) => v === 0)).toBe(true);
  // The LCFS sits at the sectors' upstream temperatures (version 7): nearly isothermal, so the flow along it is weak
  // and runs from the hotter D1 sector (T_u ≈ 0.222 keV) towards the cooler D2 sector (≈ 0.211 keV) at φ = 45°.
  expect(fPhi.every((v) => Math.abs(v) < 1e-2)).toBe(true);
  expect(fPhi[(model.nPhi / 8) * model.nTheta]).toBeGreaterThan(0);
  expect(st.T.every((t, c) => Math.abs(t - st.T[Math.floor(c / model.nTheta) * model.nTheta]!) < 1e-15)).toBe(true);
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
  // Inside ρ_b the core profile alone, from the plane's upstream temperature (a blend of the divertors' T_u) to T_0.
  const m = ART.surfaces.findIndex((s) => s.rho === 0.5);
  const c = (1 - 0.25) ** 2;
  const edgeT = (xs.T[m * nT]! - P.Tcore0 * c) / (1 - c);
  const e = model.edge(st.n, ALL_ON);
  expect(edgeT).toBeGreaterThanOrEqual(Math.min(...e.Tu) * (1 - 1e-9));
  expect(edgeT).toBeLessThanOrEqual(Math.max(...e.Tu) * (1 + 1e-9));
});
test('H8 the CFC tile conducts heat into the water and conserves energy every step (MODEL.md step 11)', () => {
  // Material fits: k falls and c rises with temperature (NB31: ~170 W/m/K and ~1600 J/kg/K at 800 °C).
  expect(model.conductivity(P.Tref)).toBe(P.kRef);
  expect(model.conductivity(800)).toBeCloseTo(170, -1);
  expect(model.heatCapacity(P.Tref)).toBe(P.cpRef);
  expect(Math.abs(model.heatCapacity(800) / 1600 - 1)).toBeLessThan(0.05);

  // Energy: what enters the surface either stays in the tile cells or goes to the water.
  const nZ = model.tileCells;
  const dz = P.tileThickness / nZ;
  let st = model.advance(model.initialState(), OFF, 300);
  for (let s = 0; s < 50; s++) {
    const q = model.stripLoads(st, OFF);
    const next = model.step(st, OFF);
    for (let x = 0; x < q.length; x += 7) {
      let stored = 0;
      for (let z = 0; z < nZ; z++) {
        const t = st.slab[x * nZ + z]!;
        stored += (P.tileDensity * model.heatCapacity(t) * dz * (next.slab[x * nZ + z]! - t)) / P.dt;
      }
      const back = st.slab[x * nZ + nZ - 1]!;
      const sink = (back - P.Tcool) / (dz / (2 * model.conductivity(back)) + P.sinkResistance);
      expect(Math.abs(stored + sink - q[x]! * P.MW)).toBeLessThan(1e-6 * P.MW);
    }
    st = next;
  }

  // Steady state under a uniform load: the closed form with k(T) and the sink resistance, reached by the scheme.
  const flat = structuredClone(ART);
  const one = createModel(flat);
  const Q = 10;
  const back = P.Tcool + Q * P.MW * P.sinkResistance;
  const want = P.Tref + P.kScale * ((1 + (back - P.Tref) / P.kScale) * Math.exp((Q * P.MW * P.tileThickness) / (P.kRef * P.kScale)) - 1);
  expect(one.steadySurface(Q)).toBeCloseTo(want, 9);
  expect(one.steadySurface(0)).toBeCloseTo(P.Tcool, 9);
  // the steady surface rises with the load, and a hotter limit needs more load
  expect(one.steadySurface(12)).toBeGreaterThan(one.steadySurface(10));
});

test('H8 each strip deposits exactly its divertor power: it narrows as 1/B and widens with w_k as A_wet does (MODEL.md step 9, versions 5 and 8)', () => {
  const areaPerRadian = P.wettedArea / (Math.sqrt(2 * Math.PI) * P.sigmaTheta);
  for (const coils of [OFF, [1, 1, 1, 1]]) {
    const st = model.advance(model.initialState(), coils, 137);
    const q = model.stripLoads(st, coils);
    const { shares } = model.edge(st.n, coils);
    for (let k = 0; k < model.nDiverters; k++) {
      let sum = 0;
      for (let i = 0; i < model.nTheta; i++) sum += q[k * model.nTheta + i]!;
      expect(Math.abs((sum * model.dTheta * areaPerRadian) / shares[k]! - 1)).toBeLessThan(2e-4); // the grid sum of the narrowest Gaussian (σ_θ·w/b, w ≈ 0.95)
    }
  }
});

test('the TS confinement time and plasma volume are the reference ISS04 values (MODEL.md, version 7)', () => {
  // The reference: τ_E 0.149 s at 7.5 MW, V 30.5 m³ (main/tests/test_heatfield.py).
  expect(model.confinementTime(P.Pheat)).toBeCloseTo(0.1491, 3);
  expect(model.plasmaVolume).toBeCloseTo(30.496, 2);
  // Stored energy at P_heat reproduces the written axis temperature: T_0 = T_e + 3(<T> − T_e).
  const mean = (model.confinementTime(P.Pheat) * P.Pheat * P.MW) / (3 * P.coreDensity * model.plasmaVolume * P.keV);
  const up = model.upstream(0, OFF);
  const te = up.reduce((a, b) => a + b, 0) / up.length;
  expect(Math.abs((te + 3 * (mean - te)) / P.Tcore0 - 1)).toBeLessThan(1e-5);
});
