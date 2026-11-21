// H9 / H10 with the real Three.js library: only WebGLRenderer is replaced (jsdom has no WebGL context); every
// geometry, material, colour, raycast and group is built by real three from the committed artifact.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { fieldColor, heatColor, sceneTheme, themes, typeScale } from '../../design';
import { contrastRatio, deltaE2000, hexToLab } from '../../design/color';
import { parseCss, rulesFor } from '../../design/cssRules';
import { DEFAULT_METRES_PER_PX, HeatScene, applyFrame, buildContent, pickCell, type FrameInput } from './HeatScene';
import { modelFor, spunUpState } from './model';
import {
  ARROWS,
  ARROW_MARK,
  ARROW_VERTICES,
  CAMERA_FOV,
  DEFAULT_ORBIT,
  LABEL,
  LCFS_T_STEP,
  LUT_SIZE,
  OUTLINE,
  SLICE_LABEL,
  SLICE_MARK,
  arrowLength,
  arrowMagnitudes,
  buildSceneGeometry,
  cameraPosition,
  colourRanges,
  lineField,
  metresPerPx,
  outlineOffset,
  placePlateLabel,
  srgbToLinear,
  surfaceTriangles,
  type HeatSceneGeometry,
  type Projector,
} from './scene';
import { Simulation } from './sim';
import type { HeatfieldArtifact } from './types';

const gl = vi.hoisted(() => ({ fail: false, created: 0, disposed: 0, frames: [] as { scene: unknown; camera: [number, number, number] }[] }));

vi.mock('three', async (importOriginal) => {
  const real = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    domElement = document.createElement('canvas');
    constructor() {
      if (gl.fail) throw new Error('WebGL context could not be created');
      gl.created++;
    }
    setPixelRatio() {}
    setSize() {}
    render(scene: unknown, camera: { position: { x: number; y: number; z: number } }) {
      gl.frames.push({ scene, camera: [camera.position.x, camera.position.y, camera.position.z] });
    }
    dispose() {
      gl.disposed++;
    }
  }
  return { ...real, WebGLRenderer: FakeRenderer };
});

const ART = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/heatfield.json'), 'utf8')) as HeatfieldArtifact;
const model = modelFor(ART);
const start = spunUpState(model);
const OFF = [0, 0, 0, 0];
const geom: HeatSceneGeometry = buildSceneGeometry(ART, model, model.heatFlow(start, OFF));
const ranges = colourRanges(ART, model, start.T);
const hex = (c: string) => new THREE.Color(c).getHexString();
const N = 48 * 72;

const frame = (over: Partial<FrameInput> = {}): FrameInput => ({
  T: start.T,
  B: model.field(OFF, start.n),
  drive: model.drive(OFF, model.time(start.n)),
  epsilon: model.params.epsilon,
  colorBy: 'temperature',
  ranges,
  theme: 'light',
  showLines: true,
  flow: null,
  sliceJ: 0,
  metresPerPx: DEFAULT_METRES_PER_PX,
  ...over,
});
/** Colour of a basic material as #rrggbb. */
const colourOf = (m: THREE.Object3D) => `#${((m as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHexString()}`;
/** Pixels that `metres` covers on the far side of the torus, through three's projection (as the outline test does). */
const farSidePx = (cam: THREE.Camera, w: number, h: number, metres: number) => {
  const toCam = cam.position.clone().normalize();
  const far = toCam.clone().multiplyScalar(-geom.extent);
  const side = new THREE.Vector3().crossVectors(toCam, new THREE.Vector3(0, 0, 1)).normalize();
  const a = far.clone().project(cam);
  const b = far.clone().addScaledVector(side, metres).project(cam);
  return Math.hypot(((b.x - a.x) / 2) * w, ((b.y - a.y) / 2) * h);
};
const vertex = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, v: number) => new THREE.Vector3(attr.getX(v), attr.getY(v), attr.getZ(v));
/** The LCFS as a plain three mesh, built here (not by buildContent), for independent raycasts. */
const lcfsMesh = () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(geom.positions, 3));
  g.setIndex(new THREE.BufferAttribute(geom.triangles, 1));
  g.computeBoundingSphere();
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
};
const CSS = parseCss(readFileSync(resolve(__dirname, 'heatfield.css'), 'utf8'));
/** The linear-sRGB colour a value should get through a ramp (as Color.setRGB(…, SRGBColorSpace) gives). */
const want = (rgb: readonly [number, number, number]) => rgb.map(srgbToLinear);
const at = (attr: THREE.BufferAttribute, v: number) => [attr.getX(v), attr.getY(v), attr.getZ(v)];

/** The camera HeatScene draws with for a w × h scene box: same field of view, aspect, orbit and target. */
const cameraFor = (w: number, h: number) => {
  const cam = new THREE.PerspectiveCamera(CAMERA_FOV, w / h, 0.1, 200);
  cam.position.set(...cameraPosition(DEFAULT_ORBIT, geom.extent, w / h));
  cam.up.set(0, 0, 1);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
};
/** World point → pixel in a w × h box, through three's own projection. */
const projectorFor = (cam: THREE.Camera, w: number, h: number): Projector => (p) => {
  const v = new THREE.Vector3(p[0], p[1], p[2]).project(cam);
  return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, inView: v.z < 1 && Math.abs(v.x) <= 1.1 && Math.abs(v.y) <= 1.1 };
};
type Box = { x0: number; y0: number; x1: number; y1: number };
/** Pixel bounding box of a list of xyz points, computed here (not with scene.ts's helper). */
const pixelBox = (ps: Float32Array, project: Projector): Box => {
  const pts = Array.from({ length: ps.length / 3 }, (_, v) => project([ps[v * 3]!, ps[v * 3 + 1]!, ps[v * 3 + 2]!]));
  return { x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) };
};
const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
/** The label box drawn round a centre: LABEL.width × LABEL.height px (heatfield.css), at least the ~24 × 18 px of "D1". */
const labelBox = (x: number, y: number): Box => ({ x0: x - LABEL.width / 2, x1: x + LABEL.width / 2, y0: y - LABEL.height / 2, y1: y + LABEL.height / 2 });
/** Scene sizes checked: a 1280 px desktop's scene column, a wide one and a 375 px phone's (heatfield.css heights). */
const SIZES = [
  [760, 480],
  [1100, 480],
  [330, 340],
] as const;

beforeEach(() => {
  gl.fail = false;
  gl.created = 0;
  gl.disposed = 0;
  gl.frames.length = 0;
});

