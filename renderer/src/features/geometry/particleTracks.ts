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
/** Seconds of display time for a tracer's drawn flight into its plate (slow motion: see `slowdown`). */
export const FLIGHT_SECONDS = 1.2;

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
 * Plasma tracers (physical in path, slowed in time). Charged particles stream along the magnetic field; in the scrape-off
 * layer they run from upstream to the divertor targets at about the sound speed c_s = √(2eT_u/m_i). Each tracer follows
 * the field line that lands on its divertor's strike line (the model's own, swept by the coils), starting halfway to
 * the neighbouring divertor, and starts again upstream when it reaches the plate. What is drawn is only the last few
 * metres (`drawnLength`) of a ~200 m connection length that winds many times round the island. Real ions move at up to
 * c_s (Mach 1 is reached only at the target; upstream the flow is subsonic), so the whole transit takes at least
 * L_c/c_s ≈ 1 ms (`realFlight`). On screen a tracer covers its drawn path in FLIGHT_SECONDS; `slowdown` is c_s over that
 * screen speed.
 */
export function createParticleTracks(art: HeatfieldArtifact, sim: Simulation) {
  const sites = art.diverters.items;
  const edge = art.surfaces.at(-1)!;
  const {nTheta, nPhi} = art.grid;
  const thetaAt = fieldLineAtlas(art, sim.model.iota);
  // A tracer's flight covers most of the half-sector before its divertor (it never leaves its own sector).
  const reach = 0.9 * Math.PI / sites.length;
  const initial = () => sites.map(() => ({ history: [] as Sample[], progress: -1 }));
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

  function frame() {
    const time = sim.time;
    if (time < previous) tracks = initial();
    previous = time;
    const field = sim.field();
    const loads = sim.model.stripLoads(sim.state, sim.coils);
    const strike = sim.model.strikeLines(sim.coils, sim.state.n);
    const edgeSolution = sim.model.edge(sim.state.n, sim.coils);
    const p = sim.model.params;
    return tracks.map((track, from) => {
      // Each tracer stays with its own diverter (it follows the field into that plate).
      const phiK = sites[from]!.phi;
      // The traced line through the strike point; if none is found, the straight-field-line label (λ neglected).
      const found = labelThrough(strike[from]!, phiK);
      const alpha = Number.isFinite(found) ? found : wrap(strike[from]! - sim.model.iota * phiK);
      const lineAt = (s: number) => {
        const ph = phiK - reach * (1 - s);
        const [rr, zz] = sampleRZ(edge, nTheta, nPhi, thetaAt(alpha, ph), wrap(ph));
        return toXYZ(rr, zz, wrap(ph));
      };
      // Length of the drawn piece of field line (m).
      let drawnLength = 0;
      for (let i = 1, last = lineAt(0); i <= 24; i++) {
        const next = lineAt(i / 24);
        drawnLength += Math.hypot(next[0] - last[0], next[1] - last[1], next[2] - last[2]);
        last = next;
      }
      const progress = (time / FLIGHT_SECONDS + from / sites.length) % 1;
      if (progress < track.progress) track.history = []; // landed: start again upstream, with a fresh trail
      track.progress = progress;
      const phi = wrap(phiK - reach * (1 - progress));
      const theta = thetaAt(alpha, phiK - reach * (1 - progress));
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
      // Slow motion: the real flight along the connection length at the sound speed, against the shown one.
      const tu = edgeSolution.Tu[from]!;
      const cs = tu > 0 ? Math.sqrt((2 * tu * p.keV) / (p.ionMass * p.amu)) : 0;
      const realFlight = cs > 0 ? p.connectionLength / cs : Infinity;
      const slowdown = cs > 0 ? cs / (drawnLength / FLIGHT_SECONDS) : 0;
      return {id:from+1, from, flux, phi, theta, alpha, progress, position, trail, realFlight, slowdown, drawnLength,
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
