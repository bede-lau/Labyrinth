// Thin Three.js adapter for Heat & field: turns the pure scene geometry (scene.ts) into a WebGL scene and
// recolours it in place from the running model. Three is loaded lazily (dynamic import only: lazyLoad.test.ts in
// features/geometry scans all of src). jsdom has no WebGL, so HeatScene.test.tsx runs buildContent/applyFrame
// against real three with only WebGLRenderer replaced.
//
// Geometry is built once per artifact and theme; per frame only BufferAttributes change (needsUpdate), never the
// geometry itself.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Callout, formatNumber, heatColor, sceneTheme, type ThemeName } from '../../design';
import type { HeatModel } from './model';
import {
  ARROW_MARK,
  ARROW_VERTICES,
  CAMERA_FOV,
  DEFAULT_ORBIT,
  LABEL,
  LINE_RADIUS,
  OUTLINE,
  SLICE_LABEL,
  SLICE_MARK,
  arrowIndex,
  arrowMeshes,
  arrowPositions,
  cameraPosition,
  clampOrbit,
  lineField,
  metresPerPx,
  orbitForKey,
  layoutSceneLabels,
  outlineOffset,
  outlinePositions,
  rampLut,
  ringTubeIndex,
  ringTubePositions,
  sliceLabelTargets,
  sliceTube,
  writeColors,
  temperatureFraction,
  rgbToHex,
  type ColorBy,
  type ColourRanges,
  type HeatSceneGeometry,
  type LabelPlacement,
  type Orbit,
  type Projector,
} from './scene';
import type { Simulation } from './sim';

type Three = typeof import('three');
type Group = import('three').Group;
type Mesh = import('three').Mesh;
type BufferAttribute = import('three').BufferAttribute;

export interface LineMesh {
  mesh: Mesh;
  casing: Mesh;
  colors: BufferAttribute;
  /** Fractional sample index of every tube ring (TubeGeometry samples by arc length). */
  ringSample: Float32Array;
  radial: number;
}

export interface SceneContent {
  group: Group;
  surface: Mesh;
  surfaceColors: BufferAttribute;
  /** The LCFS silhouette outline: an inverted hull in sceneTheme().outline (DESIGN.md §7). */
  outline: Mesh;
  /** Current push of the hull along the normals (m). */
  outlineOffset: number;
  /** Re-push the hull (in place); does nothing when the offset is unchanged. */
  setOutlineOffset: (offset: number) => void;
  lines: Group;
  lineMeshes: LineMesh[];
  /** Heat-flow arrows (DZ3-2): a color.text core over a scene-background halo, flat in the surface, both meshes. */
  arrows: Group;
  arrowCore: Mesh;
  arrowHalo: Mesh;
  arrowCorePositions: BufferAttribute;
  arrowHaloPositions: BufferAttribute;
  /** The arrows as line segments (tail, tip, two barbs: 6 xyz each), what the two meshes are built round. */
  arrowLines: Float32Array;
  /**
   * The cross-section slice on the surface (DZ3-1): a closed tube round plane j, a color.text core inside a
   * scene-background halo, kept SLICE_MARK pixels wide; rewritten in place only when the plane or the view's scale
   * changes.
   */
  slice: Group;
  sliceCore: Mesh;
  sliceHalo: Mesh;
  sliceJ: number;
  /** Metres per pixel the slice tube is sized for. */
  sliceScale: number;
  setSlice: (j: number, metresPerPixel?: number) => void;
  plates: Group;
}

const TUBE_RADIAL = 6;
/** Metres per pixel assumed until the first frame sizes the marks (about the default view of a 480 px scene). */
export const DEFAULT_METRES_PER_PX = 0.033;

