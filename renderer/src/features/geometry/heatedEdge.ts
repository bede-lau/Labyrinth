import { createModel } from '../heatfield/model';
import { colourRanges, T_FLOOR } from '../heatfield/scene';
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

const modulation = 0.72;
/** How much of the core's stored-energy swing reaches the heating power crossing the LCFS. */
const SUPPLY_SWING = 0.23;
const omega = 2 * Math.PI / 5;
const lossTime = 0.7;

// Periodic solution of dE/dt = P(t) - E/tau, with positive imposed power
// P(t) = meanE/tau * (1 + modulation*sin(omega*t)).
function coreResponse(time: number) {
  const lag = omega * lossTime;
  return 1 + modulation * (Math.sin(omega*time) - lag*Math.cos(omega*time)) / (1 + lag*lag);
}

export function heatedRanges(art: HeatfieldArtifact, sim: Simulation) {
  const ranges = colourRanges(art, sim.model, sim.start.T);
  const {Tcore0} = sim.model.params;
  // One shared logarithmic scale for the edge and the core slice: T_FLOOR to the hottest core the scenario reaches.
  const hot = Tcore0 * (1 + modulation / Math.hypot(1, omega * lossTime));
  ranges.lcfsT = [T_FLOOR, hot];
  ranges.sliceT = [T_FLOOR, hot];
  return ranges;
}

// Illustrative periodic modulation of the heating power and its toroidal distribution. The same deterministic source
// drives the power shares, the load diagnostics and the look-ahead. Amplitude and period are display scenarios.
function ramp(time: number, duration: number) {
  const u = Math.max(0, Math.min(1, time / duration));
  return u * u * (3 - 2 * u);
}

export function startupSimulation(art: HeatfieldArtifact) {
  // Cold start: no heating before 0.4 s, so no power on the targets and no scrape-off-layer plasma.
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

/** The scenario's heating power once on (MW): its mean and the range the core modulation spans. */
export function scenarioHeating(Pheat: number) {
  const mean = SCENARIO_POWER * Pheat;
  const swing = SUPPLY_SWING * modulation / Math.hypot(1, omega * lossTime);
  return { mean, lo: mean * (1 - swing), hi: mean * (1 + swing), factor: SCENARIO_POWER };
}

/**
 * The plasma explorer's scenario: the heating power density on every LCFS cell relative to the nominal P_heat. It
 * ramps in from 0.4 s, first in the sector centred on D1, then everywhere; once on, its total is SCENARIO_POWER times
 * the nominal, modulated (a core whose stored energy follows a periodic power, loss time 0.7 s). Only its toroidal
 * distribution matters: each divertor takes its sector's power (MODEL.md step 6).
 */
export function heatedEdge(art: HeatfieldArtifact) {
  const { nTheta, nPhi } = art.grid;
  const sector = Float64Array.from({length: nPhi}, (_, j) =>
    (1 + Math.cos(2 * Math.PI * j / nPhi - art.diverters.items[0]!.phi)) / 2);
  const weight = new Float64Array(nTheta * nPhi);
  return createModel(art, (time) => {
    const supply = 1 + SUPPLY_SWING * (coreResponse(time) - 1);
    const edge = ramp(time - 0.4, 2);
    const spread = ramp(time - 2, 5);
    for (let j = 0; j < nPhi; j++) {
      const gain = SCENARIO_POWER * edge * (spread + (1 - spread) * sector[j]!);
      weight.fill(gain * supply, j * nTheta, (j + 1) * nTheta);
    }
    return weight;
  }, time => ramp(time, 1.3) * art.model.parameters.Tcore0.value * coreResponse(time));
}
