import { createModel, paramsOf } from '../heatfield/model';
import { colourRanges } from '../heatfield/scene';
import { Simulation } from '../heatfield/sim';
import type { Diverter, HeatfieldArtifact } from '../heatfield/types';

// Place the five schematic targets on actual sampled planes. The saved fixture stays intact.
export function fiveTargetScenario(art: HeatfieldArtifact): HeatfieldArtifact {
  const ids = ['D1', 'D2', 'D3', 'D4', 'D5'] as const;
  const items: Diverter[] = ids.map((id, k) => {
    const phi = 2 * Math.PI * Math.round(k * art.grid.nPhi / ids.length) / art.grid.nPhi;
    return { id, phi, label: id };
  });
  return { ...art, diverters: { ...art.diverters, items } };
}

// The scenario's heating (display choices, stated in the view): the heaters switch on at HEATING_ON and ramp in over
// HEATING_RAMP, then the power is modulated by ±MODULATION at period 2π/OMEGA (a power-modulation experiment).
const HEATING_ON = 0.2;
const HEATING_RAMP = 0.3;
const MODULATION = 0.12;
const OMEGA = 2 * Math.PI / 5;

function ramp(time: number, duration: number) {
  const u = Math.max(0, Math.min(1, time / duration));
  return u * u * (3 - 2 * u);
}

/**
 * 0-D core energy balance (physical): dW/dt = P_in(t) − W/τ_E(P_in(t)), with τ_E the ISS04 confinement time at the
 * heating power of the moment (τ_E ∝ P^−0.61: confinement degrades as the power rises). The power that leaves the core,
 * W/τ_E, is what crosses the LCFS and reaches the divertors (energy conserved: until the core has filled, part of the
 * heating goes into stored energy). The core temperature follows from W (flat density, T_e = T_i, the MODEL.md profile)
 * and the edge temperature from the two-point law T_u ∝ P^(1/ν).
 */
export function scenarioCoreEnergy(art: HeatfieldArtifact) {
  const p = paramsOf(art);
  const nominal = createModel(art);
  const mean = SCENARIO_POWER * p.Pheat;
  /** τ_E at the scenario's mean power (the frequency response of the modulation is quoted with it). */
  const tau = nominal.confinementTime(mean);
  const heating = (t: number) => mean * ramp(t - HEATING_ON, HEATING_RAMP) * (1 + MODULATION * Math.sin(OMEGA * Math.max(0, t - HEATING_ON)));
  /** ISS04 τ_E at the power of time t. Below 1 % of the mean power the heating is off and nothing is stored; τ is held
   * at that floor so it stays finite (ISS04 diverges as P → 0). */
  const tauAt = (t: number) => nominal.confinementTime(Math.max(heating(t), 0.01 * mean));
  // W on the model's time grid (exponential integrator with τ_E frozen over a step: exact for P and τ constant over it),
  // extended on demand.
  const dt = p.dt;
  const W = [0];
  const energyAt = (t: number) => {
    const n = Math.max(0, t / dt);
    while (W.length <= Math.ceil(n)) {
      const k = W.length - 1;
      const tk = tauAt(k * dt);
      const decay = Math.exp(-dt / tk);
      W.push(W[k]! * decay + heating(k * dt) * p.MW * tk * (1 - decay));
    }
    const k = Math.floor(n);
    const f = n - k;
    return (1 - f) * W[k]! + f * W[Math.min(k + 1, W.length - 1)]!;
  };
  const lossPower = (t: number) => energyAt(t) / tauAt(t) / p.MW; // MW crossing the LCFS
  const upstreamNominal = (() => {
    const u = nominal.upstream(0, art.diverters.items.map(() => 0));
    let s = 0;
    for (const v of u) s += v;
    return s / u.length;
  })();
  const edgeT = (P: number) => upstreamNominal * Math.max(0, P / p.Pheat) ** (1 / p.conductionExponent);
  const coreT = (W: number, P: number) => {
    const mean = W / (3 * p.coreDensity * nominal.plasmaVolume * p.keV);
    const te = edgeT(P);
    return Math.max(te, te + 3 * (mean - te));
  };
  return {
    tau,
    mean,
    heating,
    lossPower,
    coreAt: (t: number) => coreT(energyAt(t), lossPower(t)),
    /** τ_E (s) at time t: ISS04 at the heating power of that moment. */
    tauAt,
    /** Steady state at a constant power P (MW): W = P·τ_E(P). */
    steadyCore: (P: number) => coreT(P * p.MW * nominal.confinementTime(P), P),
  };
}

export function heatedRanges(art: HeatfieldArtifact, sim: Simulation) {
  const ranges = colourRanges(art, sim.model, sim.start.T);
  const core = scenarioCoreEnergy(art);
  const h = scenarioHeating(art);
  // One shared LINEAR scale for the edge and the core slice (D-038): 0 to the hottest core the scenario reaches, so the
  // cold edge reads blue and the hot core red.
  const hot = core.steadyCore(h.hi);
  ranges.lcfsT = [0, hot];
  ranges.sliceT = [0, hot];
  return ranges;
}

export function startupSimulation(art: HeatfieldArtifact) {
  // Cold start: no heating before HEATING_ON, so no stored energy, no power on the targets and no scrape-off layer.
  const model = heatedEdge(art);
  return new Simulation(model, model.initialState(), 0.35);
}

/**
 * Heating power of the plasma explorer's scenario relative to the model's nominal P_heat (7.5 MW): a high-power phase of
 * 9.4 MW on average, modulated between about 8.2 and 10.5 MW, above W7-X's ~8 MW of ECRH (it needs NBI as well). With
 * five divertors sharing it, the nominal 7.5 MW would leave every tile under the limit: the control loop would have
 * nothing to do. A display scenario, chosen so the coils are needed, and shown as such in the view (`scenarioHeating`).
 */
export const SCENARIO_POWER = 1.25;

/**
 * The scenario's heating once on (MW): its mean and the range of the power crossing the LCFS (the heating modulation
 * as the core passes it on, amplitude reduced by 1/√(1 + (ωτ_E)²)).
 */
export function scenarioHeating(art: HeatfieldArtifact) {
  const core = scenarioCoreEnergy(art);
  const swing = MODULATION / Math.hypot(1, OMEGA * core.tau);
  return { mean: core.mean, lo: core.mean * (1 - swing), hi: core.mean * (1 + swing), factor: SCENARIO_POWER, tauE: core.tau };
}

/**
 * The plasma explorer's scenario: the power crossing the LCFS, relative to the nominal P_heat, on every LCFS cell
 * (toroidally uniform: fast parallel transport spreads it round the torus), from the 0-D core energy balance; and the
 * axis temperature from the core's stored energy. Each divertor takes its sector's power (MODEL.md step 6).
 */
export function heatedEdge(art: HeatfieldArtifact) {
  const { nTheta, nPhi } = art.grid;
  const p = paramsOf(art);
  const core = scenarioCoreEnergy(art);
  const weight = new Float64Array(nTheta * nPhi);
  return createModel(art, (time) => {
    weight.fill(core.lossPower(time) / p.Pheat);
    return weight;
  }, (time) => core.coreAt(time));
}