/** Every object of the scene, built once: LCFS mesh (vertex colours), plates, field lines, arrows, slice ring. */
export function buildContent(THREE: Three, geom: HeatSceneGeometry, theme: ThemeName): SceneContent {
  const st = sceneTheme(theme);
  const group = new THREE.Group();

  // LCFS: unlit, so shading never shifts a colour into its neighbour's value (DESIGN.md §7).
  const surfGeom = new THREE.BufferGeometry();
  surfGeom.setAttribute('position', new THREE.BufferAttribute(geom.positions, 3));
  surfGeom.setIndex(new THREE.BufferAttribute(geom.triangles, 1));
  const surfaceColors = new THREE.BufferAttribute(new Float32Array(geom.positions.length), 3);
  surfaceColors.setUsage(THREE.DynamicDrawUsage);
  surfGeom.setAttribute('color', surfaceColors);
  surfGeom.computeBoundingSphere();
  const surface = new THREE.Mesh(
    surfGeom,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
  );
  surface.name = 'lcfs';
  group.add(surface);

  // Its outline: a copy pushed out along the vertex normals, back faces only, in the outline colour. Where the
  // surface turns away from the camera the hull's far side shows as a rim round the silhouette (the pale yellow
  // end of the temperature ramp is not 3:1 on the light scene; the outline carries the edge, WCAG 1.4.11).
  const hullGeom = new THREE.BufferGeometry();
  const hullPositions = new THREE.BufferAttribute(outlinePositions(geom.positions, geom.normals, OUTLINE.minOffset), 3);
  hullPositions.setUsage(THREE.DynamicDrawUsage);
  hullGeom.setAttribute('position', hullPositions);
  hullGeom.setIndex(new THREE.BufferAttribute(geom.triangles, 1));
  const outline = new THREE.Mesh(hullGeom, new THREE.MeshBasicMaterial({ color: new THREE.Color(st.outline), side: THREE.BackSide }));
  outline.name = 'lcfs outline';
  outline.frustumCulled = false;
  group.add(outline);

  // Diverter plates: the near-black fill over a larger rim in the edge colour (visible on every ground). The rim is
  // drawn first and writes no depth, so the fill always lands on top of it: both are flat strips across φ, and where
  // the surface twists (D4 at the default view) the wider rim's chord rises in front of the fill and hid most of the
  // black plate. Both still test depth against the surface, so a plate behind the torus stays hidden. They go after
  // the cross-section slice (which writes no depth), so where the slice crosses a plate (φ 0° = D1, the default) the
  // plate is drawn whole on top of it; elsewhere the slice is untouched.
  const plates = new THREE.Group();
  plates.name = 'diverters';
  for (const p of geom.plates) {
    for (const [part, color, order, depthWrite] of [
      [p.edge, st.diverter.edge, 9, false],
      [p.fill, st.diverter.fill, 10, true],
    ] as const) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
      g.setIndex(new THREE.BufferAttribute(part.index, 1));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(color), side: THREE.DoubleSide, depthWrite }));
      m.name = `${p.id} ${part === p.fill ? 'plate' : 'edge'}`;
      if (part === p.fill) m.userData.diverter = geom.plates.indexOf(p);
      m.renderOrder = order;
      plates.add(m);
    }
  }
  group.add(plates);

  // Field lines: tubes coloured by |B| per ring, each in a casing so it stays visible over a |B|-coloured surface.
  const lines = new THREE.Group();
  lines.name = 'field lines';
  const lineMeshes: LineMesh[] = geom.lines.map((line) => {
    const n = line.points.length / 3;
    const pts = Array.from({ length: n }, (_, s) => new THREE.Vector3(line.points[s * 3], line.points[s * 3 + 1], line.points[s * 3 + 2]));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const segments = n - 1;
    const tube = new THREE.TubeGeometry(curve, segments, LINE_RADIUS, TUBE_RADIAL, false);
    const ringSample = new Float32Array(segments + 1);
    for (let s = 0; s <= segments; s++) ringSample[s] = curve.getUtoTmapping(s / segments, 0) * (n - 1);
    const colors = new THREE.BufferAttribute(new Float32Array(tube.getAttribute('position').count * 3), 3);
    colors.setUsage(THREE.DynamicDrawUsage);
    tube.setAttribute('color', colors);
    const mesh = new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ vertexColors: true }));
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;
    const casing = new THREE.Mesh(
      new THREE.TubeGeometry(curve, segments, LINE_RADIUS * 1.7, TUBE_RADIAL, false),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(st.markers.outline), side: THREE.BackSide }),
    );
    casing.renderOrder = 2;
    casing.frustumCulled = false;
    lines.add(casing, mesh);
    return { mesh, casing, colors, ringSample, radial: TUBE_RADIAL };
  });
  group.add(lines);

  // Heat-flow arrows (DZ3-2): flat shafts and filled heads in the surface's tangent plane, a color.text core over a
  // halo in the scene background (as the leader lines and the slice cursor), positions rewritten per frame. WebGL
  // draws lines 1 px wide, which vanished on the yellow cold band; meshes keep the widths ARROW_MARK asks for. The
  // halo writes no depth and goes first, so the core always lands on it.
  const nArrows = geom.arrows.cells.length;
  const arrowIdx = arrowIndex(nArrows);
  const arrowMesh = (color: string, order: number, depthWrite: boolean, name: string) => {
    const g = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(new Float32Array(nArrows * ARROW_VERTICES * 3), 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', attr);
    g.setIndex(new THREE.BufferAttribute(arrowIdx, 1));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(color), side: THREE.DoubleSide, depthWrite }));
    m.name = name;
    m.renderOrder = order;
    m.frustumCulled = false;
    return { m, attr };
  };
  const halo = arrowMesh(st.background, 4, false, 'heat-flow arrows halo');
  const core = arrowMesh(st.text, 5, true, 'heat-flow arrows core');
  const arrows = new THREE.Group();
  arrows.name = 'heat-flow arrows';
  arrows.add(halo.m, core.m);
  arrows.visible = false;
  group.add(arrows);

  // The cross-section slice (DZ3-1): a closed tube round plane j, a color.text core in a scene-background halo, so it
  // reads on every ramp colour and never passes for a field line (the old thin accent ring was within 7 ΔE00 of the
  // field-line colours and hid under D1's plate). Same vertex count for every plane: rewritten in place.
  const ringIdx = ringTubeIndex(geom.nTheta, SLICE_MARK.radial);
  const ringMesh = (color: string, order: number, depthWrite: boolean, name: string) => {
    const g = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(new Float32Array(geom.nTheta * SLICE_MARK.radial * 3), 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', attr);
    g.setIndex(new THREE.BufferAttribute(ringIdx, 1));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(color), side: THREE.DoubleSide, depthWrite }));
    m.name = name;
    m.renderOrder = order;
    m.frustumCulled = false;
    return { m, attr };
  };
  // Neither writes depth: the black diverter plates, drawn after them, must land on top where they cross (owner).
  const sliceHalo = ringMesh(st.background, 7, false, 'cross-section slice halo');
  const sliceCore = ringMesh(st.text, 8, false, 'cross-section slice core');
  const slice = new THREE.Group();
  slice.name = 'cross-section slice';
  slice.add(sliceHalo.m, sliceCore.m);
  group.add(slice);
  let tube = sliceTube(geom, 0);
  const sizeSlice = (mpp: number) => {
    const rCore = (SLICE_MARK.corePx / 2) * mpp;
    const rHalo = (SLICE_MARK.haloPx / 2) * mpp;
    // The core's inner edge sits on the ring line (LINE_LIFT off the LCFS), so the surface never swallows it.
    ringTubePositions(tube, rCore, rCore, sliceCore.attr.array as Float32Array);
    ringTubePositions(tube, rHalo, rCore, sliceHalo.attr.array as Float32Array);
    sliceCore.attr.needsUpdate = true;
    sliceHalo.attr.needsUpdate = true;
  };
  sizeSlice(DEFAULT_METRES_PER_PX);

  const content: SceneContent = {
    group,
    surface,
    surfaceColors,
    outline,
    outlineOffset: OUTLINE.minOffset,
    setOutlineOffset: (offset: number) => {
      if (Math.abs(offset - content.outlineOffset) < 1e-5) return;
      outlinePositions(geom.positions, geom.normals, offset, hullPositions.array as Float32Array);
      hullPositions.needsUpdate = true;
      content.outlineOffset = offset;
    },
    lines,
    lineMeshes,
    arrows,
    arrowCore: core.m,
    arrowHalo: halo.m,
    arrowCorePositions: core.attr,
    arrowHaloPositions: halo.attr,
    arrowLines: new Float32Array(nArrows * 18),
    slice,
    sliceCore: sliceCore.m,
    sliceHalo: sliceHalo.m,
    sliceJ: 0,
    sliceScale: DEFAULT_METRES_PER_PX,
    setSlice: (j: number, mpp = content.sliceScale) => {
      // A new plane, or a view whose scale moved the tube's width by more than 2 %.
      if (j === content.sliceJ && Math.abs(mpp - content.sliceScale) <= 0.02 * content.sliceScale) return;
      if (j !== content.sliceJ) tube = sliceTube(geom, j);
      sizeSlice(mpp);
      content.sliceJ = j;
      content.sliceScale = mpp;
    },
    plates,
  };
  return content;
}

