// Thin Three.js adapter: turns a SceneModel (model.ts, tested) into a WebGL scene. Three is loaded
// lazily so it stays out of the initial bundle (lazyLoad.test.ts guards the import site). jsdom has no
// WebGL context, so FluxScene.test.tsx runs this file against real three with only WebGLRenderer
// replaced; buildContent is exported for that test and takes the three module as an argument.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Callout } from '../../design';
import { DEFAULT_ORBIT, cameraPosition, clampOrbit, orbitForKey, type Orbit, type SceneModel } from './model';

type Three = typeof import('three');

interface Handle {
  THREE: Three;
  renderer: import('three').WebGLRenderer;
  scene: import('three').Scene;
  camera: import('three').PerspectiveCamera;
  content: import('three').Group;
  dispose: () => void;
}

export interface FluxSceneProps {
  model: SceneModel;
  /** Accessible name of the scene. */
  label: string;
  /** id of the element holding the text summary of the scene. */
  describedBy?: string;
}

const MARKER_SIZE = 0.16;

/**
 * The scene content for a model: gray surface (fill + wireframe, context only), the two field-line
 * tubes (selected: per-vertex |B| colours; other: muted identity colour) and start/centre/end markers
 * with outline halos. Pure with respect to WebGL: it only builds geometries and materials.
 */
