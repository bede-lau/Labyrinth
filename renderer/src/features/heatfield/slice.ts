// Pure layout and read-outs for the cross-section panel (H10, H11): the poloidal slice at grid plane j, drawn
// from the artifact's surfaces in true R–Z proportions, one SVG cell per (surface ring m, θ index i).
import type { HeatfieldArtifact } from './types';
import { sampleRZ } from './scene';

export interface Tick {
  value: number;
  pos: number;
}

export interface SliceCell {
  /** Ring between surfaces m and m + 1. */
  m: number;
  i: number;
  d: string;
  /** Centre of the cell (mean of its four corners), in viewBox units: where a keyboard read-out points. */
  cx: number;
  cy: number;
}

export interface SliceLayout {
  width: number;
  height: number;
  plot: { x0: number; y0: number; x1: number; y1: number };
  /** Pixels per metre, the same on both axes and for every plane (slices compare at one scale). */
  scale: number;
  cells: SliceCell[];
  lcfsPath: string;
  axis: { x: number; y: number };
  xTicks: Tick[];
  yTicks: Tick[];
  /**
   * The LCFS edge strip (DZ3-3): one band cell per θ cell i (between LCFS nodes i and i + 1), EDGE_STRIP.gap to
   * EDGE_STRIP.gap + EDGE_STRIP.width viewBox units outside the LCFS outline. It is coloured by the LCFS temperature on
   * the 3D surface's scale: the plane's upstream temperature (version 7; the cold targets are the plates).
   */
  edge: { i: number; d: string }[];
  /** The strip's inner and outer boundary (two closed sub-paths), drawn in the outline colour round the fill. */
  edgeOutline: string;
  /** The diverter plate at this plane, if the slice is at a diverter angle (drawn just outside the edge strip, over
   * the strip cells of its θ span). */
  plate: { id: string; label: string; path: string; labelAt: { x: number; y: number }; anchor: 'start' | 'middle' | 'end' } | null;
}

export const SLICE_BOX = { width: 360, height: 330, padLeft: 50, padBottom: 40, pad: 12 };
/** The edge strip (viewBox units ≈ px at full size): a gap outside the LCFS outline, then the band (DZ3-3). */
export const EDGE_STRIP = { gap: 2.5, width: 8 };
/** The plate's centre line, outside the strip (viewBox units): strip, 2 units, then half the plate's 9-unit rim. */
export const PLATE_OFFSET_PX = EDGE_STRIP.gap + EDGE_STRIP.width + 2 + 4.5;

/** "Nice" tick step (1, 2, 2.5 or 5 × 10^k) for roughly `target` ticks. */
export function niceStep(span: number, target = 4): number {
  const raw = span / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * mag;
}

function ticks(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.abs(v) < 1e-12 ? 0 : v);
  return out;
}

/** Diverter whose plane is grid plane j (φ_k on the grid), or null. */
export function diverterAtPlane(art: HeatfieldArtifact, j: number): HeatfieldArtifact['diverters']['items'][number] | null {
  const nPhi = art.grid.nPhi;
  const dPhi = (2 * Math.PI) / nPhi;
  return art.diverters.items.find((d) => ((Math.round(d.phi / dPhi) % nPhi) + nPhi) % nPhi === j) ?? null;
}

/** Grid plane of every diverter (nearest plane to φ_k). */
export function diverterPlanes(art: HeatfieldArtifact): number[] {
  const nPhi = art.grid.nPhi;
  const dPhi = (2 * Math.PI) / nPhi;
  return art.diverters.items.map((d) => ((Math.round(d.phi / dPhi) % nPhi) + nPhi) % nPhi);
}

/** The largest R and Z extent of any plane's LCFS: one scale for every slice. */
function maxSpans(art: HeatfieldArtifact): { R: number; Z: number } {
  const { nTheta, nPhi } = art.grid;
  const s = art.surfaces[art.surfaces.length - 1]!;
  let spanR = 0;
  let spanZ = 0;
  for (let j = 0; j < nPhi; j++) {
    const R = s.R.slice(j * nTheta, (j + 1) * nTheta);
    const Z = s.Z.slice(j * nTheta, (j + 1) * nTheta);
    spanR = Math.max(spanR, Math.max(...R) - Math.min(...R));
    spanZ = Math.max(spanZ, Math.max(...Z) - Math.min(...Z));
  }
  return { R: spanR, Z: spanZ };
}

const spanCache = new WeakMap<HeatfieldArtifact, { R: number; Z: number }>();

