// 3D arrows for the power the coils move between divertors (D-039). They run round the torus just outside the
// outboard edge, from the divertor that sheds power to each one that takes it up, as thick as the MW moved. Schematic in
// path (the power goes through the scrape-off layer, not along this line), exact in amount (transfer.ts).
import { plasmaMaterials } from '../../design/tokens';
import type { Simulation } from '../heatfield/sim';
import { largestFlows, powerTransfer } from '../heatfield/transfer';
import type { HeatfieldArtifact } from '../heatfield/types';

type Three = typeof import('three');

/** Flows below this are not drawn (MW). */
const MIN_MW = 0.005;
/** Arrow tube radius for the largest flow (m); smaller flows scale down from here. */
const MAX_RADIUS = 0.06;
/** Seconds of simulation time for a pulse to run the length of its arrow. */
export const PULSE_SECONDS = 0.8;

export function buildFlowArrows(three: Three, art: HeatfieldArtifact) {
  const { nTheta, nPhi } = art.grid;
  const lcfs = art.surfaces[art.surfaces.length - 1]!;
  // A ring 0.35 m outside the LCFS's outboard edge, at the height of that edge, one point per φ plane.
  const ring = Array.from({ length: nPhi }, (_, j) => {
    let best = 0;
    for (let i = 1; i < nTheta; i++) if (lcfs.R[j * nTheta + i]! > lcfs.R[j * nTheta + best]!) best = i;
    const r = lcfs.R[j * nTheta + best]! + 0.35;
    const phi = (2 * Math.PI * j) / nPhi;
    return new three.Vector3(r * Math.cos(phi), r * Math.sin(phi), lcfs.Z[j * nTheta + best]!);
  });
  const material = new three.MeshBasicMaterial({ color: plasmaMaterials.powerFlow, transparent: true, opacity: 0.9, depthWrite: false });
  // Pulses: bright beads running along each arrow, from the divertor that sheds power to the one that takes it up, so
  // the direction reads at a glance; more beads for a larger flow.
  const pulseMaterial = new three.MeshBasicMaterial({ color: plasmaMaterials.tracer, depthWrite: false });
  const group = new three.Group();
  group.name = 'Power moved between divertors';
  const arrows = new three.Group();
  const pulses = new three.Group();
  group.add(arrows, pulses);
  group.renderOrder = 3;
  let tracks: { curve: import('three').CatmullRomCurve3; beads: import('three').Mesh[] }[] = [];
  const planeOf = (phi: number) => Math.round((((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / ((2 * Math.PI) / nPhi)) % nPhi;
  let key = '';

  /** The arc of ring points from φ_a to φ_b the short way round, a little short of both plates. */
  const arc = (a: number, b: number) => {
    const ja = planeOf(a);
    const jb = planeOf(b);
    let d = jb - ja;
    if (d > nPhi / 2) d -= nPhi;
    if (d < -nPhi / 2) d += nPhi;
    const s = Math.sign(d);
    const gap = Math.max(1, Math.round(nPhi / 72));
    const pts = [];
    for (let i = gap; i <= Math.abs(d) - gap; i++) pts.push(ring[(((ja + s * i) % nPhi) + nPhi) % nPhi]!);
    return pts;
  };

  const clear = () => {
    for (const holder of [arrows, pulses])
      for (const child of [...holder.children]) {
        holder.remove(child);
        (child as import('three').Mesh).geometry.dispose();
      }
    tracks = [];
  };
  /** Bead positions at simulation time t: each bead runs the whole arrow in PULSE_SECONDS, evenly spaced. */
  const move = (t: number) => {
    for (const { curve, beads } of tracks)
      beads.forEach((bead, i) => bead.position.copy(curve.getPointAt((t / PULSE_SECONDS + i / beads.length) % 1)));
  };

  return {
    group,
    arrows,
    pulses,
    update(sim: Simulation, visible: boolean) {
      group.visible = visible;
      if (!visible) return;
      const flows = largestFlows(powerTransfer(sim.model, sim.state.n, sim.coils), MIN_MW);
      // Rebuild only when a flow changes by a 0.05 MW step (the heating modulation moves them a little every frame).
      const next = flows.map(([a, b, v]) => `${a}>${b}:${Math.round(20 * v)}`).join(',');
      if (next === key) {
        move(sim.time);
        return;
      }
      key = next;
      clear();
      const widest = flows.length ? flows[0]![2] : 1;
      // Arrows to the same receiver leave from one loser at a time; offsets in height keep parallel arcs apart.
      flows.forEach(([a, b, v], index) => {
        const pts = arc(sim.model.phiK[a]!, sim.model.phiK[b]!).map((p) => p.clone().setZ(p.z + 0.12 * index));
        if (pts.length < 2) return;
        const radius = MAX_RADIUS * (0.3 + 0.7 * (v / widest));
        const curve = new three.CatmullRomCurve3(pts);
        const shaft = new three.Mesh(new three.TubeGeometry(curve, 4 * pts.length, radius, 8, false), material);
        const head = new three.Mesh(new three.ConeGeometry(2.4 * radius, 7 * radius, 12), material);
        const end = curve.getPoint(1);
        const tangent = curve.getTangent(1);
        head.position.copy(end).addScaledVector(tangent, 3.5 * radius);
        head.quaternion.setFromUnitVectors(new three.Vector3(0, 1, 0), tangent);
        shaft.name = `D${a + 1} to D${b + 1}`;
        arrows.add(shaft, head);
        const beads = Array.from({ length: 2 + Math.round(4 * (v / widest)) }, () => {
          const bead = new three.Mesh(new three.SphereGeometry(1.8 * radius, 10, 8), pulseMaterial);
          pulses.add(bead);
          return bead;
        });
        tracks.push({ curve, beads });
      });
      move(sim.time);
    },
  };
}