export interface FrameInput {
  /** LCFS temperature (keV). */
  T: Float64Array;
  /** LCFS |B| now, coil perturbation included (T). */
  B: Float64Array;
  /** Coil drive a_k now. */
  drive: Float64Array;
  epsilon: number;
  colorBy: ColorBy;
  ranges: ColourRanges;
  theme: ThemeName;
  showLines: boolean;
  /** Two-point target temperature of every diverter (keV): the plates are coloured by it on the temperature map. */
  targetT?: ArrayLike<number> | null;
  /** Heat-flow vector (angle space) when arrows are shown. */
  flow: { fPhi: Float64Array; fTheta: Float64Array } | null;
  sliceJ: number;
  /** Metres per screen pixel on the far side of the torus (metresPerPx): the arrows and the slice are sized by it. */
  metresPerPx: number;
}

/** Recolour / reposition in place (BufferAttribute.needsUpdate); nothing is rebuilt. */
export function applyFrame(content: SceneContent, geom: HeatSceneGeometry, f: FrameInput): void {
  const surfaceArr = content.surfaceColors.array as Float32Array;
  if (f.colorBy === 'temperature') writeColors(f.T, f.ranges.lcfsT, rampLut('temperature', f.theme), surfaceArr, f.ranges.lcfsT[0] > 0);
  else writeColors(f.B, f.ranges.B, rampLut('field', f.theme), surfaceArr);
  content.surfaceColors.needsUpdate = true;
  // The plates show where the plasma is cold: the target temperature T_t,k on the same scale (version 7); by |B| they
  // keep their near-black fill. Each fill mesh carries its diverter index (userData.diverter).
  const fillColour = sceneTheme(f.theme).diverter.fill;
  content.plates.children.forEach((mesh) => {
    const k = mesh.userData.diverter as number | undefined;
    if (k === undefined) return;
    const t = f.colorBy === 'temperature' ? f.targetT?.[k] : undefined;
    const colour = t === undefined ? fillColour : rgbToHex(heatColor(temperatureFraction(t, f.ranges.lcfsT), f.theme));
    ((mesh as unknown as { material: { color: { set(c: string): void } } }).material).color.set(colour);
  });

  content.lines.visible = f.showLines;
  if (f.showLines) {
    const lut = rampLut('field', f.theme);
    geom.lines.forEach((line, k) => {
      const lm = content.lineMeshes[k]!;
      const n = line.B.length;
      const sampleCol = writeColors(lineField(line, f.drive, f.epsilon), f.ranges.B, lut, new Float32Array(n * 3));
      const out = lm.colors.array as Float32Array;
      const perRing = lm.radial + 1;
      for (let s = 0; s < lm.ringSample.length; s++) {
        const x = lm.ringSample[s]!;
        const i0 = Math.min(n - 2, Math.floor(x));
        const w = x - i0;
        const r = sampleCol[i0 * 3]! * (1 - w) + sampleCol[(i0 + 1) * 3]! * w;
        const g = sampleCol[i0 * 3 + 1]! * (1 - w) + sampleCol[(i0 + 1) * 3 + 1]! * w;
        const b = sampleCol[i0 * 3 + 2]! * (1 - w) + sampleCol[(i0 + 1) * 3 + 2]! * w;
        for (let v = 0; v < perRing; v++) {
          const o = (s * perRing + v) * 3;
          out[o] = r;
          out[o + 1] = g;
          out[o + 2] = b;
        }
      }
      lm.colors.needsUpdate = true;
    });
  }

  content.arrows.visible = f.flow !== null;
  if (f.flow) {
    arrowPositions(geom.arrows, f.flow.fPhi, f.flow.fTheta, geom.arrowScale, content.arrowLines);
    const mpp = f.metresPerPx;
    arrowMeshes(
      geom.arrows,
      content.arrowLines,
      { core: ARROW_MARK.corePx * mpp, pad: ARROW_MARK.padPx * mpp, headMin: ARROW_MARK.headMinPx * mpp },
      content.arrowCorePositions.array as Float32Array,
      content.arrowHaloPositions.array as Float32Array,
    );
    content.arrowCorePositions.needsUpdate = true;
    content.arrowHaloPositions.needsUpdate = true;
  }

  content.setSlice(((f.sliceJ % geom.nPhi) + geom.nPhi) % geom.nPhi, f.metresPerPx);
}

