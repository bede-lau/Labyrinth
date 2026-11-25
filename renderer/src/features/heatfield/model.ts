// The illustrative edge heat model of tasks/10-heat-field/MODEL.md (D-027), ported from the Python reference
// (main/), step by step. Pure TypeScript on Float64Arrays: no DOM, no three, no React.
//
// Every input is read from artifacts/heatfield.json exactly as written there (7 significant figures):
// B_s = surfaces[last].B, ι = surfaces[last].iota, φ_k = diverters.items[k].phi, θ_d = diverters.thetaCentre and
// every parameter = model.parameters[name].value. This file holds no constant of the model (H8; model.test.ts scans
// it): the only numbers here are 0, 1, 2 and 0.5 of the formulas themselves.
//
// The coils of step n are those of the coil-schedule entry with the largest fromStep ≤ n; they drive step n → n+1
// and the diagnostics of the state after n steps (the reference's convention, written in model.discretization).
import type { AppliedControls } from './controlRamp';
import type { CoilScheduleEntry, HeatfieldArtifact, ParameterName } from './types';

const TWO_PI = 2 * Math.PI;

/** Applied coil amplitudes in [0, 1], one per divertor. */
export type Coils = readonly number[];

export type Params = Readonly<Record<ParameterName, number>>;

export interface ModelState {
  /** Steps taken from the initial condition; t_n = n·Δt. */
  readonly n: number;
  /** LCFS temperature (keV), flat c = j·nTheta + i. */
  readonly T: Float64Array;
  /** Tile strips (°C): diverter k, θ index i at k·nTheta + i. */
  readonly tiles: Float64Array;
}

export interface Diagnostics {
  step: number;
  t: number;
  probesT: number[];
  meanT: number;
  peakTileC: number[];
  peakHeatFlux: number[];
}

/** wrap(x) = x − 2π·floor(x/(2π) + 0.5), into [−π, π). */
export function wrap(x: number): number {
  return x - TWO_PI * Math.floor(x / TWO_PI + 0.5);
}

/** g(x, σ) = exp(−x²/(2σ²)). */
export function gauss(x: number, sigma: number): number {
  return Math.exp(-(x * x) / (2 * sigma * sigma));
}

/** Coils of step n: the schedule entry with the largest fromStep ≤ n. */
export function coilsAt(schedule: readonly CoilScheduleEntry[], n: number): Coils {
  const entries = [...schedule].sort((a, b) => a.fromStep - b.fromStep);
  if (entries.length === 0 || entries[0]!.fromStep !== 0) throw new Error('a coil schedule starts at step 0');
  let current = entries[0]!;
  for (const e of entries) if (e.fromStep <= n) current = e;
  return current.coils;
}

export interface HeatModel {
  readonly nTheta: number;
  readonly nPhi: number;
  readonly nCells: number;
  readonly nDiverters: number;
  readonly dTheta: number;
  readonly dPhi: number;
  /** θ_i (rad). */
  readonly theta: Float64Array;
  /** φ_j (rad). */
  readonly phi: Float64Array;
  readonly params: Params;
  readonly iota: number;
  readonly thetaD: number;
  readonly phiK: readonly number[];
  /** LCFS |B| from VMEC (T). */
  readonly Bs: Float64Array;
  /** Coil envelopes h_k[c] (dimensionless), k = 0…3. */
  readonly h: readonly Float64Array[];
  /** Probe cells [i, j]. */
  readonly probes: readonly (readonly [number, number])[];
  initialState(): ModelState;
  time(n: number): number;
  /** Step 1: a_k = c_k·cos(2πf·t). */
  drive(coils: Coils, t: number): Float64Array;
  /** Step 3: B[c] at t_n for these coils (T). */
  field(coils: Coils, n: number, out?: Float64Array): Float64Array;
  /** Step 4: strike-line θ of every diverter at t_n. */
  strikeLines(coils: Coils, n: number): Float64Array;
  /** One step n → n+1 (a new state; the input is not changed). */
  step(state: ModelState, coils: Coils): ModelState;
  /** `steps` steps using the supplied control envelope, or fixed coils by default. */
  advance(state: ModelState, coils: Coils, steps: number, controlsAt?: (step: number) => AppliedControls): ModelState;
  /** Step 10 for the state and coils at t_n: Q_k[i] (MW/m²) at k·nTheta + i. */
  stripLoads(state: ModelState, coils: Coils): Float64Array;
  diagnostics(state: ModelState, coils: Coils): Diagnostics;
  /** Run from the initial condition with a coil schedule; diagnostics at each checkpoint step. */
  run(schedule: readonly CoilScheduleEntry[], checkpoints: readonly number[]): { checkpoints: Diagnostics[]; state: ModelState };
  /** Heat-flow vector in angle space (MODEL.md, renderer only): F_φ and F_θ per cell. */
  heatFlow(state: ModelState, coils: Coils): { fPhi: Float64Array; fTheta: Float64Array };
  /** Cross-section fields at plane j (MODEL.md): T_xs and |B|_xs for surface m, θ index i at m·nTheta + i. */
  crossSection(state: ModelState, coils: Coils, j: number): { T: Float64Array; B: Float64Array; rho: Float64Array };
  /** Δt·(2D_∥/dφ² + 2·max D⊥/dθ² + 1/τ_E + max Σ_k g_k/τ_div), over every coil state. */
  stabilityNumber(): number;
}

