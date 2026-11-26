// Pure data -> geometry/colour logic for the Heat & field 3D scene. No three here (HeatScene.tsx is the thin
// adapter), so jsdom tests it directly. Built once per artifact: the LCFS mesh, the diverter plates, the field
// lines, the heat-flow arrow grid and the camera orbit. Per frame only colours and arrow tips change.
import { fieldColor, heatColor, type ThemeName } from '../../design';
import type { HeatModel } from './model';
import type { HeatfieldArtifact, HeatSurface } from './types';

export type ColorBy = 'temperature' | 'field';

// Drawing constants (metres / radians). They place things on screen only; no model number depends on them.
/** Diverter plate: half extent in φ (rad) and lift off the LCFS (m); the edge plate is larger and sits under it. */
export const PLATE = { halfWidthPhi: 0.05, lift: 0.05, edgeLift: 0.035, edgeMarginTheta: 0.05, edgeMarginPhi: 0.025, samples: 9 };
/** Field lines are drawn this far outside the LCFS (m) so the surface does not swallow them. */
export const LINE_LIFT = 0.012;
export const LINE_RADIUS = 0.011;
/**
 * Heat-flow arrows: grid stride in θ and φ, lift (m), length of the longest arrow at the start (m), the head's length
 * as a fraction of the arrow and its half-angle (rad).
 */
export const ARROWS = { strideTheta: 4, stridePhi: 2, lift: 0.015, refLength: 0.3, maxFactor: 1.5, head: 0.4, headAngle: 0.5 };
/**
 * How the arrows are drawn (DZ3-2), in screen pixels on the far side of the torus (nearer, they are wider): a core in
 * color.text at least `corePx` wide over a halo in the scene background `padPx` wider on each side, as the D1–D4
 * leader lines and the slice cursor are drawn. The head is at least `headMinPx` wide on an arrow at least that long;
 * a shorter arrow's head and halo shrink with its length (DZ4-2, arrowMeshes).
 */
export const ARROW_MARK = { corePx: 1.5, padPx: 1.5, headMinPx: 5 };
/**
 * The cross-section slice on the 3D surface (DZ3-1): a closed tube round grid plane j, a color.text core `corePx`
 * wide inside a scene-background halo `haloPx` wide (screen pixels on the far side of the torus), `radial` sides.
 */
export const SLICE_MARK = { corePx: 2, haloPx: 5, radial: 8 };
/** Colour look-up tables: entries per ramp. */
export const LUT_SIZE = 1024;

type Vec3 = [number, number, number];

const mod = (a: number, b: number) => ((a % b) + b) % b;

/** Vertex index of grid point (φ index j, θ index i), both periodic: c = j·nTheta + i (the artifact's layout). */
export function gridIndex(j: number, i: number, nPhi: number, nTheta: number): number {
  return mod(j, nPhi) * nTheta + mod(i, nTheta);
}

/** Two triangles per cell; no duplicated seam: the last row and column connect back to index 0 (a closed torus). */
export function surfaceTriangles(nPhi: number, nTheta: number): Uint32Array {
  const out = new Uint32Array(nPhi * nTheta * 6);
  let k = 0;
  for (let j = 0; j < nPhi; j++) {
    for (let i = 0; i < nTheta; i++) {
      const a = gridIndex(j, i, nPhi, nTheta);
      const b = gridIndex(j + 1, i, nPhi, nTheta);
      const c = gridIndex(j + 1, i + 1, nPhi, nTheta);
      const d = gridIndex(j, i + 1, nPhi, nTheta);
      out.set([a, b, c, a, c, d], k);
      k += 6;
    }
  }
  return out;
}

/** x = R cos φ, y = R sin φ, z = Z (the artifact's geometric toroidal angle). */
export function toXYZ(R: number, Z: number, phi: number): Vec3 {
  return [R * Math.cos(phi), R * Math.sin(phi), Z];
}

/** Periodic bilinear sample of a surface's R and Z at continuous (θ, φ). */
export function sampleRZ(s: HeatSurface, nTheta: number, nPhi: number, theta: number, phi: number): [number, number] {
  const u = mod(theta / ((2 * Math.PI) / nTheta), nTheta);
  const v = mod(phi / ((2 * Math.PI) / nPhi), nPhi);
  const i0 = Math.floor(u);
  const j0 = Math.floor(v);
  const fu = u - i0;
  const fv = v - j0;
  const at = (arr: number[], j: number, i: number) => arr[gridIndex(j, i, nPhi, nTheta)]!;
  const lerp2 = (arr: number[]) =>
    (1 - fv) * ((1 - fu) * at(arr, j0, i0) + fu * at(arr, j0, i0 + 1)) + fv * ((1 - fu) * at(arr, j0 + 1, i0) + fu * at(arr, j0 + 1, i0 + 1));
  return [lerp2(s.R), lerp2(s.Z)];
}

/** Unit vector away from the magnetic axis in the poloidal plane of φ (the outward direction for lifting marks). */
function outward(axis: HeatSurface, nTheta: number, nPhi: number, R: number, Z: number, phi: number): Vec3 {
  const [Ra, Za] = sampleRZ(axis, nTheta, nPhi, 0, phi);
  const dR = R - Ra;
  const dZ = Z - Za;
  const len = Math.hypot(dR, dZ) || 1;
  return [(dR / len) * Math.cos(phi), (dR / len) * Math.sin(phi), dZ / len];
}

/** A point of a surface at (θ, φ), lifted `lift` metres outward. */
function liftedPoint(art: HeatfieldArtifact, surface: HeatSurface, theta: number, phi: number, lift: number): Vec3 {
  const { nTheta, nPhi } = art.grid;
  const [R, Z] = sampleRZ(surface, nTheta, nPhi, theta, phi);
  const p = toXYZ(R, Z, phi);
  const n = outward(art.surfaces[0]!, nTheta, nPhi, R, Z, phi);
  return [p[0] + lift * n[0], p[1] + lift * n[1], p[2] + lift * n[2]];
}

export interface PlateMesh {
  positions: Float32Array;
  index: Uint16Array;
}

export interface PlateGeometry {
  id: string;
  label: string;
  phi: number;
  /** The near-black plate, θ_d ± halfWidthTheta (artifact) by ± PLATE.halfWidthPhi. */
  fill: PlateMesh;
  /** The edge-coloured rim: a slightly larger plate under the fill. */
  edge: PlateMesh;
  /** Middle of the fill's end with the larger major radius R: where the label's leader line starts. */
  outerEnd: Vec3;
  /** Where its "D1"… label is pinned: LABEL.offset beyond `outerEnd` along the major radius (never on the plate). */
  anchor: Vec3;
}

