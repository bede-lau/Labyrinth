// G7 with the real Three.js library: the adapter is NOT mocked here. Only WebGLRenderer is replaced
// (jsdom has no WebGL context); every geometry, material, colour and group is built by real three.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as THREE from 'three';
import { bmagColor, normalizeBmag, sceneTheme, themes } from '../../design';
import { geometryFixture } from './fixture';
import { FluxScene, buildContent } from './FluxScene';
import { buildSceneModel, gridIndex, surfaceTriangles, surfaceWire, tubeById, tubeMarkers } from './model';

const gl = vi.hoisted(() => ({
  fail: false,
  created: 0,
  disposed: 0,
  frames: [] as { scene: unknown; camera: [number, number, number] }[],
}));

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

const hex = (c: string) => new THREE.Color(c).getHexString();
const N_PHI = 8;
const N_THETA = 6;
const V = N_PHI * N_THETA;

beforeEach(() => {
  gl.fail = false;
  gl.created = 0;
  gl.disposed = 0;
  gl.frames.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

test('G7 buildContent turns the scene model into real Three.js objects: closed gray surface, |B|-coloured selected tube, muted other tube, six marker meshes', () => {
  const g = geometryFixture(N_PHI, N_THETA);
  for (const theme of ['light', 'dark'] as const) {
    const st = sceneTheme(theme);
    const model = buildSceneModel(g, 'bean', theme);
    const group = buildContent(THREE, model);
    // fill + wireframe, two tubes, three markers each with an outline halo.
    expect(group.children).toHaveLength(2 + 2 + 6);
    const [fill, wire, beanMesh, triMesh, ...markers] = group.children as THREE.Mesh[];

    // Surface: every grid vertex once (no duplicated seam), two triangles per cell, closed across both seams.
    const fillPos = fill!.geometry.getAttribute('position');
    expect(fillPos.count).toBe(V);
    expect(Array.from(fillPos.array)).toEqual(Array.from(model.surface.positions));
    const index = Array.from(fill!.geometry.getIndex()!.array);
    expect(index).toHaveLength(V * 6);
    expect(index).toEqual(Array.from(surfaceTriangles(N_PHI, N_THETA)));
    const triangles = Array.from({ length: index.length / 3 }, (_, i) => index.slice(i * 3, i * 3 + 3));
    const joined = (a: number, b: number) => triangles.some((t) => t.includes(a) && t.includes(b));
    expect(joined(gridIndex(N_PHI - 1, 0, N_PHI, N_THETA), gridIndex(0, 0, N_PHI, N_THETA))).toBe(true); // last φ row -> row 0
    expect(joined(gridIndex(0, N_THETA - 1, N_PHI, N_THETA), gridIndex(0, 0, N_PHI, N_THETA))).toBe(true); // last θ column -> column 0
    expect(Math.max(...index)).toBe(V - 1);

    // Gray = context, never data: the fill and the wireframe use the surface tokens, never a tube or series colour.
    const fillMat = fill!.material as THREE.MeshBasicMaterial;
    expect(fillMat.color.getHexString()).toBe(hex(themes[theme].scene.surfaceFill));
    expect(fillMat.vertexColors).toBe(false);
    expect(fillMat.transparent).toBe(true);
    expect(fillMat.opacity).toBe(themes[theme].scene.surfaceOpacity);
    const series = Object.values(themes[theme].series).map(hex);
    expect(series).not.toContain(fillMat.color.getHexString());
    expect((wire as unknown as THREE.LineSegments).isLineSegments).toBe(true);
    const wireMat = wire!.material as unknown as THREE.LineBasicMaterial;
    expect(wireMat.color.getHexString()).toBe(hex(themes[theme].scene.surfaceLine));
    expect(series).not.toContain(wireMat.color.getHexString());
    expect(Array.from(wire!.geometry.getIndex()!.array)).toEqual(Array.from(surfaceWire(N_PHI, N_THETA)));
    expect(wire!.geometry.getAttribute('position').count).toBe(V);

    // Selected tube: per-vertex colours through the |B| map; first and last rings carry the first and last sample.
    const bean = tubeById(g, 'bean');
    const beanMat = beanMesh!.material as THREE.MeshBasicMaterial;
    expect(beanMat.vertexColors).toBe(true);
    const colors = beanMesh!.geometry.getAttribute('color');
    expect(colors.count).toBe(beanMesh!.geometry.getAttribute('position').count);
    const want = (i: number) => {
      const [r, gg, b] = bmagColor(normalizeBmag(bean.samples[i]!.bmag, bean.bmagRange), theme);
      return new THREE.Color().setRGB(r, gg, b, THREE.SRGBColorSpace);
    };
    const at = (v: number) => [colors.getX(v), colors.getY(v), colors.getZ(v)];
    const first = want(0);
    const last = want(bean.samples.length - 1);
    at(0).forEach((c, k) => expect(c).toBeCloseTo([first.r, first.g, first.b][k]!, 5));
    at(colors.count - 1).forEach((c, k) => expect(c).toBeCloseTo([last.r, last.g, last.b][k]!, 5));
    const distinct = new Set(Array.from({ length: colors.count }, (_, v) => at(v).map((c) => c.toFixed(3)).join(',')));
    expect(distinct.size).toBeGreaterThan(8); // a gradient along the line, not one flat colour

    // Other tube: its identity colour, muted, no per-vertex colours.
    const triMat = triMesh!.material as THREE.MeshBasicMaterial;
    expect(triMesh!.geometry.getAttribute('color')).toBeUndefined();
    expect(triMat.vertexColors).toBe(false);
    expect(triMat.color.getHexString()).toBe(hex(st.fieldLine.triangular));
    expect(triMat.transparent).toBe(true);
    expect(triMat.opacity).toBe(st.unselectedOpacity);

    // Markers: start ■, centre ●, end ▲ at the first, θ* = 0 and last sample of the selected tube, each with a halo.
    expect(markers).toHaveLength(6);
    expect(markers.map((m) => m.geometry.type)).toEqual([
      'BoxGeometry',
      'BoxGeometry',
      'SphereGeometry',
      'SphereGeometry',
      'ConeGeometry',
      'ConeGeometry',
    ]);
    const spots = tubeMarkers(bean).map((k) => [k.sample.x, k.sample.y, k.sample.z]);
    markers.forEach((m, i) => {
      const p = spots[Math.floor(i / 2)]!;
      [m.position.x, m.position.y, m.position.z].forEach((c, k) => expect(c).toBeCloseTo(p[k]!, 6));
      const mat = m.material as THREE.MeshBasicMaterial;
      expect(mat.color.getHexString()).toBe(hex(i % 2 === 0 ? st.fieldLine.bean : st.markers.outline));
      expect(mat.side).toBe(i % 2 === 0 ? THREE.FrontSide : THREE.BackSide);
    });
  }

  // Selecting the other tube moves the |B| colours to it.
  const other = buildContent(THREE, buildSceneModel(g, 'triangular', 'light'));
  const [, , b2, t2] = other.children as THREE.Mesh[];
  expect((b2!.material as THREE.MeshBasicMaterial).vertexColors).toBe(false);
  expect(b2!.geometry.getAttribute('color')).toBeUndefined();
  expect((t2!.material as THREE.MeshBasicMaterial).vertexColors).toBe(true);
  expect(t2!.geometry.getAttribute('color').count).toBeGreaterThan(0);
});

test('G7 FluxScene mounts the model through three, rebuilds it on selection, answers the keyboard and cleans up', async () => {
  const g = geometryFixture(N_PHI, N_THETA);
  const bean = buildSceneModel(g, 'bean', 'light');
  const view = render(<FluxScene model={bean} label="3D view of the Bean field line" describedBy="scene-summary" />);
  const host = screen.getByRole('img', { name: '3D view of the Bean field line. Arrow keys rotate, plus and minus zoom, 0 resets the view.' });
  expect(host).toHaveAttribute('aria-describedby', 'scene-summary');
  expect(host).toHaveAttribute('tabindex', '0');
  await waitFor(() => expect(gl.frames.length).toBeGreaterThan(0));
  expect(gl.created).toBe(1);
  // The canvas is decoration for assistive technology: the labelled host carries the name.
  expect(host.querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');

  const content = (frame: { scene: unknown }) => (frame.scene as THREE.Scene).children[0] as THREE.Group;
  const selectedTube = (frame: { scene: unknown }) =>
    (content(frame).children as THREE.Mesh[]).slice(2, 4).map((m) => (m.material as THREE.MeshBasicMaterial).vertexColors);
  const frame0 = gl.frames.at(-1)!;
  expect(((frame0.scene as THREE.Scene).background as THREE.Color).getHexString()).toBe(hex(bean.background));
  expect(content(frame0).children).toHaveLength(10);
  expect(selectedTube(frame0)).toEqual([true, false]);

  // Keyboard: arrows orbit the camera, 0 puts it back.
  host.focus();
  fireEvent.keyDown(host, { key: 'ArrowRight' });
  await waitFor(() => expect(gl.frames.at(-1)!.camera).not.toEqual(frame0.camera));
  const moved = gl.frames.at(-1)!.camera;
  expect(Math.hypot(...moved)).toBeCloseTo(Math.hypot(...frame0.camera), 6); // rotated, same distance
  fireEvent.keyDown(host, { key: '+' });
  await waitFor(() => expect(Math.hypot(...gl.frames.at(-1)!.camera)).toBeLessThan(Math.hypot(...moved) - 1e-6));
  fireEvent.keyDown(host, { key: '0' });
  await waitFor(() => gl.frames.at(-1)!.camera.forEach((c, k) => expect(c).toBeCloseTo(frame0.camera[k]!, 6)));
  const before = gl.frames.length;
  fireEvent.keyDown(host, { key: 'x' }); // not a scene key: nothing is redrawn
  expect(gl.frames.length).toBe(before);
  fireEvent.keyDown(host, { key: 'ArrowUp' });
  fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
  await waitFor(() => gl.frames.at(-1)!.camera.forEach((c, k) => expect(c).toBeCloseTo(frame0.camera[k]!, 6)));

  // A new model (tube selection) rebuilds the content inside the same renderer.
  view.rerender(<FluxScene model={buildSceneModel(g, 'triangular', 'light')} label="3D view of the Triangular field line" />);
  await waitFor(() => expect(selectedTube(gl.frames.at(-1)!)).toEqual([false, true]));
  expect(gl.created).toBe(1);
  expect(screen.queryByRole('note')).toBeNull();

  view.unmount();
  expect(gl.disposed).toBe(1);
});

test('G7 FluxScene says so when WebGL cannot start, and points at the text equivalents', async () => {
  gl.fail = true;
  render(<FluxScene model={buildSceneModel(geometryFixture(), 'bean', 'light')} label="3D view" />);
  const note = await screen.findByRole('note', { name: /3D view unavailable \(WebGL could not start\)/ });
  expect(note).toHaveTextContent('WebGL context could not be created');
  expect(note).toHaveTextContent('The cross-section, the |B| chart and the text summary below carry the same information.');
  expect(gl.frames).toHaveLength(0);
  expect(screen.getByRole('img', { name: /^3D view\./ })).toBeInTheDocument();
});
