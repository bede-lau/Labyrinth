// Pure layout for the ring diagram: toroidal planes on a circle, rank arcs, exchange arrows.
import type { SpatialArtifact } from './types';

export interface RingNode {
  plane: number;
  rank: number;
  device: string;
  angle: number;
  x: number;
  y: number;
}

export interface RingArrow {
  fromRank: number;
  toRank: number;
  fromPlane: number;
  toPlane: number;
  /** SVG path (arc) with the arrowhead at its end. */
  d: string;
  /** Outer track for rank 0 -> 1, inner track for 1 -> 0, so the two directions never overlap. */
  track: 'outer' | 'inner';
  /** Where to place the label of this boundary. */
  labelX: number;
  labelY: number;
}

export interface RingArc {
  rank: number;
  device: string;
  planes: number[];
  d: string;
  labelX: number;
  labelY: number;
  anchor: 'start' | 'middle' | 'end';
}

export interface RingLayout {
  width: number;
  height: number;
  cx: number;
  cy: number;
  r: number;
  nodeR: number;
  nodes: RingNode[];
  arcs: RingArc[];
  arrows: RingArrow[];
  /** Spokes from the CPU field-solve node to each rank arc. */
  spokes: { rank: number; x1: number; y1: number; x2: number; y2: number }[];
}

const TAU = Math.PI * 2;

/**
 * Plane k (1-based) runs clockwise from just right of the top, so the periodic n -> 1 boundary sits
 * at the top and (for two equal ranks) the other boundary at the bottom: one rank per half.
 */
export function planeAngle(plane: number, n: number): number {
  return -Math.PI / 2 + ((plane - 0.5) * TAU) / n;
}

/** Signed shortest angular step from a to b, in (-π, π]. */
export function shortestDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d <= -Math.PI) d += TAU;
  if (d > Math.PI) d -= TAU;
  return d;
}

const pt = (cx: number, cy: number, r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
const f = (v: number) => v.toFixed(2);

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = pt(cx, cy, r, a0);
  const [x1, y1] = pt(cx, cy, r, a1);
  const delta = a1 - a0;
  const large = Math.abs(delta) > Math.PI ? 1 : 0;
  const sweep = delta > 0 ? 1 : 0; // SVG y points down: increasing angle is clockwise = sweep 1
  return `M${f(x0)},${f(y0)} A${f(r)},${f(r)} 0 ${large} ${sweep} ${f(x1)},${f(y1)}`;
}

export function ringLayout(a: SpatialArtifact, size = { width: 640, height: 420 }): RingLayout {
  const { width, height } = size;
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.3;
  const nodeR = 20;
  const n = a.nPlanes;
  const rankOf = new Map<number, { rank: number; device: string }>();
  for (const rk of a.ranks) for (const p of rk.planes) rankOf.set(p, { rank: rk.rank, device: rk.device });

  const nodes: RingNode[] = Array.from({ length: n }, (_, i) => {
    const plane = i + 1;
    const angle = planeAngle(plane, n);
    const [x, y] = pt(cx, cy, r, angle);
    const owner = rankOf.get(plane);
    return { plane, rank: owner?.rank ?? -1, device: owner?.device ?? 'unassigned', angle, x, y };
  });

  const step = TAU / n;
  const arcs: RingArc[] = a.ranks.map((rk) => {
    const sorted = [...rk.planes].sort((p, q) => p - q);
    const a0 = planeAngle(sorted[0]!, n) - step * 0.38;
    const a1 = planeAngle(sorted[sorted.length - 1]!, n) + step * 0.38;
    const mid = (a0 + a1) / 2;
    const [lx, ly] = pt(cx, cy, r + 78, mid);
    const c = Math.cos(mid);
    return {
      rank: rk.rank,
      device: rk.device,
      planes: sorted,
      d: arcPath(cx, cy, r, a0, a1),
      labelX: lx,
      labelY: ly,
      anchor: c > 0.2 ? 'start' : c < -0.2 ? 'end' : 'middle',
    };
  });

  const arrows: RingArrow[] = a.exchanges.map((e) => {
    const [fromPlane, toPlane] = e.planes as [number, number];
    const track = e.fromRank < e.toRank ? 'outer' : 'inner';
    const tr = track === 'outer' ? r + 34 : r - 34;
    const pad = (nodeR * 0.55) / tr;
    const a0 = planeAngle(fromPlane, n);
    const d = shortestDelta(a0, planeAngle(toPlane, n));
    const s = Math.sign(d);
    const [lx, ly] = pt(cx, cy, r + 58, a0 + d / 2);
    return {
      fromRank: e.fromRank,
      toRank: e.toRank,
      fromPlane,
      toPlane,
      d: arcPath(cx, cy, tr, a0 + s * pad, a0 + d - s * pad),
      track,
      labelX: lx,
      labelY: ly,
    };
  });

  const spokes = arcs.map((arc) => {
    const mid = (planeAngle(arc.planes[0]!, n) + planeAngle(arc.planes[arc.planes.length - 1]!, n)) / 2;
    const [x1, y1] = pt(cx, cy, 44, mid);
    const [x2, y2] = pt(cx, cy, r - 50, mid);
    return { rank: arc.rank, x1, y1, x2, y2 };
  });

  return { width, height, cx, cy, r, nodeR, nodes, arcs, arrows, spokes };
}

/** "1–3" for contiguous planes, else "1, 3, 5". */
export function planeRange(planes: readonly number[]): string {
  const s = [...planes].sort((p, q) => p - q);
  const contiguous = s.every((p, i) => i === 0 || p === s[i - 1]! + 1);
  return contiguous && s.length > 1 ? `${s[0]}–${s[s.length - 1]}` : s.join(', ');
}
