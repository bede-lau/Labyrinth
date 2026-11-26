// The edge heat model of tasks/10-heat-field/MODEL.md (version 5, D-034: two-point scrape-off layer, energy
// conserved, CFC tiles conducting through their depth), ported from the Python reference (main/), step by step. Pure TypeScript on Float64Arrays: no DOM, no
// three, no React.
//
// Every input is read from artifacts/heatfield.json exactly as written there (7 significant figures):
// B_s = surfaces[last].B, ι = surfaces[last].iota, φ_k = diverters.items[k].phi, θ_d = diverters.thetaCentre and
// every parameter = model.parameters[name].value. This file holds no constant of the model (H8; model.test.ts scans
// it): the only numbers here are 0, 0.5, 1 and 2 of the formulas themselves (Spitzer's 7/2 is the parameter ν).
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
  /** Tile surface temperatures (°C): diverter k, θ index i at k·nTheta + i. */
  readonly tiles: Float64Array;
  /** Tile cells through the thickness (°C): strip cell x = k·nTheta + i, depth z (0 at the surface) at x·N_z + z. */
  readonly slab: Float64Array;
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
  /** Step 9 for the state's time t_n and these coils: Q_k[i] (MW/m²) at k·nTheta + i. */
  stripLoads(state: ModelState, coils: Coils): Float64Array;
  /** Steps 6–10 at t_n: each divertor's power share, peak target load and two-point temperatures. */
  edge(n: number, coils: Coils): EdgeSolution;
  /** Upstream temperature of every φ plane at t_n (keV): T_u[j] = Σ_k s_k[j]·T_u,k. */
  upstream(n: number, coils: Coils): Float64Array;
  diagnostics(state: ModelState, coils: Coils): Diagnostics;
  /** Run from the initial condition with a coil schedule; diagnostics at each checkpoint step. */
  run(schedule: readonly CoilScheduleEntry[], checkpoints: readonly number[]): { checkpoints: Diagnostics[]; state: ModelState };
  /** Conducted heat flow along the field lines in angle space (renderer only): F_φ and F_θ per cell. */
  heatFlow(state: ModelState, coils: Coils): { fPhi: Float64Array; fTheta: Float64Array };
  /** Cross-section fields at plane j (MODEL.md): T_xs and |B|_xs for surface m, θ index i at m·nTheta + i. */
  crossSection(state: ModelState, coils: Coils, j: number): { T: Float64Array; B: Float64Array; rho: Float64Array };
  /** The tile conduction's stability number (≤ 1 is monotone): the only explicit update (the edge is quasi-steady). */
  stabilityNumber(): number;
  /** Number of tile cells through the thickness. */
  readonly tileCells: number;
  /** CFC conductivity k(T) (W m⁻¹ K⁻¹). */
  conductivity(T: number): number;
  /** CFC specific heat c(T) (J kg⁻¹ K⁻¹). */
  heatCapacity(T: number): number;
  /** Steady surface temperature (°C) under a uniform load Q (MW/m²): continuous k(T) and the sink resistance. */
  steadySurface(Q: number): number;
}

/** Every parameter value as written in the artifact. */
export function paramsOf(art: HeatfieldArtifact): Params {
  return Object.fromEntries(Object.entries(art.model.parameters).map(([k, v]) => [k, v.value])) as Params;
}

/** Two-point solution of every divertor at one time: power share (MW), peak target load (MW/m²), T_u and T_t (keV). */
export interface EdgeSolution {
  shares: Float64Array;
  qT: Float64Array;
  Tu: Float64Array;
  Tt: Float64Array;
}

/**
 * The model of an artifact. `heating` (optional) gives the relative heating power density on every LCFS cell at a
 * time (1 everywhere is the nominal P_heat); `coreTemperature` (optional) the axis temperature of the cross-section.
 */
