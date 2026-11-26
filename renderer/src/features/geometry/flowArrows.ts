// How the heat flows, drawn on the 3D model (D-039) so anyone can follow it. Heat is shown one way only: glowing
// warm dots with fading tails (comets) that drift along faint guide lines and land on the divertor plates.
//  - streams: from the hot core out to every divertor. More and brighter comets for a divertor that receives more
//    power (its share P_k). Schematic in path (heat crosses the LCFS everywhere and follows field lines to the plates),
//    exact in amount (the model's shares).
//  - transfers: round the outside of the torus from a divertor whose coil sheds power to each divertor that takes it up
//    (transfer.ts), with an arrowhead at the receiver. More comets for a larger transfer.
//  - catchers: every divertor plate glows as brightly as the power it catches.
// Everything is drawn over the plasma (no depth test) with additive blending, so it glows and is never hidden.
import { plasmaMaterials } from '../../design/tokens';
import type { Simulation } from '../heatfield/sim';
import { largestFlows, powerTransfer } from '../heatfield/transfer';
import type { HeatfieldArtifact } from '../heatfield/types';

type Three = typeof import('three');
type Curve = import('three').CatmullRomCurve3;

/** Flows below this are not drawn (MW). */
const MIN_MW = 0.005;
/** Seconds of simulation time for a comet to run the length of its path. */
export const PULSE_SECONDS = 1.2;
/** Points in a comet's tail behind its head, and the spacing between them (fraction of the path). */
const TAIL = 10;
const TAIL_STEP = 0.012;
/** On-screen sizes (px) of a comet's head and tail points and of a catcher's glow. */
const HEAD_PX = 14;
const TAIL_PX = 8;
const CATCHER_PX = 44;

/** A path the heat follows: its curve, what it is, and how much power it carries relative to the largest of its kind. */
export interface FlowPath {
  name: string;
  kind: 'stream' | 'transfer';
  curve: Curve;
  /** 0–1: this path's power over the largest path of the same kind. */
  weight: number;
  /** Comets on the path. */
  comets: number;
}