export function sliceLayout(art: HeatfieldArtifact, j: number, box = SLICE_BOX): SliceLayout {
  const { nTheta, nPhi } = art.grid;
  const surfaces = art.surfaces;
  const lcfs = surfaces[surfaces.length - 1]!;
  let spans = spanCache.get(art);
  if (!spans) {
    spans = maxSpans(art);
    spanCache.set(art, spans);
  }
  const plot = { x0: box.padLeft, y0: box.pad, x1: box.width - box.pad, y1: box.height - box.padBottom };
  const w = plot.x1 - plot.x0;
  const h = plot.y1 - plot.y0;
  // Room round the LCFS for the edge strip and a plate outside it (about 20 viewBox units).
  const margin = 0.1;
  const scale = Math.min(w / (spans.R * (1 + 2 * margin)), h / (spans.Z * (1 + 2 * margin)));
  const at = (m: number, i: number) => {
    const c = j * nTheta + (((i % nTheta) + nTheta) % nTheta);
    return [surfaces[m]!.R[c]!, surfaces[m]!.Z[c]!] as const;
  };
  const Rs = lcfs.R.slice(j * nTheta, (j + 1) * nTheta);
  const Zs = lcfs.Z.slice(j * nTheta, (j + 1) * nTheta);
  const rMid = (Math.min(...Rs) + Math.max(...Rs)) / 2;
  const zMid = (Math.min(...Zs) + Math.max(...Zs)) / 2;
  const cx = plot.x0 + w / 2;
  const cy = plot.y0 + h / 2;
  const X = (R: number) => cx + (R - rMid) * scale;
  const Y = (Z: number) => cy - (Z - zMid) * scale;
  const pt = (R: number, Z: number) => `${X(R).toFixed(2)},${Y(Z).toFixed(2)}`;

  const cells: SliceCell[] = [];
  for (let m = 0; m < surfaces.length - 1; m++) {
    for (let i = 0; i < nTheta; i++) {
      const a = at(m, i);
      const b = at(m, i + 1);
      const c = at(m + 1, i + 1);
      const d = at(m + 1, i);
      cells.push({
        m,
        i,
        d: `M${pt(...a)} L${pt(...b)} L${pt(...c)} L${pt(...d)} Z`,
        cx: X((a[0] + b[0] + c[0] + d[0]) / 4),
        cy: Y((a[1] + b[1] + c[1] + d[1]) / 4),
      });
    }
  }
  const lcfsPath = Array.from({ length: nTheta }, (_, i) => `${i === 0 ? 'M' : 'L'}${pt(...at(surfaces.length - 1, i))}`).join(' ') + ' Z';
  const [Ra, Za] = at(0, 0);

  // The LCFS outline in viewBox units, and its outward normals (the polygon's winding decides which side is out).
  const Q = Array.from({ length: nTheta }, (_, i) => {
    const [R, Z] = at(surfaces.length - 1, i);
    return [X(R), Y(Z)] as const;
  });
  let area = 0;
  for (let i = 0; i < nTheta; i++) {
    const a = Q[i]!;
    const b = Q[(i + 1) % nTheta]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  const out = Math.sign(area) || 1;
  /** Outward unit normal of a direction of travel along increasing θ. */
  const normalOf = (tx: number, ty: number): [number, number] => {
    const len = Math.hypot(tx, ty) || 1;
    return [(out * ty) / len, (-out * tx) / len];
  };
  const edgeNormal = (i: number) => {
    const a = Q[((i % nTheta) + nTheta) % nTheta]!;
    const b = Q[(((i + 1) % nTheta) + nTheta) % nTheta]!;
    return normalOf(b[0] - a[0], b[1] - a[1]);
  };
  const nodeNormal = (i: number) => {
    const [ax, ay] = edgeNormal(i - 1);
    const [bx, by] = edgeNormal(i);
    const len = Math.hypot(ax + bx, ay + by) || 1;
    return [(ax + bx) / len, (ay + by) / len] as const;
  };
  const off = (i: number, d: number) => {
    const q = Q[i % nTheta]!;
    const n = nodeNormal(i % nTheta);
    return `${(q[0] + n[0] * d).toFixed(2)},${(q[1] + n[1] * d).toFixed(2)}`;
  };
  const g0 = EDGE_STRIP.gap;
  const g1 = EDGE_STRIP.gap + EDGE_STRIP.width;
  const edge = Array.from({ length: nTheta }, (_, i) => ({ i, d: `M${off(i, g0)} L${off(i + 1, g0)} L${off(i + 1, g1)} L${off(i, g1)} Z` }));
  const ring = (d: number) => Array.from({ length: nTheta }, (_, i) => `${i === 0 ? 'M' : 'L'}${off(i, d)}`).join(' ') + ' Z';
  const edgeOutline = `${ring(g0)} ${ring(g1)}`;

  let plate: SliceLayout['plate'] = null;
  const div = diverterAtPlane(art, j);
  if (div) {
    const phi = (2 * Math.PI * j) / nPhi;
    const hw = art.diverters.halfWidthTheta;
    const n = 9;
    const screenAt = (theta: number) => {
      const [R, Z] = sampleRZ(lcfs, nTheta, nPhi, theta, phi);
      return [X(R), Y(Z)] as const;
    };
    const dTheta = (2 * Math.PI) / nTheta / 4;
    /** The LCFS point at θ pushed `d` units outward along its normal (in viewBox units). */
    const outAt = (theta: number, d: number): [number, number] => {
      const q = screenAt(theta);
      const a = screenAt(theta - dTheta);
      const b = screenAt(theta + dTheta);
      const [nx, ny] = normalOf(b[0] - a[0], b[1] - a[1]);
      return [q[0] + nx * d, q[1] + ny * d];
    };
    const thetas = Array.from({ length: n }, (_, s) => art.diverters.thetaCentre - hw + (2 * hw * s) / (n - 1));
    // Just outside the edge strip, so the strip cells under the plate's θ span stay in view beside it.
    const pts = thetas.map((t) => outAt(t, PLATE_OFFSET_PX));
    // The label outside the plate, along the plate's own outward normal; when that leaves the frame (a plate at its
    // edge), beside the plate's end that is further left, so the label never covers the plate.
    const [ox, oy] = outAt(art.diverters.thetaCentre, PLATE_OFFSET_PX + 16);
    const inside = ox >= plot.x0 + 14 && ox <= plot.x1 - 14 && oy >= plot.y0 + 14 && oy <= plot.y1 - 6;
    const first = pts[0]!;
    const last = pts[n - 1]!;
    const side = first[0] < last[0] ? first : last;
    plate = {
      id: div.id,
      label: div.label,
      path: pts.map((p, s) => `${s === 0 ? 'M' : 'L'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' '),
      labelAt: inside ? { x: ox, y: oy + 4 } : { x: side[0] - 8, y: Math.max(plot.y0 + 14, side[1] + 4) },
      anchor: inside ? 'middle' : 'end',
    };
  }

  const rLo = rMid - w / 2 / scale;
  const rHi = rMid + w / 2 / scale;
  const zLo = zMid - h / 2 / scale;
  const zHi = zMid + h / 2 / scale;
  const step = niceStep(Math.min(rHi - rLo, zHi - zLo), 4);
  return {
    width: box.width,
    height: box.height,
    plot,
    scale,
    cells,
    edge,
    edgeOutline,
    lcfsPath,
    axis: { x: X(Ra), y: Y(Za) },
    xTicks: ticks(rLo, rHi, step).map((value) => ({ value, pos: X(value) })),
    yTicks: ticks(zLo, zHi, step).map((value) => ({ value, pos: Y(value) })),
    plate,
  };
}

/** Mean of a cell's four corner values (surfaces m, m+1 × θ indices i, i+1); values at m·nTheta + i. */
export function cellMean(values: Float64Array, m: number, i: number, nTheta: number): number {
  const i1 = (i + 1) % nTheta;
  return (values[m * nTheta + i]! + values[m * nTheta + i1]! + values[(m + 1) * nTheta + i]! + values[(m + 1) * nTheta + i1]!) / 4;
}

export interface Extreme {
  value: number;
  rho: number;
  thetaDeg: number;
}

/** Smallest and largest value over the slice's grid nodes, and where they are. */
export function sliceExtremes(values: Float64Array, rho: Float64Array, nTheta: number): { min: Extreme; max: Extreme } {
  let lo = 0;
  let hi = 0;
  for (let x = 1; x < values.length; x++) {
    if (values[x]! < values[lo]!) lo = x;
    if (values[x]! > values[hi]!) hi = x;
  }
  const at = (x: number): Extreme => ({ value: values[x]!, rho: rho[Math.floor(x / nTheta)]!, thetaDeg: ((x % nTheta) * 360) / nTheta });
  return { min: at(lo), max: at(hi) };
}