/**
 * The D1…D4 labels of the 3D view (DZ-2): pinned beyond each plate's outer end, `offset` metres further out along
 * the major radius (cos φ, sin φ, 0), with a leader line back to the plate. The label box (`width` × `height` px;
 * HeatScene writes these sizes onto the label, so this is the one source of them, HF3-4) is then pushed along the
 * same screen direction until it clears the plate's projected bounding box by `clearance` px, so the black plate it
 * names is never covered, at any size or orbit.
 */
export const LABEL = { offset: 0.25, width: 28, height: 20, gap: 3, clearance: 3 };
/** The "Slice φ 45°" label of the 3D view (DZ3-1): placed like the D1–D4 labels, a wider box for its text. */
export const SLICE_LABEL = { offset: 0.25, width: 92, height: 20 };

function plateMesh(art: HeatfieldArtifact, phi: number, halfTheta: number, halfPhi: number, lift: number): PlateMesh {
  const lcfs = art.surfaces[art.surfaces.length - 1]!;
  const n = PLATE.samples;
  const positions = new Float32Array(n * 2 * 3);
  for (let s = 0; s < n; s++) {
    const theta = art.diverters.thetaCentre - halfTheta + (2 * halfTheta * s) / (n - 1);
    [phi - halfPhi, phi + halfPhi].forEach((ph, side) => positions.set(liftedPoint(art, lcfs, theta, ph, lift), (s * 2 + side) * 3));
  }
  const index = new Uint16Array((n - 1) * 6);
  for (let s = 0; s < n - 1; s++) {
    const a = s * 2;
    index.set([a, a + 1, a + 3, a, a + 3, a + 2], s * 6);
  }
  return { positions, index };
}

/** Middle of a plate mesh's first and last row (its two ends along θ). */
function plateEnds(m: PlateMesh): [Vec3, Vec3] {
  const p = m.positions;
  const mid = (row: number): Vec3 => {
    const a = row * 6;
    return [(p[a]! + p[a + 3]!) / 2, (p[a + 1]! + p[a + 4]!) / 2, (p[a + 2]! + p[a + 5]!) / 2];
  };
  return [mid(0), mid(p.length / 6 - 1)];
}

/** The four schematic diverter plates at the artifact's φ_k, spanning θ_d ± halfWidthTheta. */
export function diverterPlates(art: HeatfieldArtifact): PlateGeometry[] {
  const hw = art.diverters.halfWidthTheta;
  return art.diverters.items.map((d) => {
    const fill = plateMesh(art, d.phi, hw, PLATE.halfWidthPhi, PLATE.lift);
    const [a, b] = plateEnds(fill);
    const outerEnd = Math.hypot(a[0], a[1]) >= Math.hypot(b[0], b[1]) ? a : b;
    const anchor: Vec3 = [outerEnd[0] + LABEL.offset * Math.cos(d.phi), outerEnd[1] + LABEL.offset * Math.sin(d.phi), outerEnd[2]];
    return {
      id: d.id,
      label: d.label,
      phi: d.phi,
      fill,
      edge: plateMesh(art, d.phi, hw + PLATE.edgeMarginTheta, PLATE.halfWidthPhi + PLATE.edgeMarginPhi, PLATE.edgeLift),
      outerEnd,
      anchor,
    };
  });
}

/** A point on screen (px from the top left of the scene box); `inView` when it is in front of the camera and on screen. */
export interface ScreenPoint {
  x: number;
  y: number;
  inView: boolean;
}
export type Projector = (p: readonly [number, number, number]) => ScreenPoint;

export interface ScreenBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Screen bounding box of a list of xyz points. */
export function screenBox(positions: ArrayLike<number>, project: Projector): ScreenBox {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let v = 0; v < positions.length; v += 3) {
    const s = project([positions[v]!, positions[v + 1]!, positions[v + 2]!]);
    box.x0 = Math.min(box.x0, s.x);
    box.x1 = Math.max(box.x1, s.x);
    box.y0 = Math.min(box.y0, s.y);
    box.y1 = Math.max(box.y1, s.y);
  }
  return box;
}

export interface LabelPlacement {
  visible: boolean;
  /** The label box lies inside the scene box it was placed in (always true when no scene box was given). */
  fits: boolean;
  /** Centre of the label box (px). */
  x: number;
  y: number;
  /** The label box (px). */
  box: ScreenBox;
  /** Leader line from the plate's outer end to the edge of the label box (px): [x1, y1, x2, y2]. */
  leader: [number, number, number, number];
  /** Screen bounding box of the plate as drawn (fill and rim). */
  plate: ScreenBox;
}

/** What a label names in the 3D view: the shapes it must not cover (xyz lists), the point its leader starts from and
 * the point it is pinned beyond. */
export interface LabelTarget {
  shapes: ArrayLike<number>[];
  end: readonly [number, number, number];
  anchor: readonly [number, number, number];
}

const overlapsBox = (a: ScreenBox, b: ScreenBox, margin = 0) => a.x0 < b.x1 + margin && b.x0 - margin < a.x1 && a.y0 < b.y1 + margin && b.y0 - margin < a.y1;

/**
 * Where a plate's label goes on screen: beyond its anchor along the screen direction from the plate's outer end to
 * the anchor (outward along the major radius), far enough that the label box clears the plate's projected bounding
 * box (DZ-2). Pure: HeatScene passes a projector built from its camera, the tests one built from the same camera.
 */
export function placePlateLabel(plate: PlateGeometry, project: Projector, size = { width: LABEL.width, height: LABEL.height }): LabelPlacement {
  // The plate as drawn: the black fill and the light rim round it.
  return placeLabel({ shapes: [plate.fill.positions, plate.edge.positions], end: plate.outerEnd, anchor: plate.anchor }, project, size);
}

/** The scene box labels must stay inside (px, from the top left). */
export interface Viewport {
  width: number;
  height: number;
}

/** Turns (degrees) tried, nearest first, when the label does not fit in the scene box along its own direction (DZ4-1). */
const LABEL_TURNS = [30, 60, 90, 120, 150, 180];

/**
 * placePlateLabel for any target: beyond the anchor along the screen direction end → anchor, clear of the target's
 * shapes, and then pushed further along that direction past any `obstacles` (other labels, other plates) it would
 * cover. With a `view`, a box that would leave the scene box is tried again along that direction turned in 30° steps
 * (towards the middle of the view first), with the same clearances, and the first that fits is kept (DZ4-1: "Slice φ
 * 0°" ran off a phone's scene). Only when no direction fits is the box clamped into the view. The leader always runs
 * from the target's end to the edge of the box, towards its centre.
 */