/** A soft round glow (white, alpha falling off like a Gaussian), built in memory so it needs no canvas. */
function glowTexture(three: Three) {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const a = Math.exp(-(dx * dx + dy * dy) * 28);
      const o = 4 * (y * n + x);
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = Math.round(255 * (a < 0.02 ? 0 : a));
    }
  const tex = new three.DataTexture(data, n, n, three.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

export function buildFlowArrows(three: Three, art: HeatfieldArtifact) {
  const { nTheta, nPhi } = art.grid;
  const lcfs = art.surfaces[art.surfaces.length - 1]!;
  const axis = art.surfaces[0]!;
  const at = (s: typeof lcfs, j: number, i: number, out = 0) => {
    const k = j * nTheta + i;
    const r = s.R[k]! + out;
    const phi = (2 * Math.PI * j) / nPhi;
    return new three.Vector3(r * Math.cos(phi), r * Math.sin(phi), s.Z[k]!);
  };
  // A ring 0.3 m outside the LCFS's outboard edge, at the height of that edge, one point per φ plane.
  const ring = Array.from({ length: nPhi }, (_, j) => {
    let best = 0;
    for (let i = 1; i < nTheta; i++) if (lcfs.R[j * nTheta + i]! > lcfs.R[j * nTheta + best]!) best = i;
    return at(lcfs, j, best, 0.3);
  });
  const glow = glowTexture(three);
  const warm = new three.Color(plasmaMaterials.heatGlow);
  const hot = new three.Color(plasmaMaterials.heatGlowCore);
  const glowing = { transparent: true, depthWrite: false, depthTest: false, blending: three.AdditiveBlending } as const;
  // Sizes in screen pixels (no attenuation), so the glow reads the same at every zoom.
  const px = { map: glow, vertexColors: true, sizeAttenuation: false, ...glowing } as const;
  const headMaterial = new three.PointsMaterial({ size: HEAD_PX, ...px });
  const tailMaterial = new three.PointsMaterial({ size: TAIL_PX, ...px });
  const catcherMaterial = new three.PointsMaterial({ size: CATCHER_PX, ...px });
  const guideMaterial = new three.LineBasicMaterial({ color: warm, opacity: 0.22, ...glowing });
  const tipMaterial = new three.MeshBasicMaterial({ color: warm, opacity: 0.75, ...glowing });

  const group = new three.Group();
  group.name = 'Heat flow';
  group.renderOrder = 20;
  const guides = new three.Group();
  const comets = new three.Group();
  const catchers = new three.Group();
  group.add(guides, catchers, comets);

  const planeOf = (phi: number) => Math.round((((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / ((2 * Math.PI) / nPhi)) % nPhi;
  const plateAt = (model: Simulation['model'], k: number) =>
    at(lcfs, planeOf(model.phiK[k]!), Math.round(model.thetaD / model.dTheta) % nTheta, 0.12);

  let paths: FlowPath[] = [];
  let key = '';
  let heads: import('three').Points | undefined;
  let tails: import('three').Points | undefined;

  /** The arc of ring points from φ_a to φ_b the short way round, a little short of both plates. */
  const arc = (a: number, b: number) => {
    const ja = planeOf(a);
    const jb = planeOf(b);
    let d = jb - ja;
    if (d > nPhi / 2) d -= nPhi;
    if (d < -nPhi / 2) d += nPhi;
    const s = Math.sign(d);
    const gap = Math.max(1, Math.round(nPhi / 60));
    const pts = [];
    for (let i = gap; i <= Math.abs(d) - gap; i++) pts.push(ring[(((ja + s * i) % nPhi) + nPhi) % nPhi]!);
    return pts;
  };

  const empty = (holder: import('three').Group) => {
    for (const child of [...holder.children]) {
      holder.remove(child);
      (child as import('three').Mesh).geometry.dispose();
    }
  };

  const pointsOf = (n: number, material: import('three').PointsMaterial) => {
    const g = new three.BufferGeometry();
    g.setAttribute('position', new three.Float32BufferAttribute(new Float32Array(3 * n), 3));
    g.setAttribute('color', new three.Float32BufferAttribute(new Float32Array(3 * n), 3));
    const p = new three.Points(g, material);
    p.frustumCulled = false;
    return p;
  };

  const rebuild = (sim: Simulation, shares: Float64Array) => {
    const model = sim.model;
    empty(guides);
    empty(comets);
    empty(catchers);
    paths = [];
    const most = Math.max(...shares);
    if (most > MIN_MW)
      shares.forEach((share, k) => {
        if (!(share > MIN_MW)) return;
        const j = planeOf(model.phiK[k]!);
        const start = at(axis, j, 0);
        const end = plateAt(model, k);
        // A gentle bow, so the stream reads as a flow, not a spoke.
        const mid = start.clone().lerp(end, 0.5).add(new three.Vector3(0, 0, 0.25));
        const w = share / most;
        paths.push({ name: `core to D${k + 1}`, kind: 'stream', curve: new three.CatmullRomCurve3([start, mid, end]), weight: w, comets: 2 + Math.round(3 * w) });
      });
    const flows = largestFlows(powerTransfer(model, sim.state.n, sim.coils), MIN_MW);
    const widest = flows.length ? flows[0]![2] : 1;
    flows.forEach(([a, b, v], index) => {
      const pts = arc(model.phiK[a]!, model.phiK[b]!).map((p) => p.clone().setZ(p.z + 0.15 * index));
      if (pts.length < 2) return;
      const w = v / widest;
      paths.push({ name: `D${a + 1} to D${b + 1}`, kind: 'transfer', curve: new three.CatmullRomCurve3(pts), weight: w, comets: 2 + Math.round(4 * w) });
    });
    for (const path of paths) {
      const line = new three.Line(new three.BufferGeometry().setFromPoints(path.curve.getPoints(60)), guideMaterial);
      line.name = path.name;
      guides.add(line);
      if (path.kind === 'transfer') {
        // A soft arrowhead where the pushed heat lands.
        const tip = new three.Mesh(new three.ConeGeometry(0.2, 0.55, 16), tipMaterial);
        const end = path.curve.getPoint(1);
        const tangent = path.curve.getTangent(1);
        tip.position.copy(end).addScaledVector(tangent, 0.27);
        tip.quaternion.setFromUnitVectors(new three.Vector3(0, 1, 0), tangent);
        tip.name = path.name + ' tip';
        guides.add(tip);
      }
    }
    const count = paths.reduce((n, p) => n + p.comets, 0);
    heads = pointsOf(count, headMaterial);
    tails = pointsOf(count * TAIL, tailMaterial);
    heads.name = 'heat comets';
    comets.add(tails, heads);
    // Catchers: one glow per divertor plate, as bright as the power it catches.
    const catcherPoints = pointsOf(shares.length, catcherMaterial);
    catcherPoints.name = 'catchers';
    const pos = catcherPoints.geometry.getAttribute('position');
    const col = catcherPoints.geometry.getAttribute('color');
    shares.forEach((share, k) => {
      const p = plateAt(model, k);
      pos.setXYZ(k, p.x, p.y, p.z);
      const b = most > MIN_MW ? 0.15 + 0.6 * (share / most) : 0;
      col.setXYZ(k, warm.r * b, warm.g * b, warm.b * b);
    });
    catchers.add(catcherPoints);
  };

  /** Comet positions at simulation time t: each runs its path in PULSE_SECONDS, evenly spaced, its tail fading. */
  const move = (t: number) => {
    if (!heads || !tails) return;
    const hp = heads.geometry.getAttribute('position');
    const hc = heads.geometry.getAttribute('color');
    const tp = tails.geometry.getAttribute('position');
    const tc = tails.geometry.getAttribute('color');
    const v = new three.Vector3();
    let c = 0;
    for (const path of paths) {
      const bright = 0.55 + 0.45 * path.weight;
      for (let i = 0; i < path.comets; i++, c++) {
        const s = (t / PULSE_SECONDS + i / path.comets) % 1;
        // Fade in at the start and out at the end, so comets appear and land softly.
        const fade = Math.min(1, s / 0.08, (1 - s) / 0.08);
        path.curve.getPointAt(s, v);
        hp.setXYZ(c, v.x, v.y, v.z);
        hc.setXYZ(c, hot.r * bright * fade, hot.g * bright * fade, hot.b * bright * fade);
        for (let k = 0; k < TAIL; k++) {
          const sk = s - (k + 1) * TAIL_STEP;
          const f = sk < 0 ? 0 : fade * bright * (1 - (k + 1) / (TAIL + 1)) ** 1.6;
          path.curve.getPointAt(Math.max(0, sk), v);
          tp.setXYZ(c * TAIL + k, v.x, v.y, v.z);
          tc.setXYZ(c * TAIL + k, warm.r * f, warm.g * f, warm.b * f);
        }
      }
    }
    hp.needsUpdate = hc.needsUpdate = tp.needsUpdate = tc.needsUpdate = true;
  };

  return {
    group,
    guides,
    comets,
    catchers,
    /** The paths drawn now (for the key and the tests). */
    paths: () => paths,
    /** Head position (world) of comet `i` on path `p`. */
    head(p: number, i: number) {
      const before = paths.slice(0, p).reduce((n, q) => n + q.comets, 0);
      const pos = heads!.geometry.getAttribute('position');
      return new three.Vector3(pos.getX(before + i), pos.getY(before + i), pos.getZ(before + i));
    },
    update(sim: Simulation, visible: boolean) {
      group.visible = visible;
      if (!visible) return;
      const shares = sim.model.edge(sim.state.n, sim.coils).shares;
      const flows = largestFlows(powerTransfer(sim.model, sim.state.n, sim.coils), MIN_MW);
      // Rebuild only when a share moves by 0.1 MW or a transfer by 0.05 MW (the heating modulation moves them a little).
      const next = Array.from(shares, (s) => Math.round(10 * s)).join(',') + '|' + flows.map(([a, b, v]) => `${a}>${b}:${Math.round(20 * v)}`).join(',');
      if (next !== key) {
        key = next;
        rebuild(sim, shares);
      }
      move(sim.time);
    },
  };
}
