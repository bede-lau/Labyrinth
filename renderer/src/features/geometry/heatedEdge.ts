import { createModel } from '../heatfield/model';
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

const modulation = 0.72;
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
  const {Tcore0, Tped} = sim.model.params;
  ranges.sliceT[1] = Tped + (Tcore0 - Tped) * (1 + modulation / Math.hypot(1, omega * lossTime));
  // Keep the operating window legible after ignition; colder cells use
  // the low end of the edge palette while the core uses the full scale.
  ranges.lcfsT = [0.6 * Tped, 1.4 * Tped];
  return ranges;
}

// Illustrative periodic modulation of core-to-edge heating. The same deterministic source
// drives transport, flux diagnostics and look-ahead. Amplitude and period are display scenarios.
function ramp(time: number, duration: number) {
  const u = Math.max(0, Math.min(1, time / duration));
  return u * u * (3 - 2 * u);
}

export function startupSimulation(art: HeatfieldArtifact) {
  const model = heatedEdge(art);
  const cold = model.initialState();
  cold.T.fill(model.params.Ttarget);
  return new Simulation(model, cold, 0.35);
}

export function heatedEdge(art: HeatfieldArtifact) {
  const { nTheta, nPhi } = art.grid;
  const pedestal = art.model.parameters.Tped.value;
  const floor = art.model.parameters.Ttarget.value;
  const pedestalAt = (time: number) => floor + (pedestal - floor) * ramp(time - 0.4, 2);
  // The first heating sector is centred on D1. The other sectors catch up
  // smoothly before the periodic operating source takes over everywhere.
  const sector = Float64Array.from({length: nPhi}, (_, j) =>
    (1 + Math.cos(2 * Math.PI * j / nPhi - art.diverters.items[0]!.phi)) / 2);
  const cosine = new Float64Array(nTheta * nPhi);
  const sine = new Float64Array(cosine.length);
  const target = new Float64Array(cosine.length);
  for (let j = 0; j < nPhi; j++) {
    for (let i = 0; i < nTheta; i++) {
      const phase = 2 * Math.PI * (i / nTheta - 2 * j / nPhi);
      cosine[j * nTheta + i] = Math.cos(phase);
      sine[j * nTheta + i] = Math.sin(phase);
    }
  }
  return createModel(art, (time) => {
    const phase = 2 * Math.PI * time / 4;
    const a = 0.26 * Math.cos(phase);
    const b = 0.26 * Math.sin(phase);
    const supply = 1 + 0.23 * (coreResponse(time) - 1);
    const edge = ramp(time - 0.4, 2);
    const spread = ramp(time - 2, 5);
    for (let j = 0; j < nPhi; j++) {
      const gain = edge * (spread + (1 - spread) * sector[j]!);
      for (let i = 0; i < nTheta; i++) {
        const c = j * nTheta + i;
        const warm = pedestal * (supply + a * cosine[c]! + b * sine[c]!);
        target[c] = floor + gain * (warm - floor);
      }
    }
    return target;
  }, time => floor + ramp(time, 1.3) *
    (pedestal + (art.model.parameters.Tcore0.value - pedestal) * coreResponse(time) - floor), pedestalAt);
}