export function placeLabel(
  target: LabelTarget,
  project: Projector,
  size: { width: number; height: number },
  obstacles: readonly ScreenBox[] = [],
  view?: Viewport,
): LabelPlacement {
  const boxes = target.shapes.map((s) => screenBox(s, project));
  const plateBox = {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
  const end = project(target.end);
  const anchor = project(target.anchor);
  let ux = anchor.x - end.x;
  let uy = anchor.y - end.y;
  let len = Math.hypot(ux, uy);
  if (len < 0.5) {
    // Looking straight along the major radius: away from the plate's middle on screen, or up.
    ux = anchor.x - (plateBox.x0 + plateBox.x1) / 2;
    uy = anchor.y - (plateBox.y0 + plateBox.y1) / 2;
    len = Math.hypot(ux, uy);
    if (len < 0.5) {
      ux = 0;
      uy = -1;
      len = 1;
    }
  }
  ux /= len;
  uy /= len;
  const hw = size.width / 2;
  const hh = size.height / 2;
  const tiny = 1e-9;
  const c = LABEL.clearance;
  // Distance from the box centre to its edge along (dx, dy).
  const edgeAlong = (dx: number, dy: number) => Math.min(Math.abs(dx) > tiny ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > tiny ? hh / Math.abs(dy) : Infinity);
  // Smallest push from the anchor along (dx, dy) at which the box is clear of `b` on one axis (it stays clear beyond it).
  const exitAlong = (b: ScreenBox, dx: number, dy: number) => {
    const e: number[] = [];
    if (dx > tiny) e.push((b.x1 + c + hw - anchor.x) / dx);
    if (dx < -tiny) e.push((b.x0 - c - hw - anchor.x) / dx);
    if (dy > tiny) e.push((b.y1 + c + hh - anchor.y) / dy);
    if (dy < -tiny) e.push((b.y0 - c - hh - anchor.y) / dy);
    return Math.min(...e);
  };
  /** Centre of the box pushed from the anchor along (dx, dy): clear of the target, then past every obstacle it covers. */
  const pushed = (dx: number, dy: number): [number, number] => {
    let s = Math.max(edgeAlong(dx, dy) + LABEL.gap, exitAlong(plateBox, dx, dy));
    const boxAt = (at: number): ScreenBox => ({ x0: anchor.x + dx * at - hw, y0: anchor.y + dy * at - hh, x1: anchor.x + dx * at + hw, y1: anchor.y + dy * at + hh });
    // One obstacle at a time (s only grows, so this ends).
    for (let pass = 0; pass <= obstacles.length; pass++) {
      let moved = false;
      for (const b of obstacles) {
        if (!overlapsBox(boxAt(s), b, c)) continue;
        const e = exitAlong(b, dx, dy);
        if (Number.isFinite(e) && e > s) {
          s = e;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return [anchor.x + dx * s, anchor.y + dy * s];
  };
  const inside = (cx: number, cy: number) => !view || (cx - hw >= 0 && cy - hh >= 0 && cx + hw <= view.width && cy + hh <= view.height);
  let [x, y] = pushed(ux, uy);
  let fits = inside(x, y);
  if (view && !fits) {
    // Turn towards the middle of the view first: the sign of u × (centre − anchor).
    const towards = ux * (view.height / 2 - anchor.y) - uy * (view.width / 2 - anchor.x) >= 0 ? 1 : -1;
    search: for (const deg of LABEL_TURNS) {
      for (const sign of deg === 180 ? [1] : [towards, -towards]) {
        const a = (sign * deg * Math.PI) / 180;
        const [cx, cy] = pushed(ux * Math.cos(a) - uy * Math.sin(a), ux * Math.sin(a) + uy * Math.cos(a));
        if (inside(cx, cy)) {
          [x, y] = [cx, cy];
          fits = true;
          break search;
        }
      }
    }
    if (!fits) {
      x = Math.min(Math.max(x, hw), Math.max(hw, view.width - hw));
      y = Math.min(Math.max(y, hh), Math.max(hh, view.height - hh));
    }
  }
  // The leader: from the target's end towards the box centre, stopping on the box edge.
  const lx = x - end.x;
  const ly = y - end.y;
  const ll = Math.hypot(lx, ly);
  const edge = ll > tiny ? edgeAlong(lx / ll, ly / ll) : 0;
  return {
    visible: anchor.inView && end.inView,
    fits,
    x,
    y,
    box: { x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh },
    leader: ll > tiny ? [end.x, end.y, x - (lx / ll) * edge, y - (ly / ll) * edge] : [end.x, end.y, x, y],
    plate: plateBox,
  };
}

/** The D1…D4 and slice labels of the 3D view, laid out together. */
export interface SceneLabels {
  plates: LabelPlacement[];
  slice: LabelPlacement | null;
}

/**
 * Every label of the 3D view, inside the scene box `view` (DZ4-1). Each D label goes beyond its plate (DZ-2), clear of
 * the other visible plates and of the D labels already placed; `hidden[k]` (plate k behind the torus, HF3-2) hides
 * label k. "Slice φ …" goes beyond the first of `sliceTargets` it fits the view from (DZ3-1), clear of every visible
 * D label and plate; when it fits from none, beyond the first (clamped into the view).
 */
export function layoutSceneLabels(
  plates: readonly PlateGeometry[],
  hidden: readonly boolean[],
  sliceTargets: readonly LabelTarget[],
  project: Projector,
  view: Viewport,
  plateLabel = LABEL,
): SceneLabels {
  const plateTargets: LabelTarget[] = plates.map((p) => ({ shapes: [p.fill.positions, p.edge.positions], end: p.outerEnd, anchor: p.anchor }));
  const plateBoxes = plateTargets.map((t) => {
    const b = t.shapes.map((s) => screenBox(s, project));
    return { x0: Math.min(...b.map((v) => v.x0)), y0: Math.min(...b.map((v) => v.y0)), x1: Math.max(...b.map((v) => v.x1)), y1: Math.max(...b.map((v) => v.y1)) };
  });
  const labels: ScreenBox[] = [];
  const placed = plateTargets.map((t, k) => {
    const others = plateBoxes.filter((_, i) => i !== k && !hidden[i]);
    const place = placeLabel(t, project, plateLabel, [...labels, ...others], view);
    const visible = place.visible && !hidden[k];
    if (visible) labels.push(place.box);
    return { ...place, visible };
  });
  const obstacles = [...labels, ...plateBoxes.filter((_, i) => placed[i]!.visible)];
  let slice: LabelPlacement | null = null;
  for (const t of sliceTargets) {
    const place = placeLabel(t, project, SLICE_LABEL, obstacles, view);
    if (place.fits) return { plates: placed, slice: place };
    slice ??= place;
  }
  return { plates: placed, slice };
}

export interface LineGeometry {
  alpha: number;
  /** xyz per sample (m), lifted LINE_LIFT off the LCFS. */
  points: Float32Array;
  /** VMEC |B| per sample (T). */
  B: Float64Array;
  /** Coil envelope h_k at each sample (k·n + s), θ ≈ α + ι·φ (λ neglected, as in the model). */
  h: Float64Array;
}

/** The traced LCFS field lines, with the coil envelopes at their samples for the perturbed |B|. */
export function fieldLineGeometry(art: HeatfieldArtifact, model: HeatModel): LineGeometry[] {
  const { nTheta, nPhi } = art.grid;
  const axis = art.surfaces[0]!;
  const p = model.params;
  const wrap = (x: number) => x - 2 * Math.PI * Math.floor(x / (2 * Math.PI) + 0.5);
  const g = (x: number, s: number) => Math.exp(-(x * x) / (2 * s * s));
  return art.fieldLines.map((f) => {
    const n = f.phi.length;
    const points = new Float32Array(n * 3);
    const h = new Float64Array(model.nDiverters * n);
    for (let s = 0; s < n; s++) {
      const x = f.x[s]!;
      const y = f.y[s]!;
      const z = f.z[s]!;
      const ph = f.phi[s]!;
      const R = Math.hypot(x, y);
      const o = outward(axis, nTheta, nPhi, R, z, Math.atan2(y, x));
      points.set([x + LINE_LIFT * o[0], y + LINE_LIFT * o[1], z + LINE_LIFT * o[2]], s * 3);
      const theta = f.alpha + model.iota * ph;
      model.phiK.forEach((pk, k) => {
        h[k * n + s] = g(wrap(ph - pk), p.sigmaCoilPhi) * g(wrap(theta - model.thetaD), p.sigmaCoilTheta);
      });
    }
    return { alpha: f.alpha, points, B: Float64Array.from(f.B), h };
  });
}

/** |B| along a field line with the coil drive a_k applied: B·(1 + ε Σ_k a_k h_k). */
export function lineField(line: LineGeometry, drive: Float64Array, epsilon: number, out = new Float64Array(line.B.length)): Float64Array {
  const n = line.B.length;
  for (let s = 0; s < n; s++) {
    let pert = 0;
    for (let k = 0; k < drive.length; k++) pert += drive[k]! * line.h[k * n + s]!;
    out[s] = line.B[s]! * (1 + epsilon * pert);
  }
  return out;
}

export interface ArrowGrid {
  /** Cell index of each arrow. */
  cells: Int32Array;
  /** Arrow centre (m), lifted off the surface. */
  origin: Float32Array;
  /** ∂r/∂φ and ∂r/∂θ at the cell (m/rad), and the outward unit normal. */
  tPhi: Float32Array;
  tTheta: Float32Array;
  normal: Float32Array;
}

/** LCFS positions (xyz per cell, m). */
export function lcfsPositions(art: HeatfieldArtifact): Float32Array {
  const { nTheta, nPhi } = art.grid;
  const s = art.surfaces[art.surfaces.length - 1]!;
  const out = new Float32Array(nTheta * nPhi * 3);
  for (let j = 0; j < nPhi; j++) {
    const phi = (2 * Math.PI * j) / nPhi;
    for (let i = 0; i < nTheta; i++) {
      const c = j * nTheta + i;
      out.set(toXYZ(s.R[c]!, s.Z[c]!, phi), c * 3);
    }
  }
  return out;
}

export function arrowGrid(art: HeatfieldArtifact, positions: Float32Array, stride = ARROWS): ArrowGrid {
  const { nTheta, nPhi } = art.grid;
  const dT = (2 * Math.PI) / nTheta;
  const dP = (2 * Math.PI) / nPhi;
  // Every other θ row is shifted by one plane in φ (a staggered grid): aligned columns of cased arrows read as rings
  // round the tube, like the slice marker (DZ3-1, DZ3-2).
  const cells: number[] = [];
  for (let i = 0, row = 0; i < nTheta; i += stride.strideTheta, row++) {
    for (let j = row % 2; j < nPhi; j += stride.stridePhi) cells.push(j * nTheta + i);
  }
  cells.sort((a, b) => a - b);
  const n = cells.length;
  const origin = new Float32Array(n * 3);
  const tPhi = new Float32Array(n * 3);
  const tTheta = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const P = (c: number): Vec3 => [positions[c * 3]!, positions[c * 3 + 1]!, positions[c * 3 + 2]!];
  cells.forEach((c, a) => {
    const j = Math.floor(c / nTheta);
    const i = c % nTheta;
    const pj1 = P(gridIndex(j + 1, i, nPhi, nTheta));
    const pj0 = P(gridIndex(j - 1, i, nPhi, nTheta));
    const pi1 = P(gridIndex(j, i + 1, nPhi, nTheta));
    const pi0 = P(gridIndex(j, i - 1, nPhi, nTheta));
    const tp: Vec3 = [(pj1[0] - pj0[0]) / (2 * dP), (pj1[1] - pj0[1]) / (2 * dP), (pj1[2] - pj0[2]) / (2 * dP)];
    const tt: Vec3 = [(pi1[0] - pi0[0]) / (2 * dT), (pi1[1] - pi0[1]) / (2 * dT), (pi1[2] - pi0[2]) / (2 * dT)];
    let nv: Vec3 = [tp[1] * tt[2] - tp[2] * tt[1], tp[2] * tt[0] - tp[0] * tt[2], tp[0] * tt[1] - tp[1] * tt[0]];
    const len = Math.hypot(...nv) || 1;
    nv = [nv[0] / len, nv[1] / len, nv[2] / len];
    const p = P(c);
    const o = outward(art.surfaces[0]!, nTheta, nPhi, Math.hypot(p[0], p[1]), p[2], (2 * Math.PI * j) / nPhi);
    if (nv[0] * o[0] + nv[1] * o[1] + nv[2] * o[2] < 0) nv = [-nv[0], -nv[1], -nv[2]];
    origin.set([p[0] + ARROWS.lift * nv[0], p[1] + ARROWS.lift * nv[1], p[2] + ARROWS.lift * nv[2]], a * 3);
    tPhi.set(tp, a * 3);
    tTheta.set(tt, a * 3);
    normal.set(nv, a * 3);
  });
  return { cells: Int32Array.from(cells), origin, tPhi, tTheta, normal };
}

/** |v| of every arrow's 3D heat-flow vector v = F_φ ∂r/∂φ + F_θ ∂r/∂θ. */
export function arrowMagnitudes(g: ArrowGrid, fPhi: Float64Array, fTheta: Float64Array): Float64Array {
  const out = new Float64Array(g.cells.length);
  for (let a = 0; a < g.cells.length; a++) {
    const c = g.cells[a]!;
    let s = 0;
    for (let d = 0; d < 3; d++) {
      const v = fPhi[c]! * g.tPhi[a * 3 + d]! + fTheta[c]! * g.tTheta[a * 3 + d]!;
      s += v * v;
    }
    out[a] = Math.sqrt(s);
  }
  return out;
}

/** Reference magnitude for the arrows: the largest |v| of a reference flow (the spun-up start). */
export function arrowScale(g: ArrowGrid, fPhi: Float64Array, fTheta: Float64Array): number {
  return Math.max(0, ...arrowMagnitudes(g, fPhi, fTheta));
}

/** Arrow length (m) for magnitude |v|: refLength·√(|v|/vRef), capped at maxFactor·refLength. √ so that the weak
 * flow away from the footprints still shows its direction (the scene key says so). */
export function arrowLength(mag: number, vRef: number): number {
  return vRef > 0 ? Math.min(ARROWS.maxFactor * ARROWS.refLength, ARROWS.refLength * Math.sqrt(mag / vRef)) : 0;
}

/**
 * Line-segment positions for every arrow: a shaft centred on the cell and two barbs at the tip (6 vertices per
 * arrow), length arrowLength(|v|, vRef). Writes into `out` (in place, for a BufferAttribute).
 */
export function arrowPositions(g: ArrowGrid, fPhi: Float64Array, fTheta: Float64Array, vRef: number, out: Float32Array): Float32Array {
  const cosH = Math.cos(ARROWS.headAngle);
  const sinH = Math.sin(ARROWS.headAngle);
  for (let a = 0; a < g.cells.length; a++) {
    const c = g.cells[a]!;
    const v: Vec3 = [0, 0, 0];
    for (let d = 0; d < 3; d++) v[d] = fPhi[c]! * g.tPhi[a * 3 + d]! + fTheta[c]! * g.tTheta[a * 3 + d]!;
    const mag = Math.hypot(...v);
    const L = arrowLength(mag, vRef);
    const u: Vec3 = mag > 0 ? [v[0] / mag, v[1] / mag, v[2] / mag] : [0, 0, 0];
    const nv: Vec3 = [g.normal[a * 3]!, g.normal[a * 3 + 1]!, g.normal[a * 3 + 2]!];
    const side: Vec3 = [nv[1] * u[2] - nv[2] * u[1], nv[2] * u[0] - nv[0] * u[2], nv[0] * u[1] - nv[1] * u[0]];
    const o: Vec3 = [g.origin[a * 3]!, g.origin[a * 3 + 1]!, g.origin[a * 3 + 2]!];
    const tail: Vec3 = [o[0] - (u[0] * L) / 2, o[1] - (u[1] * L) / 2, o[2] - (u[2] * L) / 2];
    const tip: Vec3 = [o[0] + (u[0] * L) / 2, o[1] + (u[1] * L) / 2, o[2] + (u[2] * L) / 2];
    const hl = ARROWS.head * L;
    const barb = (sgn: number): Vec3 => [
      tip[0] - hl * (cosH * u[0] + sgn * sinH * side[0]),
      tip[1] - hl * (cosH * u[1] + sgn * sinH * side[1]),
      tip[2] - hl * (cosH * u[2] + sgn * sinH * side[2]),
    ];
    out.set([...tail, ...tip, ...tip, ...barb(1), ...tip, ...barb(-1)], a * 18);
  }
  return out;
}

/** Vertices per arrow of the drawn arrow (shaft quad + head triangle) and its triangle indices (DZ3-2). */
export const ARROW_VERTICES = 7;
const ARROW_TRIANGLES = [0, 1, 3, 0, 3, 2, 4, 5, 6];

/** Triangle indices of `n` drawn arrows (the same for the core and the halo). */
export function arrowIndex(n: number): Uint32Array {
  const out = new Uint32Array(n * ARROW_TRIANGLES.length);
  for (let a = 0; a < n; a++) ARROW_TRIANGLES.forEach((v, k) => (out[a * ARROW_TRIANGLES.length + k] = a * ARROW_VERTICES + v));
  return out;
}

/**
 * The drawn arrows (DZ3-2): for each arrow of `lines` (arrowPositions: tail, tip, …), a flat shaft and a filled head
 * in the surface's tangent plane, for the core (shaft `core` metres wide) and for the halo round it (`pad` metres
 * wider on every side). The head is ARROWS.head of the arrow long, as wide as its half-angle gives and never
 * narrower than `headMin` metres. An arrow shorter than `headMin` (DZ4-2: most of them on a phone, where a fixed-size
 * head and halo turned each into a blob) gets a head no wider than the arrow is long and a halo `pad` narrowed by the
 * same factor, length / headMin; its core shaft keeps its width. Writes ARROW_VERTICES xyz per arrow into `outCore`
 * and `outHalo` (in place).
 */
export function arrowMeshes(
  g: ArrowGrid,
  lines: Float32Array,
  widths: { core: number; pad: number; headMin: number },
  outCore: Float32Array,
  outHalo: Float32Array,
): void {
  const tanH = Math.tan(ARROWS.headAngle);
  for (let a = 0; a < g.cells.length; a++) {
    const o = a * 18;
    const tail: Vec3 = [lines[o]!, lines[o + 1]!, lines[o + 2]!];
    const tip: Vec3 = [lines[o + 3]!, lines[o + 4]!, lines[o + 5]!];
    const d: Vec3 = [tip[0] - tail[0], tip[1] - tail[1], tip[2] - tail[2]];
    const L = Math.hypot(...d);
    const u: Vec3 = L > 0 ? [d[0] / L, d[1] / L, d[2] / L] : [0, 0, 0];
    const nv: Vec3 = [g.normal[a * 3]!, g.normal[a * 3 + 1]!, g.normal[a * 3 + 2]!];
    const side: Vec3 = [nv[1] * u[2] - nv[2] * u[1], nv[2] * u[0] - nv[0] * u[2], nv[0] * u[1] - nv[1] * u[0]];
    const headLen = ARROWS.head * L;
    const short = widths.headMin > 0 ? Math.min(1, L / widths.headMin) : 1;
    const headHalf = L > 0 ? Math.max(headLen * tanH, (short * widths.headMin) / 2) : 0;
    const write = (out: Float32Array, pad: number) => {
      const half = L > 0 ? widths.core / 2 + pad : 0;
      const hh = headHalf > 0 ? headHalf + 2 * pad : 0;
      // The halo reaches `pad` behind the tail and past the tip by pad / sin(half-angle), so it rings the head too.
      const back = L > 0 ? pad : 0;
      const front = L > 0 ? pad / Math.sin(Math.atan2(headHalf, headLen || 1)) : 0;
      const at = (along: number, across: number): Vec3 => [
        tip[0] + u[0] * along + side[0] * across,
        tip[1] + u[1] * along + side[1] * across,
        tip[2] + u[2] * along + side[2] * across,
      ];
      const baseAlong = -headLen + (pad > 0 ? -pad : 0);
      const v = [at(-L - back, -half), at(-L - back, half), at(-headLen, -half), at(-headLen, half), at(baseAlong, -hh), at(baseAlong, hh), at(front, 0)];
      v.forEach((p, k) => out.set(p, (a * ARROW_VERTICES + k) * 3));
    };
    write(outCore, 0);
    write(outHalo, short * widths.pad);
  }
}

/**
 * The cross-section slice as a closed tube round the LCFS ring of grid plane j (DZ3-1), with a radius that can be
 * changed in place (so it stays `SLICE_MARK` pixels wide as the view zooms): `centres` are the ring points (already
 * lifted off the LCFS), `out` the in-plane outward unit vectors there and `dirs` the unit offsets of the `radial`
 * vertices round each centre, in the plane normal to the ring (spanned by e_φ and `out`).
 */
export interface RingTube {
  nRing: number;
  radial: number;
  centres: Float32Array;
  out: Float32Array;
  dirs: Float32Array;
}

export function sliceTube(geom: Pick<HeatSceneGeometry, 'rings' | 'positions' | 'nTheta' | 'nPhi'>, j: number, radial = SLICE_MARK.radial): RingTube {
  const { nTheta: n, nPhi } = geom;
  const jj = mod(j, nPhi);
  const phi = (2 * Math.PI * jj) / nPhi;
  const ePhi: Vec3 = [-Math.sin(phi), Math.cos(phi), 0];
  const centres = geom.rings.slice(jj * n * 3, (jj + 1) * n * 3);
  const out = new Float32Array(n * 3);
  const dirs = new Float32Array(n * radial * 3);
  for (let i = 0; i < n; i++) {
    const c = (jj * n + i) * 3;
    // The ring point sits LINE_LIFT outside the LCFS point: that offset is the outward direction.
    let o: Vec3 = [geom.rings[c]! - geom.positions[c]!, geom.rings[c + 1]! - geom.positions[c + 1]!, geom.rings[c + 2]! - geom.positions[c + 2]!];
    const len = Math.hypot(...o) || 1;
    o = [o[0] / len, o[1] / len, o[2] / len];
    out.set(o, i * 3);
    for (let v = 0; v < radial; v++) {
      const a = (2 * Math.PI * v) / radial;
      dirs.set([Math.cos(a) * ePhi[0] + Math.sin(a) * o[0], Math.cos(a) * ePhi[1] + Math.sin(a) * o[1], Math.cos(a) * ePhi[2] + Math.sin(a) * o[2]], (i * radial + v) * 3);
    }
  }
  return { nRing: n, radial, centres, out, dirs };
}

/** Vertex positions of a RingTube of `radius` whose centre line is pushed `lift` metres further out (in place). */
export function ringTubePositions(t: RingTube, radius: number, lift: number, out: Float32Array = new Float32Array(t.nRing * t.radial * 3)): Float32Array {
  for (let i = 0; i < t.nRing; i++) {
    for (let v = 0; v < t.radial; v++) {
      const k = (i * t.radial + v) * 3;
      for (let d = 0; d < 3; d++) out[k + d] = t.centres[i * 3 + d]! + lift * t.out[i * 3 + d]! + radius * t.dirs[k + d]!;
    }
  }
  return out;
}

/** Triangle indices of a closed RingTube (closed along the ring and round it). */
export function ringTubeIndex(nRing: number, radial: number): Uint32Array {
  const out = new Uint32Array(nRing * radial * 6);
  let k = 0;
  for (let i = 0; i < nRing; i++) {
    const i1 = (i + 1) % nRing;
    for (let v = 0; v < radial; v++) {
      const v1 = (v + 1) % radial;
      const a = i * radial + v;
      const b = i1 * radial + v;
      const c = i1 * radial + v1;
      const d = i * radial + v1;
      out.set([a, b, c, a, c, d], k);
      k += 6;
    }
  }
  return out;
}

/**
 * Where the "Slice φ …" label can be pinned (DZ3-1), in order of preference: beyond the ring's outboard point along
 * the major radius, above its top, beyond its inboard point towards the torus axis, below its bottom. HeatScene takes
 * the first whose point is in view and not hidden behind the torus.
 */
export function sliceLabelTargets(geom: Pick<HeatSceneGeometry, 'rings' | 'nTheta' | 'nPhi'>, j: number): LabelTarget[] {
  const { nTheta: n, nPhi } = geom;
  const jj = mod(j, nPhi);
  const phi = (2 * Math.PI * jj) / nPhi;
  const ring = geom.rings.slice(jj * n * 3, (jj + 1) * n * 3);
  const P = (i: number): Vec3 => [ring[i * 3]!, ring[i * 3 + 1]!, ring[i * 3 + 2]!];
  const R = (i: number) => Math.hypot(ring[i * 3]!, ring[i * 3 + 1]!);
  const Z = (i: number) => ring[i * 3 + 2]!;
  const idx = Array.from({ length: n }, (_, i) => i);
  const best = (score: (i: number) => number) => idx.reduce((b, i) => (score(i) > score(b) ? i : b), 0);
  const radial: Vec3 = [Math.cos(phi), Math.sin(phi), 0];
  const candidates: [number, Vec3][] = [
    [best(R), radial],
    [best(Z), [0, 0, 1]],
    [best((i) => -R(i)), [-radial[0], -radial[1], 0]],
    [best((i) => -Z(i)), [0, 0, -1]],
  ];
  return candidates.map(([i, dir]) => {
    const end = P(i);
    return { shapes: [ring], end, anchor: [end[0] + SLICE_LABEL.offset * dir[0], end[1] + SLICE_LABEL.offset * dir[1], end[2] + SLICE_LABEL.offset * dir[2]] };
  });
}

/** The LCFS poloidal ring at grid plane j (xyz per θ, lifted slightly), marking the cross-section slice. */
export function sliceRing(art: HeatfieldArtifact, positions: Float32Array, j: number, out = new Float32Array(art.grid.nTheta * 3)): Float32Array {
  const { nTheta, nPhi } = art.grid;
  const phi = (2 * Math.PI * mod(j, nPhi)) / nPhi;
  for (let i = 0; i < nTheta; i++) {
    const c = gridIndex(j, i, nPhi, nTheta);
    const x = positions[c * 3]!;
    const y = positions[c * 3 + 1]!;
    const z = positions[c * 3 + 2]!;
    const o = outward(art.surfaces[0]!, nTheta, nPhi, Math.hypot(x, y), z, phi);
    out.set([x + LINE_LIFT * o[0], y + LINE_LIFT * o[1], z + LINE_LIFT * o[2]], i * 3);
  }
  return out;
}

/**
 * Outward unit vertex normals of the LCFS mesh (area-weighted face normals, turned to point away from the magnetic
 * axis): the directions the outline hull is pushed along.
 */
export function lcfsNormals(art: HeatfieldArtifact, positions: Float32Array, triangles: Uint32Array): Float32Array {
  const { nTheta, nPhi } = art.grid;
  const n = new Float64Array(positions.length);
  const P = (v: number): Vec3 => [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!];
  for (let t = 0; t < triangles.length; t += 3) {
    const [a, b, c] = [triangles[t]!, triangles[t + 1]!, triangles[t + 2]!];
    const pa = P(a);
    const pb = P(b);
    const pc = P(c);
    const e1: Vec3 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const e2: Vec3 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const f: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) for (let d = 0; d < 3; d++) n[v * 3 + d] = n[v * 3 + d]! + f[d]!;
  }
  const out = new Float32Array(positions.length);
  for (let v = 0; v < positions.length / 3; v++) {
    let nv: Vec3 = [n[v * 3]!, n[v * 3 + 1]!, n[v * 3 + 2]!];
    const len = Math.hypot(...nv) || 1;
    nv = [nv[0] / len, nv[1] / len, nv[2] / len];
    const p = P(v);
    const o = outward(art.surfaces[0]!, nTheta, nPhi, Math.hypot(p[0], p[1]), p[2], (2 * Math.PI * Math.floor(v / nTheta)) / nPhi);
    if (nv[0] * o[0] + nv[1] * o[1] + nv[2] * o[2] < 0) nv = [-nv[0], -nv[1], -nv[2]];
    out.set(nv, v * 3);
  }
  return out;
}

/** Vertical field of view of the 3D camera (degrees). */
export const CAMERA_FOV = 30;

/**
 * Outline of the temperature-coloured LCFS (DESIGN.md §7, WCAG 1.4.11): an inverted hull, the LCFS pushed out along
 * its vertex normals and drawn back faces only in sceneTheme().outline, so a rim shows round every silhouette. The
 * push is chosen per view so the rim is at least `px` pixels wide even on the far side of the torus, and never less
 * than `minOffset` metres (a fixed 0.01 m would be about 0.4 px at the default view).
 */
export const OUTLINE = { px: 1.5, minOffset: 0.01 };

/**
 * Metres per screen pixel on the far side of the torus (the most a pixel covers anywhere on it), for a camera
 * `distance` from the origin, a scene `heightPx` tall and the LCFS's `extent` (m). Marks sized with it are at least
 * that many pixels wide everywhere on the torus.
 */
export function metresPerPx(distance: number, extent: number, heightPx: number, fovDeg = CAMERA_FOV): number {
  const far = distance + extent;
  return (2 * far * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, heightPx);
}

/** Hull offset (m) for a camera `distance` from the origin, a scene `heightPx` tall and the LCFS's `extent` (m). */
export function outlineOffset(distance: number, extent: number, heightPx: number, fovDeg = CAMERA_FOV): number {
  return Math.max(OUTLINE.minOffset, OUTLINE.px * metresPerPx(distance, extent, heightPx, fovDeg));
}

/** The outline hull's vertices: every LCFS vertex pushed `offset` metres along its outward normal (in place). */
export function outlinePositions(positions: Float32Array, normals: Float32Array, offset: number, out?: Float32Array): Float32Array {
  const o = out ?? new Float32Array(positions.length);
  for (let k = 0; k < positions.length; k++) o[k] = positions[k]! + offset * normals[k]!;
  return o;
}

export interface HeatSceneGeometry {
  nTheta: number;
  nPhi: number;
  positions: Float32Array;
  /** Outward unit normal of every LCFS vertex (for the outline hull). */
  normals: Float32Array;
  triangles: Uint32Array;
  /** Largest distance of the LCFS from the z axis (m), for framing the camera. */
  extent: number;
  plates: PlateGeometry[];
  lines: LineGeometry[];
  arrows: ArrowGrid;
  /** Reference |v| of the arrows: the spun-up starting flow's largest (fixed, so arrow length compares across time). */
  arrowScale: number;
  /** The slice ring of every grid plane j (nTheta xyz each, at j·nTheta·3). */
  rings: Float32Array;
}

export function buildSceneGeometry(art: HeatfieldArtifact, model: HeatModel, startFlow: { fPhi: Float64Array; fTheta: Float64Array }, stride = ARROWS): HeatSceneGeometry {
  const positions = lcfsPositions(art);
  let extent = 0;
  for (let c = 0; c < positions.length; c += 3) extent = Math.max(extent, Math.hypot(positions[c]!, positions[c + 1]!));
  const arrows = arrowGrid(art, positions, stride);
  const { nTheta, nPhi } = art.grid;
  const rings = new Float32Array(nPhi * nTheta * 3);
  for (let j = 0; j < nPhi; j++) rings.set(sliceRing(art, positions, j), j * nTheta * 3);
  const triangles = surfaceTriangles(art.grid.nPhi, art.grid.nTheta);
  return {
    rings,
    nTheta: art.grid.nTheta,
    nPhi: art.grid.nPhi,
    positions,
    normals: lcfsNormals(art, positions, triangles),
    triangles,
    extent,
    plates: diverterPlates(art),
    lines: fieldLineGeometry(art, model),
    arrows,
    arrowScale: arrowScale(arrows, startFlow.fPhi, startFlow.fTheta),
  };
}

// ---------------------------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------------------------

/** sRGB (0–1) to linear-sRGB, the working space of three's vertex colours (what Color.setRGB(…, SRGBColorSpace) does). */
export function srgbToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

/** sRGB (0–1) to a hex string for SVG fills (not a literal: built from the token ramp). */
export function rgbToHex([r, g, b]: readonly [number, number, number]): string {
  const h = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

const lutCache = new Map<string, Float32Array>();

/** LUT_SIZE linear-sRGB triples of the temperature (`heat`) or Heat & field |B| (`field`) ramp of the theme. */
export function rampLut(kind: ColorBy, theme: ThemeName): Float32Array {
  const key = `${kind}:${theme}`;
  let lut = lutCache.get(key);
  if (!lut) {
    lut = new Float32Array(LUT_SIZE * 3);
    for (let x = 0; x < LUT_SIZE; x++) {
      const t = x / (LUT_SIZE - 1);
      const rgb = kind === 'temperature' ? heatColor(t, theme) : fieldColor(t, theme);
      lut.set(rgb.map(srgbToLinear), x * 3);
    }
    lutCache.set(key, lut);
  }
  return lut;
}

/** Normalise each value over `range` (clamped) and write its LUT colour into `out` (3 per value). */
export function writeColors(values: ArrayLike<number>, range: readonly [number, number], lut: Float32Array, out: Float32Array): Float32Array {
  const [lo, hi] = range;
  const span = hi > lo ? hi - lo : 1;
  const top = LUT_SIZE - 1;
  for (let c = 0; c < values.length; c++) {
    const t = (values[c]! - lo) / span;
    const x = t <= 0 ? 0 : t >= 1 ? top : Math.round(t * top);
    out[c * 3] = lut[x * 3]!;
    out[c * 3 + 1] = lut[x * 3 + 1]!;
    out[c * 3 + 2] = lut[x * 3 + 2]!;
  }
  return out;
}

/** Fixed colour ranges, labelled on the colour bars. */
export interface ColourRanges {
  /**
   * LCFS temperature (keV): from the coldest to the hottest LCFS temperature of the spun-up start (the two-point
   * target and upstream temperatures, ~0.025 and ~0.21 keV), rounded out to LCFS_T_STEP. Values outside take the
   * end colours.
   */
  lcfsT: [number, number];
  /**
   * Cross-section temperature (keV): from the same data floor as `lcfsT` (the coldest LCFS temperature of the
   * spun-up start, rounded down) to T_0, which the core reaches on the axis. Not from T_t: the slice never gets
   * near T_t, and a bar from T_t put the whole edge band (where the footprint, the slider and the coils change
   * anything) inside one or two stops (DESIGN.md §7, DZ-4). Colder values take the coldest colour.
   */
  sliceT: [number, number];
  /** |B| over every surface and every coil state (T). */
  B: [number, number];
}

/** Rounding of the LCFS colour range's cold end (keV): a display choice, not a model number. */
export const LCFS_T_STEP = 0.005;

export function colourRanges(art: HeatfieldArtifact, model: HeatModel, startT: ArrayLike<number>): ColourRanges {
  const p = model.params;
  let tMin = Infinity;
  for (let c = 0; c < startT.length; c++) tMin = Math.min(tMin, startT[c]!);
  let tMax = -Infinity;
  for (let c = 0; c < startT.length; c++) tMax = Math.max(tMax, startT[c]!);
  const lcfsLo = Math.max(0, Math.floor(tMin / LCFS_T_STEP) * LCFS_T_STEP);
  const lcfsHi = Math.max(lcfsLo + LCFS_T_STEP, Math.ceil(tMax / LCFS_T_STEP) * LCFS_T_STEP);
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of art.surfaces) {
    const r2 = s.rho * s.rho;
    s.B.forEach((b, c) => {
      let hs = 0;
      for (const hk of model.h) hs += hk[c]!;
      lo = Math.min(lo, b * (1 - r2 * p.epsilon * hs));
      hi = Math.max(hi, b * (1 + r2 * p.epsilon * hs));
    });
  }
  return { lcfsT: [lcfsLo, lcfsHi], sliceT: [lcfsLo < p.Tcore0 ? lcfsLo : 0, p.Tcore0], B: [lo, hi] };
}

// ---------------------------------------------------------------------------------------------
// Camera (orbit about the z axis), as in Locate the tubes; copied, not imported (no cross-feature imports)
// ---------------------------------------------------------------------------------------------

export interface Orbit {
  azimuth: number;
  elevation: number;
  distance: number;
}

/** Default: from above, like the owner's top-down sketch, turned so all four diverters are in view. */
export const DEFAULT_ORBIT: Orbit = { azimuth: (-60 * Math.PI) / 180, elevation: (52 * Math.PI) / 180, distance: 3.8 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ORBIT_STEP = (10 * Math.PI) / 180;

export function clampOrbit(o: Orbit): Orbit {
  return { azimuth: o.azimuth, elevation: clamp(o.elevation, -1.45, 1.45), distance: clamp(o.distance, 0.22, 6) };
}

export function orbitForKey(o: Orbit, key: string): Orbit | null {
  switch (key) {
    case 'ArrowLeft':
      return clampOrbit({ ...o, azimuth: o.azimuth - ORBIT_STEP });
    case 'ArrowRight':
      return clampOrbit({ ...o, azimuth: o.azimuth + ORBIT_STEP });
    case 'ArrowUp':
      return clampOrbit({ ...o, elevation: o.elevation + ORBIT_STEP });
    case 'ArrowDown':
      return clampOrbit({ ...o, elevation: o.elevation - ORBIT_STEP });
    case '+':
    case '=':
      return clampOrbit({ ...o, distance: o.distance / 1.15 });
    case '-':
    case '_':
      return clampOrbit({ ...o, distance: o.distance * 1.15 });
    case '0':
    case 'Home':
      return DEFAULT_ORBIT;
    default:
      return null;
  }
}

export function cameraPosition(o: Orbit, extent: number, aspect = 1.6): Vec3 {
  const d = o.distance * extent * Math.max(1, 1.5 / Math.max(aspect, 0.3));
  return [d * Math.cos(o.elevation) * Math.cos(o.azimuth), d * Math.cos(o.elevation) * Math.sin(o.azimuth), d * Math.sin(o.elevation)];
}