test('H9 buildContent: the closed LCFS mesh from the grid, four black plates with an edge, eight casing field lines, arrows and the slice ring', () => {
  for (const theme of ['light', 'dark'] as const) {
    const st = sceneTheme(theme);
    const c = buildContent(THREE, geom, theme);
    // LCFS: every grid point once (periodic in both angles: no duplicated seam), two triangles per cell.
    const pos = c.surface.geometry.getAttribute('position');
    expect(pos.count).toBe(N);
    expect(Array.from(c.surface.geometry.getIndex()!.array)).toEqual(Array.from(surfaceTriangles(72, 48)));
    const lcfs = ART.surfaces[8]!;
    for (const cell of [0, 47, 48 * 18 + 12, N - 1]) {
      const phi = (2 * Math.PI * Math.floor(cell / 48)) / 72;
      expect(pos.getX(cell)).toBeCloseTo(lcfs.R[cell]! * Math.cos(phi), 5);
      expect(pos.getY(cell)).toBeCloseTo(lcfs.R[cell]! * Math.sin(phi), 5);
      expect(pos.getZ(cell)).toBeCloseTo(lcfs.Z[cell]!, 5);
    }
    // Unlit vertex colours (shading must not shift a value into its neighbour's colour).
    const mat = c.surface.material as THREE.MeshBasicMaterial;
    expect(mat.type).toBe('MeshBasicMaterial');
    expect(mat.vertexColors).toBe(true);
    expect(c.surfaceColors.count).toBe(N);

    // Diverters: four plates, each the near-black fill over the edge colour; at θ_d ± halfWidthTheta of φ_k.
    const plates = c.plates.children as THREE.Mesh[];
    expect(plates).toHaveLength(8);
    expect(plates.map((m) => m.name)).toEqual(['D1 edge', 'D1 plate', 'D2 edge', 'D2 plate', 'D3 edge', 'D3 plate', 'D4 edge', 'D4 plate']);
    plates.forEach((m, k) => {
      const colour = (m.material as THREE.MeshBasicMaterial).color.getHexString();
      expect(colour).toBe(hex(k % 2 === 0 ? st.diverter.edge : st.diverter.fill));
    });
    geom.plates.forEach((p) => {
      const ps = p.fill.positions;
      // Every plate vertex sits at the diverter's toroidal angle ± the drawing half-width.
      for (let v = 0; v < ps.length / 3; v++) {
        const phi = Math.atan2(ps[v * 3 + 1]!, ps[v * 3]!);
        const d = Math.abs(((phi - p.phi + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        expect(d).toBeLessThanOrEqual(0.0501);
      }
    });

    // Field lines: 8 tubes coloured per vertex by |B|, each inside a casing in the marker-outline colour.
    expect(c.lineMeshes).toHaveLength(8);
    for (const lm of c.lineMeshes) {
      expect((lm.mesh.material as THREE.MeshBasicMaterial).vertexColors).toBe(true);
      expect(lm.colors.count).toBe(lm.mesh.geometry.getAttribute('position').count);
      expect((lm.casing.material as THREE.MeshBasicMaterial).color.getHexString()).toBe(hex(st.markers.outline));
      expect((lm.casing.material as THREE.MeshBasicMaterial).side).toBe(THREE.BackSide);
    }
    // Arrows (hidden until asked for) and the slice ring: each a core mesh over a halo mesh.
    expect(c.arrows.visible).toBe(false);
    expect(c.arrows.children).toEqual([c.arrowHalo, c.arrowCore]);
    expect(c.arrowCorePositions.count).toBe(geom.arrows.cells.length * ARROW_VERTICES);
    expect(c.arrowHaloPositions.count).toBe(geom.arrows.cells.length * ARROW_VERTICES);
    expect(c.slice.children).toEqual([c.sliceHalo, c.sliceCore]);
    expect(c.sliceCore.geometry.getAttribute('position').count).toBe(48 * SLICE_MARK.radial);
  }
});

test('H9 each black plate is drawn over its light rim from every view: the rim goes first and writes no depth', () => {
  // Both are flat strips across φ. Where the surface twists, the wider rim's chord rises in front of the fill: at
  // the default view 143 of 200 rays over D4's fill hit its rim first (three's Raycaster, 2026-11-21), so with
  // ordinary depth writes the white rim hid most of the black D4 plate. Draw order, not depth, keeps the fill on top;
  // both still test depth against the surface, so a plate behind the torus stays hidden.
  for (const theme of ['light', 'dark'] as const) {
    const c = buildContent(THREE, geom, theme);
    for (const p of geom.plates) {
      const fill = c.plates.getObjectByName(`${p.id} plate`) as THREE.Mesh;
      const rim = c.plates.getObjectByName(`${p.id} edge`) as THREE.Mesh;
      const fm = fill.material as THREE.MeshBasicMaterial;
      const rm = rim.material as THREE.MeshBasicMaterial;
      expect(rim.renderOrder, p.id).toBeLessThan(fill.renderOrder);
      expect(rm.depthWrite, p.id).toBe(false);
      expect(fm.depthWrite, p.id).toBe(true);
      expect(rm.depthTest && fm.depthTest, p.id).toBe(true);
      expect(rm.transparent || fm.transparent, p.id).toBe(false);
    }
  }
});

test('H9 each black plate is drawn whole over the cross-section slice where they cross (φ 0° = D1, the default): plates after the slice, which writes no depth', () => {
  // The slice tube rises off the LCFS higher than the plate does, so with depth writes it covered and split D1's
  // black plate at the default slice. Draw order keeps the plate on top; everything still tests depth against the
  // surface, so the slice and plates behind the torus stay hidden and the slice shows everywhere else.
  const [w, h] = SIZES[0];
  const cam = cameraFor(w, h);
  for (const theme of ['light', 'dark'] as const) {
    const c = buildContent(THREE, geom, theme);
    applyFrame(c, geom, frame({ theme, sliceJ: 0, metresPerPx: metresPerPx(cam.position.length(), geom.extent, h) }));
    const sm = [c.sliceHalo, c.sliceCore].map((m) => m.material as THREE.MeshBasicMaterial);
    sm.forEach((m) => {
      expect(m.depthWrite).toBe(false);
      expect(m.depthTest).toBe(true);
    });
    expect(c.slice.visible).toBe(true);
    for (const p of geom.plates) {
      for (const part of [`${p.id} plate`, `${p.id} edge`]) {
        const mesh = c.plates.getObjectByName(part) as THREE.Mesh;
        expect(mesh.renderOrder, part).toBeGreaterThan(Math.max(c.sliceHalo.renderOrder, c.sliceCore.renderOrder));
        expect((mesh.material as THREE.MeshBasicMaterial).depthTest, part).toBe(true);
      }
    }
    // Depth alone would not do it: from the default view, rays to D1's plate along φ 0° meet the slice tube first.
    const d1 = c.plates.getObjectByName('D1 plate') as THREE.Mesh;
    const ps = geom.plates[0]!.fill.positions;
    let first = 0;
    for (let row = 0; row < ps.length / 6; row++) {
      const target = new THREE.Vector3(...[0, 1, 2].map((d) => (ps[row * 6 + d]! + ps[row * 6 + 3 + d]!) / 2));
      const dir = target.clone().sub(cam.position).normalize();
      const hit = new THREE.Raycaster(cam.position.clone(), dir).intersectObjects([c.sliceHalo, c.sliceCore, d1], false)[0];
      if (hit && hit.object !== d1) first++;
    }
    expect(first, theme).toBeGreaterThan(0);
  }
});

test('H9 the D1–D4 labels sit beyond each plate’s outer end along the major radius, joined by a leader line, and never cover the plate (DZ-2)', () => {
  // The anchor: LABEL.offset beyond the middle of the fill's end with the larger major radius, along (cos φ, sin φ, 0).
  expect(LABEL.offset).toBeGreaterThanOrEqual(0.2);
  expect(LABEL.width).toBeGreaterThanOrEqual(24);
  expect(LABEL.height).toBeGreaterThanOrEqual(18);
  for (const p of geom.plates) {
    const ps = p.fill.positions;
    const rows = ps.length / 6;
    const mid = (r: number) => [0, 1, 2].map((d) => (ps[r * 6 + d]! + ps[r * 6 + 3 + d]!) / 2);
    const [a, b] = [mid(0), mid(rows - 1)];
    const outer = Math.hypot(a[0]!, a[1]!) > Math.hypot(b[0]!, b[1]!) ? a : b;
    p.outerEnd.forEach((v, d) => expect(v).toBeCloseTo(outer[d]!, 6));
    const step = [LABEL.offset * Math.cos(p.phi), LABEL.offset * Math.sin(p.phi), 0];
    p.anchor.forEach((v, d) => expect(v - p.outerEnd[d]!).toBeCloseTo(step[d]!, 6));
    expect(Math.hypot(p.anchor[0], p.anchor[1])).toBeGreaterThan(Math.hypot(outer[0]!, outer[1]!) + 0.9 * LABEL.offset);
  }

  // At the default top-down view, on a desktop and on a 375 px phone: no label box overlaps its plate (fill or rim),
  // every label is on screen, and labels do not cover each other.
  for (const [w, h] of SIZES) {
    const project = projectorFor(cameraFor(w, h), w, h);
    const placed = geom.plates.map((p) => placePlateLabel(p, project));
    placed.forEach((pl, k) => {
      const plate = geom.plates[k]!;
      const box = labelBox(pl.x, pl.y);
      const where = `${plate.id} at ${w}×${h}`;
      expect(pl.visible, where).toBe(true);
      expect(overlap(box, pixelBox(plate.fill.positions, project)), `${where}: label over the plate`).toBe(false);
      expect(overlap(box, pixelBox(plate.edge.positions, project)), `${where}: label over the plate's rim`).toBe(false);
      expect(box.x0 >= 0 && box.y0 >= 0 && box.x1 <= w && box.y1 <= h, `${where}: label off screen`).toBe(true);
      // The leader runs from the projected outer end of the plate to the edge of the label box.
      const end = project(plate.outerEnd);
      expect(pl.leader[0]).toBeCloseTo(end.x, 6);
      expect(pl.leader[1]).toBeCloseTo(end.y, 6);
      const [, , x2, y2] = pl.leader;
      const onEdge = Math.min(Math.abs(x2 - box.x0), Math.abs(x2 - box.x1), Math.abs(y2 - box.y0), Math.abs(y2 - box.y1));
      expect(onEdge, where).toBeLessThan(1e-6);
      expect(x2 >= box.x0 - 1e-6 && x2 <= box.x1 + 1e-6 && y2 >= box.y0 - 1e-6 && y2 <= box.y1 + 1e-6, where).toBe(true);
    });
    for (let a = 0; a < placed.length; a++) {
      for (let b = a + 1; b < placed.length; b++) {
        expect(overlap(labelBox(placed[a]!.x, placed[a]!.y), labelBox(placed[b]!.x, placed[b]!.y)), `${w}×${h}`).toBe(false);
      }
    }
  }
});

test('H9 every scene label (D1–D4 and "Slice φ …") lies inside the scene box at every slice angle, on a 309 px phone and on desktops, still clear of the plates and each other (DZ4-1)', async () => {
  // DZ4-1: on a 375 px phone (scene 309 px wide) the default "Slice φ 0°" box ran past the right edge (x 248–340 px)
  // and read "Slice φ". jsdom has no layout: the scene box is given its size through clientWidth / clientHeight.
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const parse = (el: HTMLElement, size: { width: number; height: number }): Box => {
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(el.style.transform)!;
    const [x, y] = [Number(m[1]), Number(m[2])];
    return { x0: x - size.width / 2, x1: x + size.width / 2, y0: y - size.height / 2, y1: y + size.height / 2 };
  };
  const endsOn = (line: Element, box: Box, where: string) => {
    const x2 = Number(line.getAttribute('x2'));
    const y2 = Number(line.getAttribute('y2'));
    expect(x2 >= box.x0 - 0.1 && x2 <= box.x1 + 0.1 && y2 >= box.y0 - 0.1 && y2 <= box.y1 + 0.1, `${where}: leader ends in the box`).toBe(true);
    expect(Math.min(Math.abs(x2 - box.x0), Math.abs(x2 - box.x1), Math.abs(y2 - box.y0), Math.abs(y2 - box.y1)), `${where}: leader ends on the box edge`).toBeLessThan(0.1);
  };
  const tol = 0.06; // transforms are written to 0.1 px
  try {
    for (const [w, h] of [
      [309, 340],
      [760, 480],
      [1100, 480],
    ] as const) {
      const sized = (v: number) =>
        function (this: HTMLElement) {
          return this.classList.contains('hf-scene__canvas') ? v : 0;
        };
      Object.defineProperty(proto, 'clientWidth', { configurable: true, get: sized(w) });
      Object.defineProperty(proto, 'clientHeight', { configurable: true, get: sized(h) });
      gl.frames.length = 0;
      const sim = new Simulation(model, start);
      const scene = (j: number) => (
        <HeatScene geom={geom} model={model} sim={sim} colorBy="temperature" ranges={ranges} showLines showArrows={false} sliceJ={j} theme="light" label="3D view" />
      );
      const view = render(scene(0));
      await waitFor(() => expect(gl.frames.length).toBeGreaterThan(0));
      const project = projectorFor(cameraFor(w, h), w, h);
      const plateBoxes = geom.plates.map((p) => [pixelBox(p.fill.positions, project), pixelBox(p.edge.positions, project)]);
      const dLabels = [...document.querySelectorAll<HTMLElement>('.hf-scene__label:not(.hf-scene__label--slice)')];
      const slice = document.querySelector<HTMLElement>('.hf-scene__label--slice')!;
      const sliceLeader = document.querySelector('.hf-scene__leader[data-slice]')!;
      for (let j = 0; j < 72; j++) {
        if (j > 0) view.rerender(scene(j));
        const where = `${w}×${h} slice ${j * 5}°`;
        const inside = (b: Box) => b.x0 >= -tol && b.y0 >= -tol && b.x1 <= w + tol && b.y1 <= h + tol;
        const shown = dLabels.map((l) => !l.hidden);
        const boxes = dLabels.map((l) => parse(l, LABEL));
        dLabels.forEach((_, k) => {
          if (!shown[k]) return;
          const id = `${where} ${geom.plates[k]!.id}`;
          expect(inside(boxes[k]!), `${id}: label off the scene ${JSON.stringify(boxes[k])}`).toBe(true);
          plateBoxes[k]!.forEach((pb) => expect(overlap(boxes[k]!, pb), `${id}: label over its plate`).toBe(false));
          for (let o = 0; o < k; o++) if (shown[o]) expect(overlap(boxes[k]!, boxes[o]!), `${id}: over ${geom.plates[o]!.id}'s label`).toBe(false);
          const line = document.querySelector(`.hf-scene__leader[data-diverter="${geom.plates[k]!.id}"] line`)!;
          const end = project(geom.plates[k]!.outerEnd);
          expect(Math.hypot(Number(line.getAttribute('x1')) - end.x, Number(line.getAttribute('y1')) - end.y), `${id}: leader from the plate`).toBeLessThan(0.1);
          endsOn(line, boxes[k]!, id);
        });
        if (j === 0) {
          expect(shown, where).toEqual([true, true, true, true]);
          expect(slice.hidden, where).toBe(false);
          expect(slice).toHaveTextContent('Slice φ 0°');
        }
        if (slice.hidden) continue;
        const sb = parse(slice, SLICE_LABEL);
        expect(inside(sb), `${where}: slice label off the scene ${JSON.stringify(sb)}`).toBe(true);
        dLabels.forEach((_, k) => {
          if (!shown[k]) return;
          expect(overlap(sb, boxes[k]!), `${where}: slice label over ${geom.plates[k]!.id}'s label`).toBe(false);
          expect(overlap(sb, plateBoxes[k]![0]!), `${where}: slice label over ${geom.plates[k]!.id}`).toBe(false);
        });
        const line = sliceLeader.querySelector('line')!;
        const ring = Array.from({ length: 48 }, (_, i) => project([geom.rings[(j * 48 + i) * 3]!, geom.rings[(j * 48 + i) * 3 + 1]!, geom.rings[(j * 48 + i) * 3 + 2]!]));
        const [lx, ly] = [Number(line.getAttribute('x1')), Number(line.getAttribute('y1'))];
        expect(Math.min(...ring.map((q) => Math.hypot(q.x - lx, q.y - ly))), `${where}: slice leader from the ring`).toBeLessThan(0.1);
        endsOn(line, sb, `${where} slice`);
      }
      view.unmount();
    }
  } finally {
    delete proto.clientWidth;
    delete proto.clientHeight;
    vi.unstubAllGlobals();
  }
});

test('H9 the LCFS silhouette is outlined in sceneTheme().outline: an inverted hull (back faces) pushed out along the outward normals (DZ-1)', () => {
  const axis = ART.surfaces[0]!;
  for (const theme of ['light', 'dark'] as const) {
    const c = buildContent(THREE, geom, theme);
    const o = c.outline;
    expect(o.name).toBe('lcfs outline');
    expect(c.group.children).toContain(o);
    const mat = o.material as THREE.MeshBasicMaterial;
    expect(mat.type).toBe('MeshBasicMaterial');
    expect(mat.side).toBe(THREE.BackSide);
    expect(mat.vertexColors).toBe(false);
    expect(mat.color.getHexString()).toBe(hex(sceneTheme(theme).outline));
    expect(sceneTheme(theme).outline).toBe(themes[theme].scene.boundary);
    // The same closed mesh as the LCFS, every vertex pushed `outlineOffset` along a unit normal that points away from
    // the magnetic axis and is (nearly) perpendicular to the surface's θ and φ grid directions.
    expect(Array.from(o.geometry.getIndex()!.array)).toEqual(Array.from(c.surface.geometry.getIndex()!.array));
    const pos = o.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(pos.count).toBe(N);
    expect(c.outlineOffset).toBe(OUTLINE.minOffset);
    const P = (cell: number) => [0, 1, 2].map((d) => geom.positions[cell * 3 + d]!);
    for (const cell of [0, 12, 24, 36, 48 * 18 + 12, 48 * 40 + 5, 48 * 61 + 30, N - 1]) {
      const j = Math.floor(cell / 48);
      const i = cell % 48;
      const s = P(cell);
      const d = at(pos, cell).map((v, k) => v - s[k]!);
      const len = Math.hypot(...d);
      expect(len).toBeCloseTo(OUTLINE.minOffset, 6);
      const phi = (2 * Math.PI * j) / 72;
      const ax = [axis.R[j * 48]! * Math.cos(phi), axis.R[j * 48]! * Math.sin(phi), axis.Z[j * 48]!];
      expect(Math.hypot(...at(pos, cell).map((v, k) => v - ax[k]!))).toBeGreaterThan(Math.hypot(...s.map((v, k) => v - ax[k]!)));
      const tTheta = P(j * 48 + ((i + 1) % 48)).map((v, k) => v - P(j * 48 + ((i + 47) % 48))[k]!);
      const tPhi = P(((j + 1) % 72) * 48 + i).map((v, k) => v - P(((j + 71) % 72) * 48 + i)[k]!);
      for (const t of [tTheta, tPhi]) {
        const cos = Math.abs(t.reduce((acc, v, k) => acc + v * d[k]!, 0)) / (Math.hypot(...t) * len);
        expect(cos).toBeLessThan(0.2);
      }
    }
    // Re-pushed in place (same attribute and array, new version) when the view needs a wider rim.
    const array = pos.array;
    const v0 = pos.version;
    c.setOutlineOffset(0.05);
    expect(c.outline.geometry.getAttribute('position')).toBe(pos);
    expect(pos.array).toBe(array);
    expect(pos.version).toBeGreaterThan(v0);
    expect(Math.hypot(...at(pos, 1234).map((v, k) => v - P(1234)[k]!))).toBeCloseTo(0.05, 6);
  }

  // The push for a view keeps the rim at least OUTLINE.px (1.5 px) wide even on the far side of the torus, measured
  // here through three's projection at the default view on a desktop and on a phone. A fixed 0.01 m would not be.
  expect(OUTLINE.px).toBeGreaterThanOrEqual(1.5);
  for (const [w, h] of SIZES) {
    const cam = cameraFor(w, h);
    const off = outlineOffset(cam.position.length(), geom.extent, h);
    const toCam = cam.position.clone().normalize();
    const far = toCam.clone().multiplyScalar(-geom.extent);
    const side = new THREE.Vector3().crossVectors(toCam, new THREE.Vector3(0, 0, 1)).normalize();
    const a = far.clone().project(cam);
    const b = far.clone().addScaledVector(side, off).project(cam);
    const px = Math.hypot(((b.x - a.x) / 2) * w, ((b.y - a.y) / 2) * h);
    expect(px, `${w}×${h}`).toBeGreaterThanOrEqual(1.5 - 1e-6);
    expect(px, `${w}×${h}`).toBeLessThan(1.6);
    expect((0.01 * px) / off, `${w}×${h}`).toBeLessThan(1);
  }
  // Zoomed far in, the floor holds.
  expect(outlineOffset(0.5, 0, 4000)).toBe(OUTLINE.minOffset);
});

test('H9 applyFrame colours the LCFS by temperature (red hottest, yellow coldest) or |B| (dark blue strongest, green weakest), in place', () => {
  const c = buildContent(THREE, geom, 'light');
  const attr = c.surfaceColors;
  const array = attr.array;
  applyFrame(c, geom, frame());
  const v0 = attr.version;
  // Temperature over [coldest start value rounded down to 0.05 keV, T_ped]: each vertex is its value's colour on
  // the heat ramp (to one LUT step).
  const [lo, hi] = ranges.lcfsT;
  const tMin = Math.min(...start.T);
  expect(hi).toBe(ART.model.parameters.Tped.value);
  expect(lo).toBeLessThanOrEqual(tMin);
  expect(lo).toBeGreaterThan(tMin - LCFS_T_STEP);
  expect(lo).toBeGreaterThanOrEqual(ART.model.parameters.Ttarget.value);
  let hot = 0;
  let cold = 0;
  for (let v = 0; v < N; v++) {
    if (start.T[v]! > start.T[hot]!) hot = v;
    if (start.T[v]! < start.T[cold]!) cold = v;
  }
  for (const v of [hot, cold, 1234, 3000]) {
    const t = (start.T[v]! - lo) / (hi - lo);
    at(attr, v).forEach((x, k) => expect(Math.abs(x - want(heatColor(t, 'light'))[k]!)).toBeLessThan(4 / LUT_SIZE));
  }
  // The hottest cell is nearer the red end than the coldest (D1 footprint) is.
  expect((start.T[hot]! - lo) / (hi - lo)).toBeGreaterThan((start.T[cold]! - lo) / (hi - lo) + 0.3);

  // Next frame: same attribute and array (nothing rebuilt), new version, new colours.
  const later = model.advance(start, [1, 1, 1, 1], 300);
  applyFrame(c, geom, frame({ T: later.T }));
  expect(c.surfaceColors).toBe(attr);
  expect(attr.array).toBe(array);
  expect(attr.version).toBeGreaterThan(v0);

  // |B| over its fixed range, on the field ramp.
  const B = model.field([1, 0, 0, 0], start.n);
  applyFrame(c, geom, frame({ colorBy: 'field', B }));
  for (const v of [0, 12, 900, N - 1]) {
    const t = (B[v]! - ranges.B[0]) / (ranges.B[1] - ranges.B[0]);
    at(attr, v).forEach((x, k) => expect(Math.abs(x - want(fieldColor(t, 'light'))[k]!)).toBeLessThan(4 / LUT_SIZE));
  }
  expect(ranges.B[0]).toBeLessThanOrEqual(Math.min(...B));
  expect(ranges.B[1]).toBeGreaterThanOrEqual(Math.max(...B));
});

test('H9 field lines are coloured by their |B| with the coil perturbation, so their colour changes as the coils sweep; toggles hide them', () => {
  const c = buildContent(THREE, geom, 'dark');
  // α = π/2 crosses φ = 0 at θ = π/2: right through the D1 coil's envelope.
  const k = geom.lines.findIndex((l) => Math.abs(l.alpha - Math.PI / 2) < 1e-6);
  const lm = c.lineMeshes[k]!;
  applyFrame(c, geom, frame({ theme: 'dark' }));
  expect(c.lines.visible).toBe(true);
  const off = Array.from(lm.colors.array);
  // First ring = first sample's |B| on the field ramp.
  const line = geom.lines[k]!;
  const t0 = (line.B[0]! - ranges.B[0]) / (ranges.B[1] - ranges.B[0]);
  at(lm.colors, 0).forEach((x, d) => expect(Math.abs(x - want(fieldColor(t0, 'dark'))[d]!)).toBeLessThan(4 / LUT_SIZE));
  // Coil D1 on at cos(2πft) = 1: the samples near D1 get up to ε stronger |B|, and so a different colour.
  const drive = model.drive([1, 0, 0, 0], model.time(start.n));
  expect(drive[0]).toBeCloseTo(1, 12);
  const ratio = Math.max(...lineField(line, drive, model.params.epsilon).map((b, s) => b / line.B[s]!));
  expect(ratio).toBeGreaterThan(1 + 0.9 * model.params.epsilon);
  expect(ratio).toBeLessThanOrEqual(1 + model.params.epsilon + 1e-12);
  applyFrame(c, geom, frame({ theme: 'dark', drive }));
  expect(Array.from(lm.colors.array)).not.toEqual(off);
  applyFrame(c, geom, frame({ theme: 'dark', showLines: false }));
  expect(c.lines.visible).toBe(false);
});

test('H9 heat-flow arrows follow the model heat-flow vector; the slice ring follows the slider plane', () => {
  const c = buildContent(THREE, geom, 'light');
  const flow = model.heatFlow(start, OFF);
  applyFrame(c, geom, frame({ flow, sliceJ: 18 }));
  expect(c.arrows.visible).toBe(true);
  const p = c.arrowLines;
  // Longest arrow at the start = the reference length (fixed scale), none longer than the cap.
  let longest = 0;
  for (let a = 0; a < geom.arrows.cells.length; a++) {
    longest = Math.max(longest, Math.hypot(p[a * 18 + 3]! - p[a * 18]!, p[a * 18 + 4]! - p[a * 18 + 1]!, p[a * 18 + 5]! - p[a * 18 + 2]!));
  }
  expect(longest).toBeCloseTo(ARROWS.refLength, 4);
  // Every arrow points along F_φ ∂r/∂φ + F_θ ∂r/∂θ with length refLength·√(|v|/vRef) (the key says √magnitude).
  const mags = arrowMagnitudes(geom.arrows, flow.fPhi, flow.fTheta);
  for (const a of [0, 57, 300, geom.arrows.cells.length - 1]) {
    const len = Math.hypot(p[a * 18 + 3]! - p[a * 18]!, p[a * 18 + 4]! - p[a * 18 + 1]!, p[a * 18 + 5]! - p[a * 18 + 2]!);
    expect(len).toBeCloseTo(arrowLength(mags[a]!, geom.arrowScale), 4);
  }
  expect(arrowLength(geom.arrowScale / 4, geom.arrowScale)).toBeCloseTo(ARROWS.refLength / 2, 12);
  expect(arrowLength(100 * geom.arrowScale, geom.arrowScale)).toBe(ARROWS.maxFactor * ARROWS.refLength);
  // The drawn arrow (core mesh) runs from the line's tail to its tip: the head's point is the tip, the middle of the
  // shaft's back edge the tail.
  const core = c.arrowCorePositions;
  for (const a of [0, 57, 300, geom.arrows.cells.length - 1]) {
    const tip = new THREE.Vector3(p[a * 18 + 3], p[a * 18 + 4], p[a * 18 + 5]);
    const tail = new THREE.Vector3(p[a * 18], p[a * 18 + 1], p[a * 18 + 2]);
    expect(vertex(core, a * ARROW_VERTICES + 6).distanceTo(tip)).toBeLessThan(1e-5);
    expect(vertex(core, a * ARROW_VERTICES).add(vertex(core, a * ARROW_VERTICES + 1)).multiplyScalar(0.5).distanceTo(tail)).toBeLessThan(1e-5);
  }
  // The ring at plane 18 is at φ = 90° (D2): every ring of the tube is centred in that plane.
  const ringOf = () => c.sliceCore.geometry.getAttribute('position') as THREE.BufferAttribute;
  const ring = ringOf();
  const R = SLICE_MARK.radial;
  const centre = (attr: typeof ring, i: number) => {
    const s = new THREE.Vector3();
    for (let v = 0; v < R; v++) s.add(vertex(attr, i * R + v));
    return s.multiplyScalar(1 / R);
  };
  expect(c.sliceJ).toBe(18);
  for (let i = 0; i < 48; i++) {
    const m = centre(ring, i);
    expect(Math.abs(Math.atan2(m.y, m.x) - Math.PI / 2)).toBeLessThan(0.004);
  }
  // Rewritten in place, and only when the plane (or the view's scale) changes, never per frame.
  const v0 = ring.version;
  applyFrame(c, geom, frame({ flow: null, sliceJ: 18 }));
  expect(ringOf()).toBe(ring);
  expect(ring.version).toBe(v0);
  expect(c.arrows.visible).toBe(false);
  applyFrame(c, geom, frame({ flow: null, sliceJ: 36 }));
  expect(ringOf()).toBe(ring);
  expect(ring.version).toBeGreaterThan(v0);
  const m0 = centre(ring, 0);
  expect(Math.abs(Math.atan2(m0.y, m0.x))).toBeCloseTo(Math.PI, 2);
});

test('H9 the cross-section slice is its own marker: a color.text core in a scene-background halo, at least 2 and 5 px wide, never the colour of a field line (DZ3-1)', () => {
  expect(SLICE_MARK.corePx).toBeGreaterThanOrEqual(2);
  expect(SLICE_MARK.haloPx).toBeGreaterThanOrEqual(SLICE_MARK.corePx + 3);
  for (const theme of ['light', 'dark'] as const) {
    const t = themes[theme];
    const c = buildContent(THREE, geom, theme);
    const core = colourOf(c.sliceCore);
    const halo = colourOf(c.sliceHalo);
    expect(core).toBe(t.color.text);
    expect(halo).toBe(t.scene.background);
    // The halo goes first and writes no depth, so the core always lands on it.
    expect(c.sliceHalo.renderOrder).toBeLessThan(c.sliceCore.renderOrder);
    expect((c.sliceHalo.material as THREE.MeshBasicMaterial).depthWrite).toBe(false);
    // The casing reads against its core, and neither can pass for a field line: at least 12 ΔE00 (the field/heat
    // series gate) from every stop of the |B| ramp the field lines are drawn in. The old accent ring was 6.2 ΔE00.
    expect(contrastRatio(core, halo)).toBeGreaterThanOrEqual(3);
    for (const s of t.scene.field) {
      expect(deltaE2000(hexToLab(core), hexToLab(s)), `${theme} core vs ${s}`).toBeGreaterThanOrEqual(12);
      expect(deltaE2000(hexToLab(halo), hexToLab(s)), `${theme} halo vs ${s}`).toBeGreaterThanOrEqual(12);
    }
  }
  // The old ring was the accent, 6.2 ΔE00 from a field-line stop on the light theme.
  expect(Math.min(...themes.light.scene.field.map((s) => deltaE2000(hexToLab(themes.light.color.accent), hexToLab(s))))).toBeLessThan(12);
  // On screen: sized for the view, so at the default view on a desktop and on a phone the core is at least
  // SLICE_MARK.corePx and the halo SLICE_MARK.haloPx wide even on the far side of the torus.
  for (const [w, h] of SIZES) {
    const cam = cameraFor(w, h);
    const mpp = metresPerPx(cam.position.length(), geom.extent, h);
    const c = buildContent(THREE, geom, 'light');
    applyFrame(c, geom, frame({ sliceJ: 9, metresPerPx: mpp }));
    // Width of a tube = distance between its +e_φ and −e_φ vertices of one ring.
    const width = (m: THREE.Mesh) => vertex(m.geometry.getAttribute('position'), 0).distanceTo(vertex(m.geometry.getAttribute('position'), SLICE_MARK.radial / 2));
    const corePx = farSidePx(cam, w, h, width(c.sliceCore));
    const haloPx = farSidePx(cam, w, h, width(c.sliceHalo));
    // (float32 vertex positions: to 1e-3 px)
    expect(corePx, `${w}×${h}`).toBeGreaterThanOrEqual(SLICE_MARK.corePx - 1e-3);
    expect(corePx, `${w}×${h}`).toBeLessThan(SLICE_MARK.corePx + 0.1);
    expect(haloPx, `${w}×${h}`).toBeGreaterThanOrEqual(SLICE_MARK.haloPx - 1e-3);
  }
});

test('H9 heat-flow arrows are a color.text core on a scene-background halo, 1.5 px or wider, readable on every temperature and |B| colour (DZ3-2)', () => {
  for (const theme of ['light', 'dark'] as const) {
    const t = themes[theme];
    const c = buildContent(THREE, geom, theme);
    const core = colourOf(c.arrowCore);
    const halo = colourOf(c.arrowHalo);
    expect(core).toBe(t.color.text);
    expect(halo).toBe(t.scene.background);
    expect(c.arrowHalo.renderOrder).toBeLessThan(c.arrowCore.renderOrder);
    expect((c.arrowHalo.material as THREE.MeshBasicMaterial).depthWrite).toBe(false);
    expect(contrastRatio(core, halo)).toBeGreaterThanOrEqual(3);
    // On every colour the surface can take, the core or its halo is at least 3:1 (WCAG 1.4.11).
    for (const s of [...t.scene.heat, ...t.scene.field]) {
      expect(Math.max(contrastRatio(core, s), contrastRatio(halo, s)), `${theme} on ${s}`).toBeGreaterThanOrEqual(3);
    }
  }
  // The old arrows: 1 px lines in markers.outline, white on the light theme, about 1.3:1 on the coldest yellow.
  expect(contrastRatio(themes.light.scene.markerOutline, themes.light.scene.heat[0]!)).toBeLessThan(1.5);

  // Sized for the view: core shaft ARROW_MARK.corePx wide, halo ARROW_MARK.padPx wider on each side, heads at least
  // ARROW_MARK.headMinPx wide, all measured on the far side of the torus at the default view, on arrows at least
  // headMinPx long (shorter ones: the DZ4-2 test).
  expect(ARROW_MARK.corePx).toBeGreaterThanOrEqual(1.5);
  const [w, h] = SIZES[0];
  const cam = cameraFor(w, h);
  const mpp = metresPerPx(cam.position.length(), geom.extent, h);
  const c = buildContent(THREE, geom, 'light');
  applyFrame(c, geom, frame({ flow: model.heatFlow(start, OFF), metresPerPx: mpp }));
  const core = c.arrowCorePositions;
  const halo = c.arrowHaloPositions;
  const lines = c.arrowLines;
  const long = Array.from({ length: geom.arrows.cells.length }, (_, a) => a).filter(
    (a) => farSidePx(cam, w, h, Math.hypot(lines[a * 18 + 3]! - lines[a * 18]!, lines[a * 18 + 4]! - lines[a * 18 + 1]!, lines[a * 18 + 5]! - lines[a * 18 + 2]!)) >= ARROW_MARK.headMinPx,
  );
  expect(long.length).toBeGreaterThanOrEqual(3);
  for (const a of [long[0]!, long[Math.floor(long.length / 2)]!, long.at(-1)!]) {
    const o = a * ARROW_VERTICES;
    // (float32 vertex positions: to 1e-4 px)
    expect(farSidePx(cam, w, h, vertex(core, o).distanceTo(vertex(core, o + 1)))).toBeCloseTo(ARROW_MARK.corePx, 4);
    expect(farSidePx(cam, w, h, vertex(halo, o).distanceTo(vertex(halo, o + 1)))).toBeCloseTo(ARROW_MARK.corePx + 2 * ARROW_MARK.padPx, 4);
    expect(farSidePx(cam, w, h, vertex(core, o + 4).distanceTo(vertex(core, o + 5)))).toBeGreaterThanOrEqual(ARROW_MARK.headMinPx - 1e-3);
    // The halo's point lies beyond the core's, along the arrow.
    const tail = vertex(core, o).add(vertex(core, o + 1)).multiplyScalar(0.5);
    expect(vertex(halo, o + 6).distanceTo(tail)).toBeGreaterThan(vertex(core, o + 6).distanceTo(tail));
  }
});

test('H9 on a phone an arrow shorter than its head is wide gets a head no wider than it is long and a halo narrowed with it, so none is a blob; every arrow is still drawn (DZ4-2)', () => {
  // DZ4-2: on a 309 × 340 phone scene every arrow is under ARROW_MARK.headMinPx long (far side), and a fixed 5 px head
  // in a 1.5 px halo per side turned each into a blob.
  const [w, h] = [309, 340];
  const cam = cameraFor(w, h);
  const mpp = metresPerPx(cam.position.length(), geom.extent, h);
  const c = buildContent(THREE, geom, 'light');
  applyFrame(c, geom, frame({ flow: model.heatFlow(start, OFF), metresPerPx: mpp }));
  const lines = c.arrowLines;
  const core = c.arrowCorePositions;
  const halo = c.arrowHaloPositions;
  const px = (m: number) => farSidePx(cam, w, h, m);
  let short = 0;
  for (let a = 0; a < geom.arrows.cells.length; a++) {
    const o = a * ARROW_VERTICES;
    const L = px(Math.hypot(lines[a * 18 + 3]! - lines[a * 18]!, lines[a * 18 + 4]! - lines[a * 18 + 1]!, lines[a * 18 + 5]! - lines[a * 18 + 2]!));
    const shaft = px(vertex(core, o).distanceTo(vertex(core, o + 1)));
    const head = px(vertex(core, o + 4).distanceTo(vertex(core, o + 5)));
    const pad = (px(vertex(halo, o).distanceTo(vertex(halo, o + 1))) - shaft) / 2;
    const where = `arrow ${a}: ${L.toFixed(2)} px long`;
    // Still drawn: a color.text shaft ARROW_MARK.corePx wide.
    expect(shaft, where).toBeCloseTo(ARROW_MARK.corePx, 3);
    if (L < ARROW_MARK.headMinPx) {
      short++;
      expect(head, where).toBeLessThanOrEqual(L + 1e-3);
      expect(pad, where).toBeLessThanOrEqual((ARROW_MARK.padPx * L) / ARROW_MARK.headMinPx + 1e-3);
    } else {
      expect(head, where).toBeGreaterThanOrEqual(ARROW_MARK.headMinPx - 1e-3);
      expect(pad, where).toBeCloseTo(ARROW_MARK.padPx, 3);
    }
  }
  expect(short).toBeGreaterThan(0.9 * geom.arrows.cells.length);
});

test('H10 pickCell: a ray through a grid point of the LCFS returns that cell', () => {
  const c = buildContent(THREE, geom, 'light');
  const camera = new THREE.PerspectiveCamera(30, 1.6, 0.1, 200);
  const axis = ART.surfaces[0]!;
  for (const cell of [48 * 9 + 12, 48 * 40 + 0, 48 * 63 + 30]) {
    const j = Math.floor(cell / 48);
    const phi = (2 * Math.PI * j) / 72;
    const target = new THREE.Vector3(geom.positions[cell * 3], geom.positions[cell * 3 + 1], geom.positions[cell * 3 + 2]);
    // From outside, in the cell's poloidal plane, along the line from the magnetic axis through the cell.
    const ax = new THREE.Vector3(axis.R[j * 48]! * Math.cos(phi), axis.R[j * 48]! * Math.sin(phi), axis.Z[j * 48]!);
    const out = target.clone().sub(ax).normalize();
    camera.position.copy(target).addScaledVector(out, 3);
    camera.up.set(-Math.sin(phi), Math.cos(phi), 0);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    expect(pickCell(THREE, camera, c.surface, { x: 0, y: 0 })).toBe(cell);
  }
  // Looking away from the torus: nothing.
  camera.position.set(0, 0, 30);
  camera.lookAt(0, 0, 60);
  camera.updateMatrixWorld();
  expect(pickCell(THREE, camera, c.surface, { x: 0, y: 0 })).toBeNull();
});

test('H9 HeatScene mounts through three, redraws on every model change without rebuilding, answers the keyboard and cleans up', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const sim = new Simulation(model, start);
  const view = render(
    <HeatScene geom={geom} model={model} sim={sim} colorBy="temperature" ranges={ranges} showLines showArrows={false} sliceJ={0} theme="light" label="3D view" describedBy="sum" />,
  );
  const host = screen.getByRole('img', { name: '3D view. Arrow keys rotate, plus and minus zoom, 0 resets the view.' });
  expect(host).toHaveAttribute('aria-describedby', 'sum');
  await waitFor(() => expect(gl.frames.length).toBeGreaterThan(0));
  expect(gl.created).toBe(1);
  expect(host.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');
  const scene = gl.frames.at(-1)!.scene as THREE.Scene;
  const content = scene.children[0] as THREE.Group;
  const surface = content.getObjectByName('lcfs') as THREE.Mesh;
  const colors = surface.geometry.getAttribute('color');
  const before = Array.from(colors.array);

  // A model step redraws at once, recolouring the same geometry.
  const n = gl.frames.length;
  sim.advance(200);
  expect(gl.frames.length).toBe(n + 1);
  expect((gl.frames.at(-1)!.scene as THREE.Scene).children[0]).toBe(content);
  expect(surface.geometry.getAttribute('color')).toBe(colors);
  expect(Array.from(colors.array)).not.toEqual(before);
  // Labels D1…D4 are pinned beside their plates, never on them, each with a leader line from the plate's outer end
  // (DZ-2). jsdom has no layout, so the scene box is the adapter's 600 × 400 fallback.
  const labels = [...document.querySelectorAll<HTMLElement>('.hf-scene__label:not(.hf-scene__label--slice)')];
  expect(labels.map((l) => l.textContent)).toEqual(['D1', 'D2', 'D3', 'D4']);
  const project = projectorFor(cameraFor(600, 400), 600, 400);
  labels.forEach((l, k) => {
    const plate = geom.plates[k]!;
    expect(l.hidden).toBe(false);
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(l.style.transform)!;
    const box = labelBox(Number(m[1]), Number(m[2]));
    expect(overlap(box, pixelBox(plate.fill.positions, project)), plate.id).toBe(false);
    const leader = document.querySelector(`.hf-scene__leader[data-diverter="${plate.id}"]`)!;
    expect(leader).not.toHaveAttribute('visibility');
    const end = project(plate.outerEnd);
    leader.querySelectorAll('line').forEach((line) => {
      expect(Number(line.getAttribute('x1'))).toBeCloseTo(end.x, 0);
      expect(Number(line.getAttribute('y1'))).toBeCloseTo(end.y, 0);
      // It ends on the label box.
      const x2 = Number(line.getAttribute('x2'));
      const y2 = Number(line.getAttribute('y2'));
      expect(x2 >= box.x0 - 0.1 && x2 <= box.x1 + 0.1 && y2 >= box.y0 - 0.1 && y2 <= box.y1 + 0.1, plate.id).toBe(true);
    });
  });
  // "Slice φ 0°" (DZ3-1): placed like the D labels, clear of every D label and plate, with a leader from the ring.
  const slice = document.querySelector<HTMLElement>('.hf-scene__label--slice')!;
  expect(slice.hidden).toBe(false);
  expect(slice).toHaveTextContent('Slice φ 0°');
  const sm = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(slice.style.transform)!;
  const sx = Number(sm[1]);
  const sy = Number(sm[2]);
  const sliceBox: Box = { x0: sx - SLICE_LABEL.width / 2, x1: sx + SLICE_LABEL.width / 2, y0: sy - SLICE_LABEL.height / 2, y1: sy + SLICE_LABEL.height / 2 };
  labels.forEach((l, k) => {
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(l.style.transform)!;
    expect(overlap(sliceBox, labelBox(Number(m[1]), Number(m[2]))), `slice label over ${geom.plates[k]!.id}'s label`).toBe(false);
    expect(overlap(sliceBox, pixelBox(geom.plates[k]!.fill.positions, project)), `slice label over ${geom.plates[k]!.id}`).toBe(false);
  });
  const sliceLeader = document.querySelector('.hf-scene__leader[data-slice]')!;
  expect(sliceLeader).not.toHaveAttribute('visibility');
  // It starts on the ring of plane 0 (φ 0°).
  const lx = Number(sliceLeader.querySelector('line')!.getAttribute('x1'));
  const ly = Number(sliceLeader.querySelector('line')!.getAttribute('y1'));
  const ringPx = Array.from({ length: 48 }, (_, i) => project([geom.rings[i * 3]!, geom.rings[i * 3 + 1]!, geom.rings[i * 3 + 2]!]));
  expect(Math.min(...ringPx.map((q) => Math.hypot(q.x - lx, q.y - ly)))).toBeLessThan(0.1);
  // The slider moves it: the label names the new plane.
  view.rerender(
    <HeatScene geom={geom} model={model} sim={sim} colorBy="temperature" ranges={ranges} showLines showArrows={false} sliceJ={9} theme="light" label="3D view" describedBy="sum" />,
  );
  expect(slice).toHaveTextContent('Slice φ 45°');
  // The silhouette outline is pushed for this view (≥ 1.5 px on the far side) before the frame is drawn.
  const outline = content.getObjectByName('lcfs outline') as THREE.Mesh;
  const cam = gl.frames.at(-1)!.camera;
  const offset = outlineOffset(Math.hypot(...cam), geom.extent, 400);
  expect(offset).toBeGreaterThan(OUTLINE.minOffset);
  const hull = outline.geometry.getAttribute('position');
  expect(Math.hypot(hull.getX(77) - geom.positions[231]!, hull.getY(77) - geom.positions[232]!, hull.getZ(77) - geom.positions[233]!)).toBeCloseTo(offset, 5);

  // Keyboard orbit and Reset view.
  const cam0 = gl.frames.at(-1)!.camera;
  fireEvent.keyDown(host, { key: 'ArrowLeft' });
  expect(gl.frames.at(-1)!.camera).not.toEqual(cam0);
  fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
  gl.frames.at(-1)!.camera.forEach((v, k) => expect(v).toBeCloseTo(cam0[k]!, 6));

  // A theme change rebuilds the content in the new theme: the outline follows it like every other material, and
  // every geometry and material of the old content is freed (HF3-3).
  const lightOutline = (outline.material as THREE.MeshBasicMaterial).color.getHexString();
  expect(lightOutline).toBe(hex(sceneTheme('light').outline));
  /** Every geometry and material of a content group, each with a counter of its 'dispose' events. */
  const watchDisposal = (g: THREE.Object3D) => {
    type Disposable = { addEventListener: (type: 'dispose', fn: () => void) => void };
    const freed = new Map<Disposable, number>();
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.geometry) return;
      for (const r of [m.geometry, ...(Array.isArray(m.material) ? m.material : [m.material])] as unknown as Disposable[]) {
        if (freed.has(r)) continue;
        freed.set(r, 0);
        r.addEventListener('dispose', () => freed.set(r, (freed.get(r) ?? 0) + 1));
      }
    });
    return freed;
  };
  const lightFreed = watchDisposal(content);
  // The LCFS, hull, 8 tubes and 8 casings, 8 plate meshes, 2 arrow and 2 slice meshes: geometry and material each.
  expect(lightFreed.size).toBe(2 * (2 + 16 + 8 + 2 + 2));
  view.rerender(
    <HeatScene geom={geom} model={model} sim={sim} colorBy="temperature" ranges={ranges} showLines showArrows={false} sliceJ={0} theme="dark" label="3D view" describedBy="sum" />,
  );
  const dark = (gl.frames.at(-1)!.scene as THREE.Scene).children[0] as THREE.Group;
  expect(dark).not.toBe(content);
  expect([...lightFreed.values()].filter((n) => n !== 1)).toEqual([]);
  expect((gl.frames.at(-1)!.scene as THREE.Scene).children).toEqual([dark]);
  const darkFreed = watchDisposal(dark);
  const darkOutline = dark.getObjectByName('lcfs outline') as THREE.Mesh;
  expect((darkOutline.material as THREE.MeshBasicMaterial).color.getHexString()).toBe(hex(sceneTheme('dark').outline));
  expect((darkOutline.material as THREE.MeshBasicMaterial).side).toBe(THREE.BackSide);
  expect(hex(sceneTheme('dark').outline)).not.toBe(lightOutline);
  expect(((dark.getObjectByName('D1 plate') as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHexString()).toBe(hex(sceneTheme('dark').diverter.fill));

  expect([...darkFreed.values()].every((n) => n === 0)).toBe(true);
  expect(sim.listenerCount).toBe(1);

  view.unmount();
  expect(gl.disposed).toBe(1);
  // Unmounting frees the current content too, and leaves no listener on the running model.
  expect([...darkFreed.values()].filter((n) => n !== 1)).toEqual([]);
  expect(sim.listenerCount).toBe(0);
  // After unmount, model changes draw nothing.
  const m = gl.frames.length;
  sim.advance(1);
  expect(gl.frames.length).toBe(m);
  vi.unstubAllGlobals();
});

test('H9 a plate behind the torus loses its label and leader, the others keep theirs (HF3-2)', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const sim = new Simulation(model, start);
  render(<HeatScene geom={geom} model={model} sim={sim} colorBy="temperature" ranges={ranges} showLines showArrows={false} sliceJ={0} theme="light" label="3D view" />);
  const host = screen.getByRole('img', { name: /^3D view\./ });
  await waitFor(() => expect(gl.frames.length).toBeGreaterThan(0));
  const labelOf = (id: string) => [...document.querySelectorAll<HTMLElement>('.hf-scene__label')].find((l) => l.textContent === id)!;
  const leaderOf = (id: string) => document.querySelector(`.hf-scene__leader[data-diverter="${id}"]`)!;
  const ids = geom.plates.map((p) => p.id);
  ids.forEach((id) => expect(labelOf(id).hidden, id).toBe(false));

  // Five steps down from the default view: a side view (elevation 2°) from φ −60°.
  for (let k = 0; k < 5; k++) fireEvent.keyDown(host, { key: 'ArrowDown' });
  const [cx, cy, cz] = gl.frames.at(-1)!.camera;
  expect((Math.asin(cz / Math.hypot(cx, cy, cz)) * 180) / Math.PI).toBeCloseTo(2, 6);
  // Which plates the torus hides from there, worked out here: a ray from the camera to the plate's outer end meets
  // the LCFS on the way (hits within 0.1 m of the end aside). That is D2, whose end still projects on screen.
  const cam = new THREE.PerspectiveCamera(CAMERA_FOV, 600 / 400, 0.1, 200);
  cam.position.set(cx, cy, cz);
  cam.up.set(0, 0, 1);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const lcfs = lcfsMesh();
  const behind = geom.plates.map((p) => {
    const end = new THREE.Vector3(...p.outerEnd);
    const d = end.clone().sub(cam.position);
    const hits = new THREE.Raycaster(cam.position.clone(), d.clone().normalize(), 0, d.length() - 0.1).intersectObject(lcfs);
    return hits.length > 0;
  });
  expect(behind).toEqual([false, true, false, false]);
  const d2 = new THREE.Vector3(...geom.plates[1]!.outerEnd).project(cam);
  expect(Math.abs(d2.x) < 1 && Math.abs(d2.y) < 1 && d2.z < 1).toBe(true);
  ids.forEach((id, k) => {
    expect(labelOf(id).hidden, id).toBe(behind[k]);
    if (behind[k]) expect(leaderOf(id)).toHaveAttribute('visibility', 'hidden');
    else expect(leaderOf(id)).not.toHaveAttribute('visibility');
  });

  // A model step alone does not move the camera: same labels.
  sim.advance(5);
  ids.forEach((id, k) => expect(labelOf(id).hidden, id).toBe(behind[k]));
  // Back to the default view: all four return.
  fireEvent.keyDown(host, { key: '0' });
  ids.forEach((id) => expect(labelOf(id).hidden, id).toBe(false));
  vi.unstubAllGlobals();
});

test('H9 the label boxes take their size from scene.ts LABEL and SLICE_LABEL, the numbers placement clears the plates with; heatfield.css sets none (HF3-4)', () => {
  const sim = new Simulation(model, start);
  render(<HeatScene geom={geom} model={model} sim={sim} colorBy="temperature" ranges={ranges} showLines showArrows={false} sliceJ={71} theme="light" label="3D view" />);
  const boxes = [...document.querySelectorAll<HTMLElement>('.hf-scene__label')];
  expect(boxes).toHaveLength(5);
  for (const b of boxes) {
    const size = b.classList.contains('hf-scene__label--slice') ? SLICE_LABEL : LABEL;
    expect(b.style.width).toBe(`${size.width}px`);
    expect(b.style.height).toBe(`${size.height}px`);
    // Centred on the point it is translated to.
    expect(b.style.marginLeft).toBe(`${-size.width / 2}px`);
    expect(b.style.marginTop).toBe(`${-size.height / 2}px`);
    // Its text fits at the xs font size (about 0.6 em per character, bold), inside the 1 px border.
    expect(b.textContent!.length * 0.6 * typeScale.xs[0] + 2, b.textContent!).toBeLessThanOrEqual(size.width);
  }
  expect(boxes.at(-1)).toHaveTextContent('Slice φ 355°');
  // No stylesheet rule can size the box apart from the placement.
  for (const sel of ['.hf-scene__label', '.hf-scene__label--slice']) {
    for (const r of rulesFor(CSS, sel)) {
      for (const prop of ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'margin', 'margin-left', 'margin-top', 'inset', 'left', 'top']) {
        if (prop === 'left' || prop === 'top') expect(r.decl[prop] ?? '0', `${sel} ${prop}`).toBe('0');
        else expect(r.decl[prop], `${sel} ${prop}`).toBeUndefined();
      }
    }
  }
  expect(rulesFor(CSS, '.hf-scene__label')[0]!.decl['font-size']).toBe('var(--lab-font-size-xs)');
});

test('H9 when WebGL cannot start, the scene says so and points at the text equivalents', async () => {
  gl.fail = true;
  const sim = new Simulation(model, start);
  render(<HeatScene geom={geom} model={model} sim={sim} colorBy="temperature" ranges={ranges} showLines showArrows={false} sliceJ={0} theme="light" label="3D view" />);
  const note = await screen.findByRole('note', { name: /3D view unavailable \(WebGL could not start\)/ });
  expect(note).toHaveTextContent('WebGL context could not be created');
  expect(note).toHaveTextContent('The text summary, the cross-section, the diverter table and the |B| chart carry the same information.');
  expect(gl.frames).toHaveLength(0);
});