/** Every parameter value as written in the artifact. */
export function paramsOf(art: HeatfieldArtifact): Params {
  return Object.fromEntries(Object.entries(art.model.parameters).map(([k, v]) => [k, v.value])) as Params;
}

/** Optional prescribed edge-reservoir temperature for exploratory heating scenarios (keV). */
export function createModel(art: HeatfieldArtifact, heating?: (time: number) => Float64Array, coreTemperature?: (time: number) => number, pedestalTemperature?: (time: number) => number): HeatModel {
  const nTheta = art.grid.nTheta;
  const nPhi = art.grid.nPhi;
  const nCells = nTheta * nPhi;
  const surfaces = art.surfaces;
  const lcfs = surfaces[surfaces.length - 1]!;
  const p = paramsOf(art);
  const iota = lcfs.iota;
  const thetaD = art.diverters.thetaCentre;
  const phiK = art.diverters.items.map((d) => d.phi);
  const nDiv = phiK.length;
  const probes = art.model.probes.map(([i, j]) => [i, j] as const);
  const Bs = Float64Array.from(lcfs.B);

  const dTheta = TWO_PI / nTheta;
  const dPhi = TWO_PI / nPhi;
  const theta = new Float64Array(nTheta);
  const phi = new Float64Array(nPhi);
  for (let i = 0; i < nTheta; i++) theta[i] = (TWO_PI * i) / nTheta;
  for (let j = 0; j < nPhi; j++) phi[j] = (TWO_PI * j) / nPhi;

  // Step 2 (time independent): h_k[c] = g(wrap(φ_j − φ_k), σ_cφ)·g(wrap(θ_i − θ_d), σ_cθ).
  const gThetaD = new Float64Array(nTheta);
  for (let i = 0; i < nTheta; i++) gThetaD[i] = gauss(wrap(theta[i]! - thetaD), p.sigmaCoilTheta);
  const h = phiK.map((pk) => {
    const out = new Float64Array(nCells);
    for (let j = 0; j < nPhi; j++) {
      const gp = gauss(wrap(phi[j]! - pk), p.sigmaCoilPhi);
      for (let i = 0; i < nTheta; i++) out[j * nTheta + i] = gp * gThetaD[i]!;
    }
    return out;
  });
  // Step 5, φ factor (time independent): g(wrap(φ_j − φ_k), σ_φ).
  const gPhi = phiK.map((pk) => {
    const out = new Float64Array(nPhi);
    for (let j = 0; j < nPhi; j++) out[j] = gauss(wrap(phi[j]! - pk), p.sigmaPhi);
    return out;
  });
  // Step 7: pitch in cells σ = ι·dφ/dθ, p = floor(σ), w = σ − p.
  const sigmaCells = (iota * dPhi) / dTheta;
  const shift = Math.floor(sigmaCells);
  const w = sigmaCells - shift;
  // Step 10: strip-load normalisation dφ/(√(2π)·σ_φ).
  const stripFactor = dPhi / (Math.sqrt(TWO_PI) * p.sigmaPhi);
  // Step 10, constant part (MODEL.md v2, D-031): sheath law with two-point pressure balance,
  // (γ/2)·n_u·keV·c_s(T_t)·sin α / MW in MW m⁻² per keV of upstream temperature, c_s = √(2·T_t·keV/(m_i·amu)).
  const soundSpeed = Math.sqrt((2 * p.Ttarget * p.keV) / (p.ionMass * p.amu));
  const sheath = (((p.sheathGamma / 2) * p.nSep * p.keV * soundSpeed) * Math.sin(p.incidence)) / p.MW;
  const dPhi2 = dPhi * dPhi;
  const dTheta2 = dTheta * dTheta;

  // Periodic neighbour tables: T[(j + dj) mod nPhi, (i + di) mod nTheta] for every cell.
  const mod = (a: number, b: number) => ((a % b) + b) % b;
  const take = (dj: number, di: number) => {
    const out = new Int32Array(nCells);
    for (let j = 0; j < nPhi; j++)
      for (let i = 0; i < nTheta; i++) out[j * nTheta + i] = mod(j + dj, nPhi) * nTheta + mod(i + di, nTheta);
    return out;
  };
  const plus0 = take(1, shift);
  const plus1 = take(1, shift + 1);
  const minus0 = take(-1, -shift);
  const minus1 = take(-1, -shift - 1);
  const east = take(0, 1);
  const west = take(0, -1);

  const time = (n: number) => n * p.dt;

  const drive = (coils: Coils, t: number) => {
    const c = Math.cos(TWO_PI * p.sweepFrequency * t);
    const a = new Float64Array(nDiv);
    for (let k = 0; k < nDiv; k++) a[k] = (coils[k] ?? 0) * c;
    return a;
  };

  const fieldFromDrive = (a: Float64Array, out: Float64Array) => {
    const eps = p.epsilon;
    for (let c = 0; c < nCells; c++) {
      let pert = a[0]! * h[0]![c]!;
      for (let k = 1; k < nDiv; k++) pert = pert + a[k]! * h[k]![c]!;
      out[c] = Bs[c]! * (1 + eps * pert);
    }
    return out;
  };

  /** θ factor of every footprint at the strike lines of drive a: k·nTheta + i. */
  const footprintTheta = (a: Float64Array) => {
    const out = new Float64Array(nDiv * nTheta);
    for (let k = 0; k < nDiv; k++) {
      const ts = thetaD + p.sweepAmplitude * a[k]!;
      for (let i = 0; i < nTheta; i++) out[k * nTheta + i] = gauss(wrap(theta[i]! - ts), p.sigmaTheta);
    }
    return out;
  };

  /** Step 10: Q_k[i] = Σ_j sheath·(B/B_0)·g_k·T · dφ/(√(2π)σ_φ). */
  const loadsFrom = (T: Float64Array, B: Float64Array, gTh: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let k = 0; k < nDiv; k++) {
      const gp = gPhi[k]!;
      const base = k * nTheta;
      for (let j = 0; j < nPhi; j++) {
        const gpj = gp[j]!;
        const row = j * nTheta;
        for (let i = 0; i < nTheta; i++) {
          const c = row + i;
          const q = ((sheath * (B[c]! / p.B0)) * (gpj * gTh[base + i]!)) * T[c]!;
          out[base + i] = out[base + i]! + q;
        }
      }
    }
    for (let x = 0; x < out.length; x++) out[x] = out[x]! * stripFactor;
    return out;
  };

  // Scratch for the step.
  const B = new Float64Array(nCells);
  const dPerp = new Float64Array(nCells);
  const loads = new Float64Array(nDiv * nTheta);

  /** Steps 1–12 from (T, tiles) at step n into (Tn, tilesN). */
  const stepInto = (n: number, T: Float64Array, tiles: Float64Array, coils: Coils, Tn: Float64Array, tilesN: Float64Array) => {
    const reservoir = heating?.(time(n));
    const a = drive(coils, time(n)); // 1
    fieldFromDrive(a, B); // 2, 3
    const gTh = footprintTheta(a); // 4, 5 (θ factor; the φ factor is gPhi)
    for (let c = 0; c < nCells; c++) {
      const r = p.B0 / B[c]!;
      dPerp[c] = p.Dperp0 * (r * r); // 6
    }
    loadsFrom(T, B, gTh, loads); // 10
    for (let x = 0; x < nDiv * nTheta; x++) {
      tilesN[x] = tiles[x]! + (p.dt * (p.Tcool + p.tileGain * loads[x]! - tiles[x]!)) / p.tauTile; // 11
    }
    for (let j = 0; j < nPhi; j++) {
      const row = j * nTheta;
      for (let i = 0; i < nTheta; i++) {
        const c = row + i;
        const t0 = T[c]!;
        const tp = (1 - w) * T[plus0[c]!]! + w * T[plus1[c]!]!; // 7
        const tm = (1 - w) * T[minus0[c]!]! + w * T[minus1[c]!]!;
        const par = (p.Dpar * (tp - 2 * t0 + tm)) / dPhi2;
        const e = east[c]!;
        const wv = west[c]!;
        const dPlus = (dPerp[c]! + dPerp[e]!) / 2; // 8
        const dMinus = (dPerp[c]! + dPerp[wv]!) / 2;
        const cross = (dPlus * (T[e]! - t0) - dMinus * (t0 - T[wv]!)) / dTheta2;
        const src = ((reservoir?.[c] ?? p.Tped) - t0) / p.tauE; // 9
        const excess = (t0 - p.Ttarget) / p.tauDiv;
        let sink = gPhi[0]![j]! * gTh[i]! * excess;
        for (let k = 1; k < nDiv; k++) sink = sink + gPhi[k]![j]! * gTh[k * nTheta + i]! * excess;
        Tn[c] = t0 + p.dt * (par + cross + src - sink); // 12
      }
    }
  };

  const initialState = (): ModelState => ({
    n: 0,
    T: new Float64Array(nCells).fill(p.Tped),
    tiles: new Float64Array(nDiv * nTheta).fill(p.Tcool),
  });

  const step = (st: ModelState, coils: Coils): ModelState => {
    const T = new Float64Array(nCells);
    const tiles = new Float64Array(nDiv * nTheta);
    stepInto(st.n, st.T, st.tiles, coils, T, tiles);
    return { n: st.n + 1, T, tiles };
  };

  const advance = (st: ModelState, coils: Coils, steps: number, controlsAt?: (step: number) => AppliedControls): ModelState => {
    if (steps <= 0) return st;
    let T = new Float64Array(nCells);
    let tiles = new Float64Array(nDiv * nTheta);
    const first = controlsAt?.(st.n);
    stepInto(st.n, st.T, st.tiles, first?.coils ?? coils, T, tiles);
    if (steps === 1) return { n: st.n + 1, T, tiles };
    let T2 = new Float64Array(nCells);
    let tiles2 = new Float64Array(nDiv * nTheta);
    for (let s = 1; s < steps; s++) {
      const applied = controlsAt?.(st.n + s);
      stepInto(st.n + s, T, tiles, applied?.coils ?? coils, T2, tiles2);
      [T, T2] = [T2, T];
      [tiles, tiles2] = [tiles2, tiles];
    }
    return { n: st.n + steps, T, tiles };
  };

  const field = (coils: Coils, n: number, out = new Float64Array(nCells)) => fieldFromDrive(drive(coils, time(n)), out);

  const strikeLines = (coils: Coils, n: number) => {
    const a = drive(coils, time(n));
    return a.map((ak) => thetaD + p.sweepAmplitude * ak);
  };

  const stripLoads = (st: ModelState, coils: Coils) => {
    const a = drive(coils, time(st.n));
    return loadsFrom(st.T, fieldFromDrive(a, new Float64Array(nCells)), footprintTheta(a), new Float64Array(nDiv * nTheta));
  };

  const maxPerDiverter = (arr: Float64Array) =>
    Array.from({ length: nDiv }, (_, k) => {
      let m = -Infinity;
      for (let i = 0; i < nTheta; i++) m = Math.max(m, arr[k * nTheta + i]!);
      return m;
    });

  const diagnostics = (st: ModelState, coils: Coils): Diagnostics => {
    let sum = 0;
    for (let c = 0; c < nCells; c++) sum += st.T[c]!;
    return {
      step: st.n,
      t: time(st.n),
      probesT: probes.map(([i, j]) => st.T[j * nTheta + i]!),
      meanT: sum / nCells,
      peakTileC: maxPerDiverter(st.tiles),
      peakHeatFlux: maxPerDiverter(stripLoads(st, coils)),
    };
  };

  const run = (schedule: readonly CoilScheduleEntry[], checkpoints: readonly number[]) => {
    const wanted = [...new Set(checkpoints)].sort((x, y) => x - y);
    const last = wanted[wanted.length - 1] ?? 0;
    let st = initialState();
    const out: Diagnostics[] = [];
    for (;;) {
      if (wanted.includes(st.n)) out.push(diagnostics(st, coilsAt(schedule, st.n)));
      if (st.n >= last) return { checkpoints: out, state: st };
      // Advance with fixed coils up to the next schedule change or checkpoint.
      const coils = coilsAt(schedule, st.n);
      const nextChange = schedule.map((e) => e.fromStep).filter((s) => s > st.n);
      const nextStop = Math.min(last, ...wanted.filter((s) => s > st.n), ...nextChange);
      st = advance(st, coils, nextStop - st.n);
    }
  };

  const heatFlow = (st: ModelState, coils: Coils) => {
    const Bc = field(coils, st.n);
    const fPhi = new Float64Array(nCells);
    const fTheta = new Float64Array(nCells);
    const T = st.T;
    for (let c = 0; c < nCells; c++) {
      const tp = (1 - w) * T[plus0[c]!]! + w * T[plus1[c]!]!;
      const tm = (1 - w) * T[minus0[c]!]! + w * T[minus1[c]!]!;
      const fp = (-p.Dpar * (tp - tm)) / (2 * dPhi);
      const r = p.B0 / Bc[c]!;
      const dp = p.Dperp0 * (r * r);
      fPhi[c] = fp;
      fTheta[c] = iota * fp - (dp * (T[east[c]!]! - T[west[c]!]!)) / (2 * dTheta);
    }
    return { fPhi, fTheta };
  };

  const crossSection = (st: ModelState, coils: Coils, j: number) => {
    const nSurf = surfaces.length;
    const a = drive(coils, time(st.n));
    const Txs = new Float64Array(nSurf * nTheta);
    const Bxs = new Float64Array(nSurf * nTheta);
    const rho = Float64Array.from(surfaces, (s) => s.rho);
    const pedestal = pedestalTemperature?.(time(st.n)) ?? p.Tped;
    const axisT = coreTemperature?.(time(st.n)) ?? p.Tcore0;
    for (let m = 0; m < nSurf; m++) {
      const rm = rho[m]!;
      const core = pedestal + (axisT - pedestal) * (1 - rm * rm) ** 2;
      const blend = Math.max(0, (rm - p.rhoBlend) / (1 - p.rhoBlend)) ** 2;
      const Bm = surfaces[m]!.B;
      for (let i = 0; i < nTheta; i++) {
        const c = j * nTheta + i;
        Txs[m * nTheta + i] = core + blend * (st.T[c]! - pedestal);
        let pert = 0;
        for (let k = 0; k < nDiv; k++) pert += a[k]! * h[k]![c]!;
        Bxs[m * nTheta + i] = Bm[c]! * (1 + rm * rm * p.epsilon * pert);
      }
    }
    return { T: Txs, B: Bxs, rho };
  };

  const stabilityNumber = () => {
    let dMax = 0;
    for (let c = 0; c < nCells; c++) {
      let hs = 0;
      for (let k = 0; k < nDiv; k++) hs += h[k]![c]!;
      const bMin = Bs[c]! * (1 - p.epsilon * hs);
      if (!(bMin > 0)) throw new Error('the coil perturbation drives |B| to zero');
      const r = p.B0 / bMin;
      dMax = Math.max(dMax, p.Dperp0 * r * r);
    }
    let gMax = 0;
    for (let j = 0; j < nPhi; j++) {
      let gs = 0;
      for (let k = 0; k < nDiv; k++) gs += gPhi[k]![j]!;
      gMax = Math.max(gMax, gs);
    }
    return p.dt * ((2 * p.Dpar) / dPhi2 + (2 * dMax) / dTheta2 + 1 / p.tauE + gMax / p.tauDiv);
  };

  return {
    nTheta,
    nPhi,
    nCells,
    nDiverters: nDiv,
    dTheta,
    dPhi,
    theta,
    phi,
    params: p,
    iota,
    thetaD,
    phiK,
    Bs,
    h,
    probes,
    initialState,
    time,
    drive,
    field,
    strikeLines,
    step,
    advance,
    stripLoads,
    diagnostics,
    run,
    heatFlow,
    crossSection,
    stabilityNumber,
  };
}

const models = new WeakMap<HeatfieldArtifact, HeatModel>();

/** The model of an artifact object, built once per object (the view and its tests share it). */
export function modelFor(art: HeatfieldArtifact): HeatModel {
  let m = models.get(art);
  if (!m) {
    m = createModel(art);
    models.set(art, m);
  }
  return m;
}

/** Number of steps in `seconds` of model time (Δt from the artifact). */
export function stepsFor(model: HeatModel, seconds: number): number {
  return Math.round(seconds / model.params.dt);
}

const spunUp = new WeakMap<HeatModel, ModelState>();

/** The view's starting state: the model run for parameters.spinup with every coil off (cached per model). */
export function spunUpState(model: HeatModel): ModelState {
  let st = spunUp.get(model);
  if (!st) {
    st = model.advance(model.initialState(), new Array<number>(model.nDiverters).fill(0), stepsFor(model, model.params.spinup));
    spunUp.set(model, st);
  }
  return st;
}

export function cloneState(st: ModelState): ModelState {
  return { n: st.n, T: Float64Array.from(st.T), tiles: Float64Array.from(st.tiles) };
}