/**
 * Whether `point` is hidden from the camera behind the LCFS (HF3-2): the surface is hit on the way to it. Hits within
 * `tolerance` metres of the point are ignored (the point sits just off the surface, and a grazing ray may touch the
 * surface right beside it).
 */
export function hiddenBehindSurface(
  THREE: Three,
  camera: import('three').Camera,
  surface: Mesh,
  point: readonly [number, number, number],
  tolerance = 0.1,
): boolean {
  const origin = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const dir = new THREE.Vector3(point[0], point[1], point[2]).sub(origin);
  const dist = dir.length();
  if (dist <= tolerance) return false;
  const ray = new THREE.Raycaster(origin, dir.normalize(), 0, dist - tolerance);
  return ray.intersectObject(surface, false).length > 0;
}

/** The LCFS grid cell under normalised device coordinates (−1…1), or null when the ray misses the surface. */
export function pickCell(THREE: Three, camera: import('three').Camera, surface: Mesh, ndc: { x: number; y: number }): number | null {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
  const hit = ray.intersectObject(surface, false)[0];
  if (!hit?.face) return null;
  return nearestVertex(THREE, surface, hit.face, hit.point);
}

function nearestVertex(THREE: Three, surface: Mesh, face: {a:number;b:number;c:number}, point: import('three').Vector3) {
  const pos = surface.geometry.getAttribute('position');
  const v = new THREE.Vector3();
  let best = face.a;
  let bestD = Infinity;
  for (const idx of [face.a, face.b, face.c]) {
    v.fromBufferAttribute(pos, idx);
    const d = v.distanceToSquared(point);
    if (d < bestD) {
      bestD = d;
      best = idx;
    }
  }
  return best;
}