export function createModel(art: HeatfieldArtifact, heating?: (time: number) => Float64Array, coreTemperature?: (time: number) => number): HeatModel {
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
  const nu = p.conductionExponent;

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
  // Step 6: toroidal sectors s_k(φ_j) = G_k/Σ_m G_m, G_k = g(wrap(φ_j − φ_k), π/N_div).
  const sector = phiK.map(() => new Float64Array(nPhi));
  for (let j = 0; j < nPhi; j++) {
    const G = phiK.map((pk) => gauss(wrap(phi[j]! - pk), Math.PI / nDiv));
    let sum = G[0]!;
    for (let k = 1; k < nDiv; k++) sum = sum + G[k]!;
    for (let k = 0; k < nDiv; k++) sector[k]![j] = G[k]! / sum;
  }
  // Step 7: the divertor planes j_k = round(φ_k/dφ) mod nPhi.
  const jK = phiK.map((pk) => ((Math.round(pk / dPhi) % nPhi) + nPhi) % nPhi);
  // Field-line neighbours (pitch ι in cells) for the heat-flow vector.
  const sigmaCells = (iota * dPhi) / dTheta;
  const shift = Math.floor(sigmaCells);
  const w = sigmaCells - shift;
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

  const time = (n: number) => n * p.dt;

  const drive = (coils: Coils, t: number) => {
    const c = Math.cos(TWO_PI * p.sweepFrequency * t);
    const a = new Float64Array(nDiv);
    for (let k = 0; k < nDiv; k++) a[k] = (coils[k] ?? 0) * c;
    return a;
  };

  const fieldAt = (a: Float64Array, c: number) => {
    let pert = a[0]! * h[0]![c]!;
    for (let k = 1; k < nDiv; k++) pert = pert + a[k]! * h[k]![c]!;
    return Bs[c]! * (1 + p.epsilon * pert);
  };
  const fieldFromDrive = (a: Float64Array, out: Float64Array) => {
    for (let c = 0; c < nCells; c++) out[c] = fieldAt(a, c);
    return out;
  };

  /** Step 6: P_k = P_heat·(1 − f_rad)·mean_c(w[c]·s_k[c]) (MW); w ≡ 1 without a heating scenario. */
  const uniformShares = Float64Array.from(sector, (s) => {
    let sum = 0;
    for (let j = 0; j < nPhi; j++) sum += s[j]!;
    return (p.Pheat * (1 - p.fRad)) * (sum / nPhi);
  });
  const sharesAt = (t: number) => {
    const weight = heating?.(t);
    if (!weight) return uniformShares;
    return Float64Array.from(sector, (s) => {
      let sum = 0;
      for (let j = 0; j < nPhi; j++) {
        let row = 0;
        for (let i = 0; i < nTheta; i++) row += weight[j * nTheta + i]!;
        sum += s[j]! * row;
      }
      return (p.Pheat * (1 - p.fRad)) * (sum / nCells);
    });
  };

  /** Step 10: (T_u, T_t) in keV for a peak target load q_t (MW/m²). */
  const twoPoint = (qt: number): [number, number] => {
    const qPar = (qt * p.MW) / Math.sin(p.incidence);
    if (!(qPar > 0)) return [0, 0];
    const x = (nu * qPar * p.connectionLength) / p.kappa0;
    let tu = Math.pow(x, 1 / nu);
    let tt = 0;
    for (let it = 0; it < p.twoPointIterations; it++) {
      const c = (2 * qPar) / (p.sheathGamma * p.nSep * p.keV * tu);
      tt = (p.ionMass * p.amu * c * c) / (2 * p.keV);
      tu = Math.pow(Math.pow(tt, nu) + x, 1 / nu);
    }
    return [tu, tt];
  };

  /** Steps 1, 4, 6–10 at t_n for these coils (the last few are cached). */
  const cache = new Map<string, { a: Float64Array; strike: Float64Array; b: Float64Array; edge: EdgeSolution }>();
  const solve = (n: number, coils: Coils) => {
    const key = n + ':' + Array.from({ length: nDiv }, (_, k) => coils[k] ?? 0).join(',');
    const hit = cache.get(key);
    if (hit) return hit;
    const a = drive(coils, time(n));
    const strike = new Float64Array(nDiv);
    for (let k = 0; k < nDiv; k++) strike[k] = thetaD + p.sweepAmplitude * a[k]!;
    const shares = sharesAt(time(n));
    const qT = new Float64Array(nDiv);
    const Tu = new Float64Array(nDiv);
    const Tt = new Float64Array(nDiv);
    const bK = new Float64Array(nDiv);
    for (let k = 0; k < nDiv; k++) {
      // Step 7: |B| at the strike line on plane j_k, linear in θ between grid nodes.
      const x = strike[k]! / dTheta;
      const i0 = Math.floor(x);
      const fr = x - i0;
      const row = jK[k]! * nTheta;
      const b = ((1 - fr) * fieldAt(a, row + mod(i0, nTheta)) + fr * fieldAt(a, row + mod(i0 + 1, nTheta))) / p.B0;
      bK[k] = b;
      qT[k] = (shares[k]! * b) / p.wettedArea; // 8
      [Tu[k], Tt[k]] = twoPoint(qT[k]!); // 10
    }
    const out = { a, strike, b: bK, edge: { shares, qT, Tu, Tt } };
    // A small bound (any will do; the grid's θ count avoids a numeric literal, H8): a step reads t_n and t_(n+1) only.
    if (cache.size > nTheta) cache.clear();
    cache.set(key, out);
    return out;
  };

  /** Step 9: Q_k[i] = q_t,k·g(wrap(θ_i − θ_s,k), σ_θ/b_k): the flux tube narrows as 1/B, the strip deposits P_k. */
  const loadsInto = (s: ReturnType<typeof solve>, out: Float64Array) => {
    for (let k = 0; k < nDiv; k++) {
      const ts = s.strike[k]!;
      const q = s.edge.qT[k]!;
      const width = p.sigmaTheta / s.b[k]!;
      for (let i = 0; i < nTheta; i++) out[k * nTheta + i] = q * gauss(wrap(theta[i]! - ts), width);
    }
    return out;
  };

  /** Upstream temperature of every φ plane: T_u[j] = Σ_k s_k[j]·T_u,k. */
  const upstreamOf = (edge: EdgeSolution) => {
    const out = new Float64Array(nPhi);
    for (let j = 0; j < nPhi; j++) {
      let t = sector[0]![j]! * edge.Tu[0]!;
      for (let k = 1; k < nDiv; k++) t = t + sector[k]![j]! * edge.Tu[k]!;
      out[j] = t;
    }
    return out;
  };

  /** Step 12: T[c] = (max(0, 1 − Σ_k g_k)·T_u[c]^ν + Σ_k g_k·T_t,k^ν)^(1/ν). */
  const lcfsInto = (n: number, coils: Coils, out: Float64Array) => {
    const s = solve(n, coils);
    const up = upstreamOf(s.edge);
    const gTh = new Float64Array(nDiv * nTheta);
    for (let k = 0; k < nDiv; k++) {
      for (let i = 0; i < nTheta; i++) gTh[k * nTheta + i] = gauss(wrap(theta[i]! - s.strike[k]!), p.sigmaTheta);
    }
    const coldNu = Float64Array.from(s.edge.Tt, (t) => Math.pow(t, nu));
    for (let j = 0; j < nPhi; j++) {
      const upNu = Math.pow(up[j]!, nu);
      for (let i = 0; i < nTheta; i++) {
        let g = gPhi[0]![j]! * gTh[i]!;
        let gSum = g;
        let cold = g * coldNu[0]!;
        for (let k = 1; k < nDiv; k++) {
          g = gPhi[k]![j]! * gTh[k * nTheta + i]!;
          gSum = gSum + g;
          cold = cold + g * coldNu[k]!;
        }
        out[j * nTheta + i] = Math.pow(Math.max(1 - gSum, 0) * upNu + cold, 1 / nu);
      }
    }
    return out;
  };

  // Step 11: the CFC tiles, N_z cells through the thickness d of every strip cell.
  const nZ = p.tileCells;
  const dz = p.tileThickness / nZ;
  const nStrip = nDiv * nTheta;
  const conductivity = (T: number) => p.kRef / (1 + (T - p.Tref) / p.kScale);
  const heatCapacity = (T: number) => p.cpHigh - (p.cpHigh - p.cpRef) * Math.exp(-(T - p.Tref) / p.cpScale);
  const loads = new Float64Array(nStrip);
  const kz = new Float64Array(nZ);
  const net = new Float64Array(nZ);
  /** Step 11: one explicit conduction step of every tile from the loads at t_n, and the new surface temperatures. */
  const tilesInto = (n: number, slab: Float64Array, coils: Coils, slabN: Float64Array, tilesN: Float64Array) => {
    loadsInto(solve(n, coils), loads);
    for (let x = 0; x < nStrip; x++) {
      const o = x * nZ;
      const q = loads[x]! * p.MW;
      for (let z = 0; z < nZ; z++) {
        kz[z] = conductivity(slab[o + z]!);
        net[z] = 0;
      }
      net[0] = q;
      for (let z = 0; z + 1 < nZ; z++) {
        const flux = ((2 * kz[z]! * kz[z + 1]!) / (dz * (kz[z]! + kz[z + 1]!))) * (slab[o + z]! - slab[o + z + 1]!);
        net[z] = net[z]! - flux;
        net[z + 1] = net[z + 1]! + flux;
      }
      const back = slab[o + nZ - 1]!;
      net[nZ - 1] = net[nZ - 1]! - (back - p.Tcool) / (dz / (2 * kz[nZ - 1]!) + p.sinkResistance);
      for (let z = 0; z < nZ; z++) {
        const t = slab[o + z]!;
        slabN[o + z] = t + (p.dt * net[z]!) / (p.tileDensity * heatCapacity(t) * dz);
      }
      const top = slabN[o]!;
      tilesN[x] = top + (q * dz) / (2 * conductivity(top));
    }
  };

  const off = new Array<number>(nDiv).fill(0);
  /**
   * A state whose LCFS map (step 12) is computed only when read: the edge is quasi-steady, so a forecast that reads
   * only the tiles (the control loop's look-ahead) never pays for the map.
   */
  const stateAt = (n: number, coils: Coils, tiles: Float64Array, slab: Float64Array): ModelState => {
    const fixed = Array.from({ length: nDiv }, (_, k) => coils[k] ?? 0);
    let T: Float64Array | undefined;
    return {
      n,
      tiles,
      slab,
      get T() {
        T ??= lcfsInto(n, fixed, new Float64Array(nCells));
        return T;
      },
    };
  };
  const initialState = (): ModelState => ({
    n: 0,
    T: lcfsInto(0, off, new Float64Array(nCells)),
    tiles: new Float64Array(nStrip).fill(p.Tcool),
    slab: new Float64Array(nStrip * nZ).fill(p.Tcool),
  });

  const step = (st: ModelState, coils: Coils): ModelState => {
    const tiles = new Float64Array(nStrip);
    const slab = new Float64Array(nStrip * nZ);
    tilesInto(st.n, st.slab, coils, slab, tiles);
    return stateAt(st.n + 1, coils, tiles, slab);
  };

  const advance = (st: ModelState, coils: Coils, steps: number, controlsAt?: (step: number) => AppliedControls): ModelState => {
    if (steps <= 0) return st;
    const tiles = new Float64Array(nStrip);
    let slab = new Float64Array(nStrip * nZ);
    let slab2 = new Float64Array(nStrip * nZ);
    let last: Coils = controlsAt?.(st.n)?.coils ?? coils;
    tilesInto(st.n, st.slab, last, slab, tiles);
    for (let s = 1; s < steps; s++) {
      last = controlsAt?.(st.n + s)?.coils ?? coils;
      tilesInto(st.n + s, slab, last, slab2, tiles);
      [slab, slab2] = [slab2, slab];
    }
    // The edge is quasi-steady: only the final state's LCFS temperature is needed (with the coils of its last step).
    return stateAt(st.n + steps, last, tiles, slab);
  };

  const field = (coils: Coils, n: number, out = new Float64Array(nCells)) => fieldFromDrive(drive(coils, time(n)), out);

  const strikeLines = (coils: Coils, n: number) => {
    const a = drive(coils, time(n));
    return a.map((ak) => thetaD + p.sweepAmplitude * ak);
  };

  const stripLoads = (st: ModelState, coils: Coils) => loadsInto(solve(st.n, coils), new Float64Array(nDiv * nTheta));

  const edge = (n: number, coils: Coils): EdgeSolution => solve(n, coils).edge;
  const upstream = (n: number, coils: Coils) => upstreamOf(solve(n, coils).edge);

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

  /** Conducted heat flow along the field lines (renderer only): F_φ = −T^(ν−1)·∂T/∂φ along ℓ, F_θ = ι·F_φ. */
  const heatFlow = (st: ModelState, _coils: Coils) => {
    const fPhi = new Float64Array(nCells);
    const fTheta = new Float64Array(nCells);
    const T = st.T;
    for (let c = 0; c < nCells; c++) {
      const tp = (1 - w) * T[plus0[c]!]! + w * T[plus1[c]!]!;
      const tm = (1 - w) * T[minus0[c]!]! + w * T[minus1[c]!]!;
      const fp = (-Math.pow(T[c]!, nu - 1) * (tp - tm)) / (2 * dPhi);
      fPhi[c] = fp;
      fTheta[c] = iota * fp;
    }
    return { fPhi, fTheta };
  };

  /** Cross-section at plane j: the core profile from the plane's upstream temperature to T_0 on the axis. */
  const crossSection = (st: ModelState, coils: Coils, j: number) => {
    const nSurf = surfaces.length;
    const s = solve(st.n, coils);
    const a = s.a;
    const Txs = new Float64Array(nSurf * nTheta);
    const Bxs = new Float64Array(nSurf * nTheta);
    const rho = Float64Array.from(surfaces, (sf) => sf.rho);
    const edgeT = upstreamOf(s.edge)[j]!;
    const axisT = coreTemperature?.(time(st.n)) ?? p.Tcore0;
    for (let m = 0; m < nSurf; m++) {
      const rm = rho[m]!;
      const core = edgeT + (axisT - edgeT) * (1 - rm * rm) ** 2;
      const blend = Math.max(0, (rm - p.rhoBlend) / (1 - p.rhoBlend)) ** 2;
      const Bm = surfaces[m]!.B;
      for (let i = 0; i < nTheta; i++) {
        const c = j * nTheta + i;
        Txs[m * nTheta + i] = core + blend * (st.T[c]! - edgeT);
        let pert = 0;
        for (let k = 0; k < nDiv; k++) pert += a[k]! * h[k]![c]!;
        Bxs[m * nTheta + i] = Bm[c]! * (1 + rm * rm * p.epsilon * pert);
      }
    }
    return { T: Txs, B: Bxs, rho };
  };

  /** Δt·(largest outflow conductance: inner 2k/dz, back k/dz + 1/(dz/2k + R_sink))/(ρ·c·dz), k and c at T_ref. */
  const stabilityNumber = () => {
    const inner = (2 * p.kRef) / dz;
    const back = p.kRef / dz + 1 / (dz / (2 * p.kRef) + p.sinkResistance);
    return (p.dt * Math.max(inner, back)) / (p.tileDensity * p.cpRef * dz);
  };

  /** Steady state with k(T) (Kirchhoff): ∫k dT = q·d through the CFC, T_back = T_cool + q·R_sink behind it. */
  const steadySurface = (Q: number) => {
    const q = Q * p.MW;
    const back = p.Tcool + q * p.sinkResistance;
    return p.Tref + p.kScale * ((1 + (back - p.Tref) / p.kScale) * Math.exp((q * p.tileThickness) / (p.kRef * p.kScale)) - 1);
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
    edge,
    upstream,
    diagnostics,
    run,
    heatFlow,
    crossSection,
    stabilityNumber,
    tileCells: nZ,
    conductivity,
    heatCapacity,
    steadySurface,
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
  return { n: st.n, T: Float64Array.from(st.T), tiles: Float64Array.from(st.tiles), slab: Float64Array.from(st.slab) };
}
