import { plasmaMaterials } from '../../design/tokens';
import { sampleRZ, toXYZ, vmecTheta } from '../heatfield/scene';
import type { Simulation } from '../heatfield/sim';
import type { HeatfieldArtifact } from '../heatfield/types';

const tau = 2 * Math.PI;
const wrap = (v: number) => ((v % tau) + tau) % tau;
const wrapPi = (v: number) => wrap(v + Math.PI) - Math.PI;
export const particleColours = plasmaMaterials.particleColours;

type Vec3 = ReturnType<typeof toXYZ>;
interface Sample { time: number; position: Vec3 }
const tailStep = 0.018;
const tailLength = 14;
/** Seconds of display time for a tracer to stream once round the torus along its field line (slow motion). */
export const TURN_SECONDS = 15;

// Read the path the head actually traversed.
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

/**
 * Field lines on the LCFS at any label α, from the 8 lines traced on the VMEC equilibrium (PEST tracer, θ* = α + ι·φ).
 * Each traced sample's VMEC θ is found from its position once; between traced lines θ is interpolated in α at fixed φ,
 * so a line keeps the equilibrium's λ. Beyond one toroidal turn the label shifts by 2πι per turn.
 */
function fieldLineAtlas(art: HeatfieldArtifact, iota: number) {
  const { nTheta, nPhi } = art.grid;
  const edge = art.surfaces.at(-1)!;
  const lines = art.fieldLines.map((f) => ({
    alpha: f.alpha,
    theta: Float64Array.from(f.phi, (ph, s) => vmecTheta(edge, nTheta, nPhi, Math.hypot(f.x[s]!, f.y[s]!), f.z[s]!, ph)),
    n: f.phi.length,
  })).sort((a, b) => a.alpha - b.alpha);
  const m = lines.length;
  const thetaOf = (line: (typeof lines)[number], phi: number) => {
    const x = (phi / tau) * (line.n - 1);
    const i = Math.min(line.n - 2, Math.floor(x));
    const f = x - i;
    return line.theta[i]! + f * wrapPi(line.theta[i + 1]! - line.theta[i]!);
  };
  /** VMEC θ of field line α at toroidal angle φ (any φ). */
  return (alpha: number, phi: number) => {
    const p = wrap(phi);
    const a = wrap(alpha + iota * (phi - p));
    // Bracket a between consecutive traced labels (the last bracket wraps to the first line + 2π).
    let j = m - 1;
    for (let q = 0; q < m; q++) if (lines[q]!.alpha <= a) j = q;
    const lo = lines[j]!;
    const hi = lines[(j + 1) % m]!;
    const span = wrap(hi.alpha - lo.alpha) || tau;
    const f = wrap(a - lo.alpha) / span;
    const t0 = thetaOf(lo, p);
    // Along α at fixed φ, θ increases: the step to the next line is in (0, 2π).
    return t0 + f * wrap(thetaOf(hi, p) - t0);
  };
}

/**
 * Plasma tracers (physical in path, slowed in time). Charged particles stream along the magnetic field; on a closed flux
 * surface (the LCFS) a field line never ends, so a particle on it keeps streaming round the torus on its own field line
 * (its label α stays fixed). Each tracer starts at its divertor's nominal strike line (θ_d at φ_k) and streams
 * continuously in +φ, one toroidal turn per TURN_SECONDS, crossing φ = 0 smoothly (the label shifts by 2πι per turn).
 * Heat reaches the plates only in the scrape-off layer just outside the LCFS (the heat comets show that). Real ions move
 * at about the sound speed c_s = √(2eT_u/m_i); `slowdown` is c_s over the tracer's speed on screen.
 */
export function createParticleTracks(art: HeatfieldArtifact, sim: Simulation) {
  const sites = art.diverters.items;
  const edge = art.surfaces.at(-1)!;
  const {nTheta, nPhi} = art.grid;
  const thetaAt = fieldLineAtlas(art, sim.model.iota);
  const omega = tau / TURN_SECONDS;
  const initial = () => sites.map(() => ({ history: [] as Sample[] }));
  let tracks = initial();
  let previous = sim.time;

  /** The label α of the field line through (θ_s, φ_k): θ(α, φ_k) is increasing in α; scan, then interpolate. */
  const labelThrough = (thetaS: number, phiK: number) => {
    const n = 64;
    let prev = wrapPi(thetaAt(0, phiK) - thetaS);
    for (let i = 1; i <= n; i++) {
      const a = (tau * i) / n;
      const g = wrapPi(thetaAt(a, phiK) - thetaS);
      if (prev < 0 && g >= 0 && g - prev < Math.PI) return a - (tau / n) * (g / (g - prev));
      prev = g;
    }
    return NaN; // no line found (the caller falls back)
  };
  // Each tracer's field line, fixed for good: the line through its divertor's nominal strike line (if none is found, the
  // straight-field-line label, λ neglected).
  const labels = sites.map((site) => {
    const found = labelThrough(sim.model.thetaD, site.phi);
    return Number.isFinite(found) ? found : wrap(sim.model.thetaD - sim.model.iota * site.phi);
  });
  const pointAt = (alpha: number, phiU: number) => {
    const phi = wrap(phiU);
    const theta = thetaAt(alpha, phiU);
    const [r, z] = sampleRZ(edge, nTheta, nPhi, theta, phi);
    return { phi, theta, position: toXYZ(r, z, phi) };
  };
  const nearest = (phi: number) => {
    let best = 0;
    sites.forEach((site, k) => {
      if (Math.abs(wrapPi(phi - site.phi)) < Math.abs(wrapPi(phi - sites[best]!.phi))) best = k;
    });
    return best;
  };

  function frame() {
    const time = sim.time;
    if (time < previous) tracks = initial();
    previous = time;
    const field = sim.field();
    const loads = sim.model.stripLoads(sim.state, sim.coils);
    const edgeSolution = sim.model.edge(sim.state.n, sim.coils);
    const p = sim.model.params;
    return tracks.map((track, k) => {
      const alpha = labels[k]!;
      // Unwrapped toroidal angle: continuous for ever (never restarts).
      const phiU = sites[k]!.phi + omega * time;
      const { phi, theta, position } = pointAt(alpha, phiU);
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
      // The divertor the tracer is passing now, and its peak load.
      const from = nearest(phi);
      const flux = Math.max(...loads.subarray(from*nTheta,(from+1)*nTheta));
      // Speed on screen along the field line (m/s), from the line's length per radian of φ here, against c_s.
      const h = 1e-3;
      const ahead = pointAt(alpha, phiU + h).position;
      const screenSpeed = (Math.hypot(ahead[0] - position[0], ahead[1] - position[1], ahead[2] - position[2]) / h) * omega;
      const tu = edgeSolution.Tu[from]!;
      const cs = tu > 0 ? Math.sqrt((2 * tu * p.keV) / (p.ionMass * p.amu)) : 0;
      const slowdown = cs > 0 ? cs / screenSpeed : 0;
      return {id:k+1, from, flux, phi, phiU, theta, alpha, position, trail, screenSpeed, soundSpeed: cs, slowdown,
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
  }, thetaAt};
}
export type ParticleTracks = ReturnType<typeof createParticleTracks>;