function disposeGroup(g: Group) {
  g.traverse((o) => {
    const mesh = o as Mesh;
    const instanced = o as import('three').InstancedMesh;
    if (instanced.isInstancedMesh) instanced.dispose();
    mesh.geometry?.dispose();
    const mat = mesh.material as import('three').Material | import('three').Material[] | undefined;
    (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((m) => m.dispose());
  });
}

const thermalLabel = { ...LABEL, width: 104, height: 22 };
const compactTargetLabel = { ...thermalLabel, width: 42 };

export interface HoverPoint {
  section?: boolean;
  interpolation?: {cells: [number, number, number]; weights: [number, number, number]};
  cell: number;
  /** Pointer position inside the scene box (px). */
  x: number;
  y: number;
}

export interface HeatSceneProps {
  geom: HeatSceneGeometry;
  model: HeatModel;
  sim: Simulation;
  colorBy: ColorBy;
  ranges: ColourRanges;
  showLines: boolean;
  showArrows: boolean;
  sliceJ: number;
  theme: ThemeName;
  /** Accessible name of the scene. */
  label: string;
  /** id of the element holding the text summary of the scene. */
  describedBy?: string;
  onHover?: (h: HoverPoint | null) => void;
  /** Drawn over the scene (the hover read-out). */
  overlay?: ReactNode;
  /** Optional co-registered geometry in the same VMEC metre coordinate system. */
  extend?: (three: Three, content: SceneContent) => (frame: HeatSceneProps) => void;
  displayRevision?: unknown;
  initialOrbit?: Orbit;
  inspection?: boolean;
  showTemperatures?: boolean;
  followed?: number | null;
  visiblePlates?: readonly boolean[];
}

interface Handle {
  THREE: Three;
  renderer: import('three').WebGLRenderer;
  scene: import('three').Scene;
  camera: import('three').PerspectiveCamera;
  content: SceneContent | null;
  dispose: () => void;
}

/**
 * The label box, from the same numbers placeLabel clears the plates with (HF3-4: one source; heatfield.css sets no
 * size or margin on it). Centred on the point the label is translated to.
 */
export function labelBoxStyle(size: { width: number; height: number }): CSSProperties {
  return {
    width: `${size.width}px`,
    height: `${size.height}px`,
    marginLeft: `${-size.width / 2}px`,
    marginTop: `${-size.height / 2}px`,
    lineHeight: `${size.height - 2}px`,
  };
}

export function HeatScene(props: HeatSceneProps) {
  const { geom, sim, theme, label, describedBy, overlay, sliceJ } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const leaderRefs = useRef<(SVGGElement | null)[]>([]);
  const sliceLabelRef = useRef<HTMLSpanElement | null>(null);
  const sliceLeaderRef = useRef<SVGGElement | null>(null);
  const handle = useRef<Handle | null>(null);
  const extension = useRef<((frame: HeatSceneProps) => void) | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const inspectSlice = useRef(false);
  const orbit = useRef<Orbit>(props.initialOrbit ?? DEFAULT_ORBIT);
  const drag = useRef<{ x: number; y: number; orbit: Orbit; moved: boolean } | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Which labels name something hidden behind the torus (HF3-2), worked out again only when the camera, the scene
   * size, the slice plane or the content changes (raycasts against the LCFS), never on a plain model step.
   */
  const occlusion = useRef<{ key: string; content: SceneContent | null; plates: boolean[]; slice: boolean[] }>({
    key: '',
    content: null,
    plates: [],
    slice: [],
  });

  /** Draw one frame from the running model with the latest props. */
  const draw = useRef(() => {});
  draw.current = () => {
    const h = handle.current;
    if (!h?.content) return;
    const p = latest.current;
    const model = p.model;
    const framingExtent = inspectSlice.current ? p.geom.extent * 0.32 : p.geom.extent;
    const [x, y, z] = cameraPosition(orbit.current, framingExtent, h.camera.aspect);
    const phi = 2 * Math.PI * p.sliceJ / p.geom.nPhi;
    const axis = p.sliceJ * p.geom.nTheta * 3;
    // As magnification increases, bring the selected section under the lens.
    // A camera aimed at the ring centre would zoom straight into the empty bore.
    const t = Math.min(1, Math.max(0, (2.7 - orbit.current.distance) / 1.7));
    const focus = inspectSlice.current ? 1 : p.inspection ? t*t*(3-2*t) : 0;
    const opposite = axis + 3 * Math.floor(p.geom.nTheta / 2);
    const centre = (component: number) => focus * 0.5 *
      (p.geom.positions[axis+component]! + p.geom.positions[opposite+component]!);
    const cx = centre(0), cy = centre(1), cz = centre(2);
    const angle = inspectSlice.current ? phi : 0;
    h.camera.position.set(cx + x*Math.cos(angle)-y*Math.sin(angle), cy + x*Math.sin(angle)+y*Math.cos(angle), cz+z);
    h.camera.up.set(0, 0, 1);
    h.camera.lookAt(cx, cy, cz);
    h.camera.updateMatrixWorld();
    const el = hostRef.current;
    const w = el?.clientWidth || 600;
    const hh = el?.clientHeight || 400;
    const distance = Math.hypot(x, y, z);
    applyFrame(h.content, p.geom, {
      T: p.sim.state.T,
      B: p.sim.field(),
      drive: model.drive(p.sim.coils, p.sim.absoluteTime),
      epsilon: model.params.epsilon,
      colorBy: p.colorBy,
      ranges: p.ranges,
      theme: p.theme,
      showLines: p.showLines,
      targetT: model.edge(p.sim.state.n, p.sim.coils).Tt,
      flow: p.showArrows ? model.heatFlow(p.sim.state, p.sim.coils) : null,
      sliceJ: p.sliceJ,
      metresPerPx: metresPerPx(distance, p.geom.extent, hh, h.camera.fov),
    });
    // The silhouette outline stays at least OUTLINE.px wide as the view zooms or the box resizes.
    h.content.setOutlineOffset(outlineOffset(distance, p.geom.extent, hh, h.camera.fov));
    extension.current?.(p);
    if (p.visiblePlates) h.content.plates.children.forEach((mesh, i) => { mesh.visible = !!p.visiblePlates?.[Math.floor(i / 2)]; });
    h.renderer.render(h.scene, h.camera);
    const v = new h.THREE.Vector3();
    const project: Projector = (pt) => {
      v.set(pt[0], pt[1], pt[2]).project(h.camera);
      return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * hh, inView: v.z < 1 && Math.abs(v.x) <= 1.1 && Math.abs(v.y) <= 1.1 };
    };
    const sliceTargets = sliceLabelTargets(p.geom, p.sliceJ);
    const occ = occlusion.current;
    const key = `${cx},${cy},${cz},${x},${y},${z},${w},${hh},${p.sliceJ},${h.content.surface.visible}`;
    if (occ.key !== key || occ.content !== h.content) {
      const surface = h.content.surface;
      occ.plates = p.geom.plates.map((pl) => surface.visible && hiddenBehindSurface(h.THREE, h.camera, surface, pl.outerEnd));
      occ.slice = sliceTargets.map((t) => project(t.end).inView && project(t.anchor).inView && (!surface.visible || !hiddenBehindSurface(h.THREE, h.camera, surface, t.end)));
      occ.key = key;
      occ.content = h.content;
    }
    const show = (span: HTMLElement | null | undefined, leader: SVGGElement | null | undefined, place: LabelPlacement | null) => {
      const visible = place !== null && place.visible;
      if (span) {
        if (place) span.style.transform = `translate(${place.x.toFixed(1)}px, ${place.y.toFixed(1)}px)`;
        span.hidden = !visible;
      }
      if (leader) {
        if (place) {
          const [x1, y1, x2, y2] = place.leader.map((c) => c.toFixed(1));
          leader.querySelector('.hf-plate-pin')?.setAttribute('transform', `translate(${x1} ${y1})`);
          leader.querySelectorAll('line').forEach((line) => {
            line.setAttribute('x1', x1!);
            line.setAttribute('y1', y1!);
            line.setAttribute('x2', x2!);
            line.setAttribute('y2', y2!);
          });
        }
        if (visible) leader.removeAttribute('visibility');
        else leader.setAttribute('visibility', 'hidden');
      }
    };
    // The D1…D4 labels: beyond each plate's outer end, never over the plate, with a leader line back to it (DZ-2);
    // hidden while the plate is behind the torus, where it is not drawn (HF3-2). "Slice φ …" (DZ3-1): placed the same
    // way, beyond a visible point of the ring, clear of the D labels and plates. All inside the scene box (DZ4-1).
    const roles = p.inspection ? p.geom.plates.map((_,k) => {
      const temperature = p.sim.peakTileC(k);
      return {temperature, hot: temperature >= model.params.tileLimit};
    }) : [];
    const labels = layoutSceneLabels(
      p.geom.plates,
      occ.plates.map((hidden,k) => hidden && !roles[k]?.hot),
      sliceTargets.filter((_, i) => occ.slice[i]),
      project,
      { width: w, height: hh },
      p.inspection ? (p.showTemperatures === false ? compactTargetLabel : thermalLabel) : LABEL,
    );
    if (p.inspection) labelRefs.current.forEach((el,k) => {
      if (!el) return;
      const {temperature, hot} = roles[k]!;
      for (const node of [el, leaderRefs.current[k]]) {
        if (!node) continue;
        node.dataset.hot = String(hot);
        node.dataset.followed = String(p.followed != null && k + 1 === p.followed);
      }
      const reading = p.geom.plates[k]!.id + (p.showTemperatures === false ? '' : ' · ' + temperature.toFixed(1) + '°C');
      if (el.textContent !== reading) el.textContent = reading;
    });
    labels.plates.forEach((place, k) => show(labelRefs.current[k], leaderRefs.current[k], p.visiblePlates?.[k] === false ? null : place));
    show(sliceLabelRef.current, sliceLeaderRef.current, labels.slice);
  };

  // Mount: load three, create the renderer, keep it sized to the host.
  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    import('three')
      .then((THREE) => {
        const el = hostRef.current;
        if (disposed || !el) return;
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        const resize = (w: number, h: number) => {
          const ratio = latest.current.inspection ? Math.min(3, Math.max(2, window.devicePixelRatio || 1), Math.sqrt(8000000/(w*h))) : Math.min(2, window.devicePixelRatio || 1);
          renderer.setPixelRatio(ratio);
          renderer.setSize(w,h);
        };
        resize(el.clientWidth || 600, el.clientHeight || 400);
        renderer.domElement.setAttribute('aria-hidden', 'true');
        el.replaceChildren(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(CAMERA_FOV, (el.clientWidth || 600) / (el.clientHeight || 400), 0.1, 200);
        handle.current = {
          THREE,
          renderer,
          scene,
          camera,
          content: null,
          dispose: () => {
            if (handle.current?.content) disposeGroup(handle.current.content.group);
            renderer.dispose();
          },
        };
        if (typeof ResizeObserver === 'function') {
          ro = new ResizeObserver(() => {
            const wv = el.clientWidth;
            const hv = el.clientHeight;
            if (!wv || !hv) return;
            resize(wv, hv);
            camera.aspect = wv / hv;
            camera.updateProjectionMatrix();
            draw.current();
          });
          ro.observe(el);
        }
        setReady(true);
      })
      .catch((e: unknown) => !disposed && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      disposed = true;
      ro?.disconnect();
      handle.current?.dispose();
      handle.current = null;
    };
  }, []);

  // Geometry and theme: (re)build the content. Only these rebuild; frames recolour in place.
  useEffect(() => {
    const h = handle.current;
    if (!ready || !h) return;
    h.scene.background = new h.THREE.Color(sceneTheme(theme).background);
    if (h.content) {
      h.scene.remove(h.content.group);
      disposeGroup(h.content.group);
    }
    h.content = buildContent(h.THREE, geom, theme);
    extension.current = props.extend?.(h.THREE, h.content);
    h.scene.add(h.content.group);
    draw.current();
  }, [ready, geom, theme, props.extend]);

  // Every change of the running model redraws (the playback loop advances it once per animation frame).
  useEffect(() => sim.subscribe(() => draw.current()), [sim]);

  // Display options.
  useEffect(() => {
    if (ready) draw.current();
  }, [ready, props.colorBy, props.showLines, props.showArrows, props.sliceJ, props.ranges, props.displayRevision, props.visiblePlates, props.showTemperatures, props.followed]);

  const setOrbit = (o: Orbit) => {
    latest.current.onHover?.(null);
    orbit.current = o;
    draw.current();
  };

  const reset = () => { inspectSlice.current = false; setOrbit(props.initialOrbit ?? DEFAULT_ORBIT); };
  const onKeyDown = (e: KeyboardEvent) => {
    const next = orbitForKey(orbit.current, e.key);
    if (!next) return;
    e.preventDefault();
    if (e.key === 'Home' || e.key === '0') reset(); else setOrbit(next);
  };
  const hover = (e: PointerEvent) => {
    const h = handle.current;
    const el = hostRef.current;
    if (!h?.content || !el || !latest.current.onHover) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const w = r.width || el.clientWidth;
    const hv = r.height || el.clientHeight;
    if (!w || !hv) return;
    const ray = new h.THREE.Raycaster();
    ray.setFromCamera(new h.THREE.Vector2((x/w)*2-1, 1-(y/hv)*2), h.camera);
    const cap = h.content.group.getObjectByName('Thermal cross-section');
    const surfaces = [h.content.surface, ...(cap ? [cap] : [])].filter(o => o.visible);
    const hit = ray.intersectObjects(surfaces, false)[0];
    if (!hit?.face) { latest.current.onHover(null); return; }
    const cell = nearestVertex(h.THREE, hit.object as Mesh, hit.face, hit.point);
    const interpolation = hit.barycoord && latest.current.inspection ? {
      cells: [hit.face.a, hit.face.b, hit.face.c] as [number, number, number],
      weights: hit.barycoord.toArray(),
    } : undefined;
    latest.current.onHover({ cell, x, y, ...(interpolation && {interpolation}), ...(cap === hit.object ? {section:true} : {}) });
  };
  const onPointerDown = (e: PointerEvent) => {
    hover(e);
    drag.current = { x: e.clientX, y: e.clientY, orbit: orbit.current, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) {
      hover(e);
      return;
    }
    latest.current.onHover?.(null);
    d.moved = true;
    setOrbit(
      clampOrbit({ ...d.orbit, azimuth: d.orbit.azimuth - (e.clientX - d.x) * 0.008, elevation: d.orbit.elevation + (e.clientY - d.y) * 0.008 }),
    );
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="hf-scene" data-expanded={expanded}>
      <div
        ref={hostRef}
        className="hf-scene__canvas"
        role="img"
        aria-roledescription="interactive 3D view"
        aria-label={`${label}. Arrow keys rotate, plus and minus zoom, 0 resets the view.`}
        aria-describedby={describedBy}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          drag.current = null;
          latest.current.onHover?.(null);
        }}
      />
      <div className="hf-scene__labels" aria-hidden="true">
        <svg className="hf-scene__leaders" focusable="false">
          {geom.plates.map((p, k) => (
            <g
              key={p.id}
              ref={(el) => {
                leaderRefs.current[k] = el;
              }}
              className="hf-scene__leader"
              data-diverter={p.id}
              visibility="hidden"
            >
              <line className="hf-scene__leader-halo" />
              <line className="hf-scene__leader-line" />
              {props.inspection && <g className="hf-plate-pin">
                <svg className="plate-warning" x="-9" y="-24" width="18" height="18" viewBox="0 0 24 24">
                  <path d="m12 3 10 18H2Z"/><path d="M12 8v5m0 3v1"/>
                </svg>
              </g>}
            </g>
          ))}
          <g ref={sliceLeaderRef} className="hf-scene__leader" data-slice="" visibility="hidden">
            <line className="hf-scene__leader-halo" />
            <line className="hf-scene__leader-line" />
          </g>
        </svg>
        {geom.plates.map((p, k) => (
          <span
            key={p.id}
            ref={(el) => {
              labelRefs.current[k] = el;
            }}
            className="hf-scene__label"
            style={labelBoxStyle(props.inspection ? (props.showTemperatures === false ? compactTargetLabel : thermalLabel) : LABEL)}
            hidden
          >
            {p.id}
          </span>
        ))}
        <span ref={sliceLabelRef} className="hf-scene__label hf-scene__label--slice" style={labelBoxStyle(SLICE_LABEL)} hidden>
          Slice φ {formatNumber((360 * (((sliceJ % geom.nPhi) + geom.nPhi) % geom.nPhi)) / geom.nPhi, 0)}°
        </span>
      </div>
      {overlay}
      {props.inspection && <div className="geo-inspect-tools">
        <button type="button" className="hf-btn" aria-label="Zoom in" onClick={()=>setOrbit(orbitForKey(orbit.current,'+')!)}>+</button>
        <button type="button" className="hf-btn" aria-label="Zoom out" onClick={()=>setOrbit(orbitForKey(orbit.current,'-')!)}>−</button>
        <button type="button" className="hf-btn" onClick={()=>{inspectSlice.current=true;setOrbit({...orbit.current,azimuth:-0.65,elevation:0.52,distance:2.65});}}>Inspect slice</button>
        <button type="button" className="hf-btn" aria-pressed={expanded} onClick={()=>setExpanded(!expanded)}>{expanded ? 'Collapse' : 'Expand'}</button>
      </div>}
      <button type="button" className="hf-btn hf-scene__reset" onClick={reset}>
        Reset view
      </button>
      {error && (
        <Callout tone="warn" title="3D view unavailable (WebGL could not start)">
          {error}. The text summary, the cross-section, the diverter table and the |B| chart carry the same information.
        </Callout>
      )}
    </div>
  );
}
