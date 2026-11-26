import { plasmaMaterials } from '../../design/tokens';
import { sampleRZ, toXYZ } from '../heatfield/scene';
import type { Simulation } from '../heatfield/sim';
import type { HeatfieldArtifact } from '../heatfield/types';

const tau = 2 * Math.PI;
const wrap = (v: number) => ((v % tau) + tau) % tau;
const shortestArc = (from: number, to: number) => wrap(to - from + Math.PI) - Math.PI;
export const particleColours = plasmaMaterials.particleColours;

type Vec3 = ReturnType<typeof toXYZ>;
interface Sample { time: number; position: Vec3 }
const tailStep = 0.018;
const tailLength = 14;

// Read the path the head actually traversed, including the outgoing arc of a turn.
function sampleTrail(history: Sample[], now: number) {
  const cutoff = now - tailLength * tailStep;
  while (history.length > 1 && history[1]!.time <= cutoff) history.shift();
  let index = history.length - 1;
  return Array.from({length: tailLength}, (_, i): Vec3 => {
    const t = now - (i+1)*tailStep;
    while (index > 0 && history[index]!.time > t) index--;
    const left = history[index]!;
    const right = history[index+1];
    if (!right || t <= left.time) return left.position;
    const f = (t-left.time)/(right.time-left.time);
    return [0,1,2].map(k => left.position[k]! + f*(right.position[k]!-left.position[k]!)) as Vec3;
  });
}

export function createParticleTracks(art: HeatfieldArtifact, sim: Simulation) {
  const sites = art.diverters.items;
  const edge = art.surfaces.at(-1)!;
  const {nTheta, nPhi} = art.grid;
  const initial = () => sites.map(() => ({ history: [] as Sample[] }));
  let tracks = initial();
  let previous = sim.time;

  function frame() {
    const time = sim.time;
    if (time < previous) tracks = initial();
    previous = time;
    const field = sim.field();
    const loads = sim.model.stripLoads(sim.state, sim.coils);
    // The model's own strike line of each diverter (θ where its footprint sits under the applied coils).
    const strike = sim.model.strikeLines(sim.coils, sim.state.n);
    return tracks.map((track, from) => {
      // Each tracer stays with its own diverter: nothing pipes heat between targets (D-031); the coils only change how
      // much power each divertor receives (D-035).
      const centre = sites[from]!.phi;
      const phase = 1.9*time + tau*from/sites.length;
      const phi = wrap(centre + 0.13*Math.sin(phase));
      // Circulate near the strike footprint. The swept offset is the model's strike line
      // of the nearby diverters, weighted by toroidal distance, so it is exact at each footprint.
      let weight = 0, shift = 0;
      sites.forEach((site, k) => {
        const d = shortestArc(phi, site.phi);
        const w = Math.exp(-d*d/0.24);
        weight += w;
        shift += w * (strike[k]! - sim.model.thetaD);
      });
      const theta = art.diverters.thetaCentre + 0.48*Math.cos(phase) +
        shift/weight;
      const [r,z] = sampleRZ(edge,nTheta,nPhi,theta,phi);
      const position = toXYZ(r,z,phi);
      if (track.history.at(-1)?.time === time) track.history.pop();
      track.history.push({time,position});
      const trail = sampleTrail(track.history, time);
      const u = wrap(theta)/tau*nTheta, v = phi/tau*nPhi;
      const a = Math.floor(u), b = Math.floor(v);
      const value = (data: Float64Array) => {
        const row = (j: number) => (1-u%1)*data[(j%nPhi)*nTheta+a]! +
          (u%1)*data[(j%nPhi)*nTheta+(a+1)%nTheta]!;
        return (1-v%1)*row(b) + (v%1)*row(b+1);
      };
      const flux = Math.max(...loads.subarray(from*nTheta,(from+1)*nTheta));
      return {id:from+1, from, flux, phi, theta, position, trail,
        field:value(field), temperature:value(sim.state.T)};
    });
  }

  let version = sim.version;
  let rows = frame();
  return { read() {
    if (version !== sim.version) {
      rows = frame();
      version = sim.version;
    }
    return rows;
  }};
}
export type ParticleTracks = ReturnType<typeof createParticleTracks>;