export function buildContent(THREE: Three, model: SceneModel): import('three').Group {
  const group = new THREE.Group();
  const pos = new THREE.BufferAttribute(model.surface.positions, 3);

  // Gray surface (context, never data): faint fill that occludes the far side, plus a wireframe.
  const fillGeom = new THREE.BufferGeometry();
  fillGeom.setAttribute('position', pos);
  fillGeom.setIndex(new THREE.BufferAttribute(model.surface.triangles, 1));
  const fill = new THREE.Mesh(
    fillGeom,
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(model.surface.fill),
      transparent: true,
      opacity: model.surface.opacity,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  fill.renderOrder = 1;
  group.add(fill);
  const wireGeom = new THREE.BufferGeometry();
  wireGeom.setAttribute('position', pos);
  wireGeom.setIndex(new THREE.BufferAttribute(model.surface.wire, 1));
  const wire = new THREE.LineSegments(wireGeom, new THREE.LineBasicMaterial({ color: new THREE.Color(model.surface.line) }));
  wire.renderOrder = 2;
  group.add(wire);

  // Field lines: the selected tube coloured by |B| per sample, the other muted in its identity colour.
  for (const t of model.tubes) {
    const n = t.points.length / 3;
    const pts = Array.from({ length: n }, (_, i) => new THREE.Vector3(t.points[i * 3], t.points[i * 3 + 1], t.points[i * 3 + 2]));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const segments = (n - 1) * 4;
    const radial = 8;
    const geom = new THREE.TubeGeometry(curve, segments, t.radius, radial, false);
    let material: import('three').MeshBasicMaterial;
    if (t.colors) {
      const colors = new Float32Array((segments + 1) * (radial + 1) * 3);
      const c = new THREE.Color();
      for (let s = 0; s <= segments; s++) {
        // TubeGeometry samples by arc length; map back to the sample index to pick |B|.
        const f = curve.getUtoTmapping(s / segments, 0) * (n - 1);
        const i0 = Math.min(n - 2, Math.floor(f));
        const w = f - i0;
        const r = t.colors[i0 * 3]! * (1 - w) + t.colors[(i0 + 1) * 3]! * w;
        const g = t.colors[i0 * 3 + 1]! * (1 - w) + t.colors[(i0 + 1) * 3 + 1]! * w;
        const b = t.colors[i0 * 3 + 2]! * (1 - w) + t.colors[(i0 + 1) * 3 + 2]! * w;
        c.setRGB(r, g, b, THREE.SRGBColorSpace);
        for (let k = 0; k <= radial; k++) colors.set([c.r, c.g, c.b], (s * (radial + 1) + k) * 3);
      }
      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      material = new THREE.MeshBasicMaterial({ vertexColors: true });
    } else {
      material = new THREE.MeshBasicMaterial({ color: new THREE.Color(t.color), transparent: true, opacity: t.opacity, depthWrite: false });
    }
    const mesh = new THREE.Mesh(geom, material);
    mesh.name = 'tube-' + t.id;
    mesh.renderOrder = t.selected ? 0 : 3;
    group.add(mesh);
  }

  // Start ■ / centre ● / end ▲ with an outline halo.
  for (const m of model.markers) {
    const shape =
      m.kind === 'start'
        ? new THREE.BoxGeometry(MARKER_SIZE * 1.6, MARKER_SIZE * 1.6, MARKER_SIZE * 1.6)
        : m.kind === 'centre'
          ? new THREE.SphereGeometry(MARKER_SIZE, 16, 12)
          : new THREE.ConeGeometry(MARKER_SIZE * 1.1, MARKER_SIZE * 2.2, 3);
    const body = new THREE.Mesh(shape, new THREE.MeshBasicMaterial({ color: new THREE.Color(m.color) }));
    const halo = new THREE.Mesh(shape, new THREE.MeshBasicMaterial({ color: new THREE.Color(m.outline), side: THREE.BackSide }));
    halo.scale.setScalar(1.45);
    if (m.kind === 'end') {
      body.rotation.x = Math.PI / 2;
      halo.rotation.x = Math.PI / 2;
    }
    for (const o of [body, halo]) {
      o.position.set(...m.position);
      o.renderOrder = 4;
      group.add(o);
    }
  }
  return group;
}

function disposeGroup(g: import('three').Group) {
  g.traverse((o) => {
    const mesh = o as import('three').Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material as import('three').Material | import('three').Material[] | undefined;
    (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((m) => m.dispose());
  });
}

export function FluxScene({ model, label, describedBy }: FluxSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handle = useRef<Handle | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orbit, setOrbit] = useState<Orbit>(DEFAULT_ORBIT);
  const drag = useRef<{ x: number; y: number; orbit: Orbit } | null>(null);

  const renderRef = useRef<() => void>(() => {});
  const render = () => {
    const h = handle.current;
    if (!h) return;
    const [x, y, z] = cameraPosition(orbit, model.extent, h.camera.aspect);
    h.camera.position.set(x, y, z);
    h.camera.up.set(0, 0, 1);
    h.camera.lookAt(0, 0, 0);
    h.renderer.render(h.scene, h.camera);
  };
  renderRef.current = render;

  // Mount: load three, create the renderer and keep it sized to the host.
  useEffect(() => {
    let disposed = false;
    let ro: ResizeObserver | null = null;
    import('three')
      .then((THREE) => {
        const el = hostRef.current;
        if (disposed || !el) return;
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
        renderer.setSize(el.clientWidth || 600, el.clientHeight || 400);
        renderer.domElement.setAttribute('aria-hidden', 'true');
        el.replaceChildren(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(30, (el.clientWidth || 600) / (el.clientHeight || 400), 0.1, 200);
        const content = new THREE.Group();
        scene.add(content);
        handle.current = {
          THREE,
          renderer,
          scene,
          camera,
          content,
          dispose: () => {
            disposeGroup(handle.current?.content ?? content);
            renderer.dispose();
          },
        };
        ro = new ResizeObserver(() => {
          const w = el.clientWidth;
          const hgt = el.clientHeight;
          if (!w || !hgt) return;
          renderer.setSize(w, hgt);
          camera.aspect = w / hgt;
          camera.updateProjectionMatrix();
          renderRef.current();
        });
        ro.observe(el);
        setReady(true);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      disposed = true;
      ro?.disconnect();
      handle.current?.dispose();
      handle.current = null;
    };
  }, []);

  // Model (tube selection, theme): rebuild the scene content.
  useEffect(() => {
    const h = handle.current;
    if (!ready || !h) return;
    h.scene.background = new h.THREE.Color(model.background);
    h.scene.remove(h.content);
    disposeGroup(h.content);
    h.content = buildContent(h.THREE, model);
    h.scene.add(h.content);
    render();
  }, [ready, model]);

  // Camera.
  useEffect(() => {
    if (ready) render();
  }, [ready, orbit]);

  const onKeyDown = (e: KeyboardEvent) => {
    const next = orbitForKey(orbit, e.key);
    if (!next) return;
    e.preventDefault();
    setOrbit(next);
  };
  const onPointerDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, orbit };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setOrbit(clampOrbit({ ...d.orbit, azimuth: d.orbit.azimuth - (e.clientX - d.x) * 0.008, elevation: d.orbit.elevation + (e.clientY - d.y) * 0.008 }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="geo-scene">
      <div
        ref={hostRef}
        className="geo-scene__canvas"
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
      />
      <button type="button" className="geo-scene__reset" onClick={() => setOrbit(DEFAULT_ORBIT)}>
        Reset view
      </button>
      {error && (
        <Callout tone="warn" title="3D view unavailable (WebGL could not start)">
          {error}. The cross-section, the |B| chart and the text summary below carry the same information.
        </Callout>
      )}
    </div>
  );
}
