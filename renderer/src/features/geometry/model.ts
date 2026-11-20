// Pure data -> props logic for the geometry view. No Three.js or Plotly here, so jsdom can test it.
import {
  axisTitle,
  bmagColor,
  normalizeBmag,
  plotLayout,
  sceneTheme,
  seriesStyle,
  themes,
  type ThemeName,
} from '../../design';
import type { GeometryArtifact, Tube, TubeId, TubeSample } from './types';

// ---------------------------------------------------------------------------------------------
// Surface mesh
// ---------------------------------------------------------------------------------------------

/** Vertex index of grid point (iPhi, iTheta), wrapping both indices (row-major over phi, theta). */
export function gridIndex(iPhi: number, iTheta: number, nPhi: number, nTheta: number): number {
  const p = ((iPhi % nPhi) + nPhi) % nPhi;
  const t = ((iTheta % nTheta) + nTheta) % nTheta;
  return p * nTheta + t;
}

/**
 * Two triangles per grid cell, nPhi × nTheta cells: the positions have NO duplicated seam row or
 * column, so the last row/column connects back to index 0. The result is a closed torus.
 */
export function surfaceTriangles(nPhi: number, nTheta: number): Uint32Array {
  const out = new Uint32Array(nPhi * nTheta * 6);
  let k = 0;
  for (let p = 0; p < nPhi; p++) {
    for (let t = 0; t < nTheta; t++) {
      const a = gridIndex(p, t, nPhi, nTheta);
      const b = gridIndex(p + 1, t, nPhi, nTheta);
      const c = gridIndex(p + 1, t + 1, nPhi, nTheta);
      const d = gridIndex(p, t + 1, nPhi, nTheta);
      out[k++] = a;
      out[k++] = b;
      out[k++] = c;
      out[k++] = a;
      out[k++] = c;
      out[k++] = d;
    }
  }
  return out;
}

/**
 * Wireframe as index pairs: poloidal circles every `phiStride` toroidal steps and toroidal curves
 * every `thetaStride` poloidal steps, each closed across the seam.
 */
export function surfaceWire(nPhi: number, nTheta: number, phiStride = 3, thetaStride = 2): Uint32Array {
  const pairs: number[] = [];
  for (let p = 0; p < nPhi; p += phiStride)
    for (let t = 0; t < nTheta; t++) pairs.push(gridIndex(p, t, nPhi, nTheta), gridIndex(p, t + 1, nPhi, nTheta));
  for (let t = 0; t < nTheta; t += thetaStride)
    for (let p = 0; p < nPhi; p++) pairs.push(gridIndex(p, t, nPhi, nTheta), gridIndex(p + 1, t, nPhi, nTheta));
  return Uint32Array.from(pairs);
}

// ---------------------------------------------------------------------------------------------
// Tubes, colours and markers
// ---------------------------------------------------------------------------------------------

export function tubeById(g: GeometryArtifact, id: TubeId): Tube {
  const t = g.tubes.find((x) => x.id === id);
  if (!t) throw new Error(`artifacts/geometry.json has no "${id}" tube`);
  return t;
}

/** Per-sample sRGB (0–1) through the |B| colormap, normalised by the tube's bmagRange. */
export function sampleColors(tube: Tube, theme: ThemeName): Float32Array {
  const out = new Float32Array(tube.samples.length * 3);
  tube.samples.forEach((s, i) => {
    const [r, g, b] = bmagColor(normalizeBmag(s.bmag, tube.bmagRange), theme);
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  });
  return out;
}

export type MarkerKind = 'start' | 'centre' | 'end';

export interface MarkerSpec {
  kind: MarkerKind;
  sample: TubeSample;
  index: number;
}

/** Index of the sample nearest θ* = 0 (the tube is centred on the outboard midplane, D-010). */
export function centreIndex(tube: Tube): number {
  let best = 0;
  tube.samples.forEach((s, i) => {
    if (Math.abs(s.thetaStar) < Math.abs(tube.samples[best]!.thetaStar)) best = i;
  });
  return best;
}

export function tubeMarkers(tube: Tube): MarkerSpec[] {
  const last = tube.samples.length - 1;
  const c = centreIndex(tube);
  return [
    { kind: 'start', sample: tube.samples[0]!, index: 0 },
    { kind: 'centre', sample: tube.samples[c]!, index: c },
    { kind: 'end', sample: tube.samples[last]!, index: last },
  ];
}

export interface SceneTubeModel {
  id: TubeId;
  label: string;
  selected: boolean;
  /** xyz per sample (m). */
  points: Float32Array;
  /** sRGB per sample by |B| for the selected tube; null for the muted tube (identity colour). */
  colors: Float32Array | null;
  color: string;
  opacity: number;
  radius: number;
}

export interface SceneModel {
  selected: TubeId;
  background: string;
  surface: { positions: Float32Array; triangles: Uint32Array; wire: Uint32Array; line: string; fill: string; opacity: number };
  tubes: SceneTubeModel[];
  markers: { kind: MarkerKind; position: [number, number, number]; color: string; outline: string }[];
  /** Largest distance of the surface from the z axis (m), for framing the camera. */
  extent: number;
}

/** Base tube radius in metres (the surface minor radius is ~0.4 m at rho 0.8). */
export const TUBE_RADIUS = 0.028;

export function buildSceneModel(g: GeometryArtifact, selected: TubeId, theme: ThemeName): SceneModel {
  const st = sceneTheme(theme);
  const { nPhi, nTheta, positions } = g.surface;
  let extent = 0;
  for (let i = 0; i < positions.length; i += 3) extent = Math.max(extent, Math.hypot(positions[i]!, positions[i + 1]!));
  const tubes = (['bean', 'triangular'] as const).map((id): SceneTubeModel => {
    const tube = tubeById(g, id);
    const isSel = id === selected;
    const pts = new Float32Array(tube.samples.length * 3);
    tube.samples.forEach((s, i) => pts.set([s.x, s.y, s.z], i * 3));
    return {
      id,
      label: tube.label,
      selected: isSel,
      points: pts,
      colors: isSel ? sampleColors(tube, theme) : null,
      color: st.fieldLine[id],
      opacity: isSel ? 1 : st.unselectedOpacity,
      radius: isSel ? TUBE_RADIUS * st.selectedWidth : TUBE_RADIUS,
    };
  });
  const sel = tubeById(g, selected);
  return {
    selected,
    background: st.background,
    surface: {
      positions: Float32Array.from(positions),
      triangles: surfaceTriangles(nPhi, nTheta),
      wire: surfaceWire(nPhi, nTheta),
      line: st.surface.line,
      fill: st.surface.fill,
      opacity: st.surface.opacity,
    },
    tubes,
    markers: tubeMarkers(sel).map((m) => ({
      kind: m.kind,
      position: [m.sample.x, m.sample.y, m.sample.z],
      color: st.fieldLine[selected],
      outline: st.markers.outline,
    })),
    extent,
  };
}

// ---------------------------------------------------------------------------------------------
// Camera (simple orbit about the z axis; keyboard + pointer drive it)
// ---------------------------------------------------------------------------------------------

export interface Orbit {
  /** Radians about +z, measured from +x. */
  azimuth: number;
  /** Radians above the z = 0 plane. */
  elevation: number;
  /** Distance from the origin as a multiple of the surface extent. */
  distance: number;
}

/** Default: looking from between the two tube centres (ζ 0° and 36°), from above. */
export const DEFAULT_ORBIT: Orbit = { azimuth: (-72 * Math.PI) / 180, elevation: (40 * Math.PI) / 180, distance: 3.3 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const STEP = (10 * Math.PI) / 180;

export function clampOrbit(o: Orbit): Orbit {
  return { azimuth: o.azimuth, elevation: clamp(o.elevation, -1.45, 1.45), distance: clamp(o.distance, 1.3, 6) };
}

/** Keyboard control. Returns null for keys the scene does not handle. */
export function orbitForKey(o: Orbit, key: string): Orbit | null {
  switch (key) {
    case 'ArrowLeft':
      return clampOrbit({ ...o, azimuth: o.azimuth - STEP });
    case 'ArrowRight':
      return clampOrbit({ ...o, azimuth: o.azimuth + STEP });
    case 'ArrowUp':
      return clampOrbit({ ...o, elevation: o.elevation + STEP });
    case 'ArrowDown':
      return clampOrbit({ ...o, elevation: o.elevation - STEP });
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

/**
 * Camera position for an orbit. The framing assumes a landscape canvas (aspect ≥ 1.7); narrower
 * canvases move the camera back so the whole torus still fits horizontally.
 */
export function cameraPosition(o: Orbit, extent: number, aspect = 2): [number, number, number] {
  const d = o.distance * extent * Math.max(1, 1.5 / Math.max(aspect, 0.3));
  return [d * Math.cos(o.elevation) * Math.cos(o.azimuth), d * Math.cos(o.elevation) * Math.sin(o.azimuth), d * Math.sin(o.elevation)];
}

// ---------------------------------------------------------------------------------------------
// |B|(θ*) chart
// ---------------------------------------------------------------------------------------------

const PI_TICKS = { vals: [-Math.PI, -Math.PI / 2, 0, Math.PI / 2, Math.PI], text: ['−π', '−π/2', '0', 'π/2', 'π'] };
const MARKER_SYMBOL: Record<MarkerKind, string> = { start: 'square', centre: 'circle', end: 'triangle-up' };
const MARKER_LABEL: Record<MarkerKind, string> = { start: 'start', centre: 'centre', end: 'end' };

export interface ChartSpec {
  data: Record<string, unknown>[];
  layout: Record<string, unknown>;
  ariaLabel: string;
  summary: string;
}

export function bmagChartSpec(tube: Tube, theme: ThemeName): ChartSpec {
  const style = seriesStyle(tube.id, theme);
  const t = themes[theme];
  const xs = tube.samples.map((s) => s.thetaStar);
  const ys = tube.samples.map((s) => s.bmag);
  const markers = tubeMarkers(tube);
  const hover = 'θ* %{x:.3f} rad<br>|B| %{y:.4f} B<sub>ref</sub><extra></extra>';
  const data = [
    {
      type: 'scatter',
      mode: 'lines',
      x: xs,
      y: ys,
      name: `${tube.label}: |B| at ${tube.samples.length} samples`,
      line: style.line,
      hovertemplate: hover,
    },
    ...markers.map((m) => ({
      type: 'scatter',
      mode: 'markers',
      x: [m.sample.thetaStar],
      y: [m.sample.bmag],
      name: MARKER_LABEL[m.kind],
      showlegend: false,
      marker: { symbol: MARKER_SYMBOL[m.kind], size: 9, color: style.line.color, line: { color: t.scene.markerOutline, width: 1.5 } },
      hovertemplate: `${MARKER_LABEL[m.kind]} · ${hover}`,
    })),
  ];
  const layout = plotLayout(theme, {
    height: 300,
    margin: { l: 64, r: 16, t: 28, b: 48 },
    hovermode: 'closest',
    xaxis: {
      title: { text: axisTitle('Field-line angle θ*', 'rad') },
      tickvals: PI_TICKS.vals,
      ticktext: PI_TICKS.text,
      range: [-Math.PI * 1.03, Math.PI * 1.03],
    },
    yaxis: { title: { text: axisTitle('Field strength |B|', 'B_ref') }, tickformat: '.2f' },
  });
  let iMin = 0;
  let iMax = 0;
  ys.forEach((y, i) => {
    if (y < ys[iMin]!) iMin = i;
    if (y > ys[iMax]!) iMax = i;
  });
  const f = (v: number, d: number) => v.toFixed(d).replace('-', '−');
  const ariaLabel = `Line chart: field strength |B| in units of B_ref against field-line angle θ* in radians, ${tube.label} tube`;
  const summary =
    `${tube.label}: ${tube.samples.length} samples over θ* ${f(xs[0]!, 3)} to ${f(xs[xs.length - 1]!, 3)} rad. ` +
    `|B| ranges from ${f(ys[iMin]!, 4)} B_ref (θ* ${f(xs[iMin]!, 3)} rad) to ${f(ys[iMax]!, 4)} B_ref (θ* ${f(xs[iMax]!, 3)} rad); ` +
    `centre (θ* 0) ${f(ys[centreIndex(tube)]!, 4)} B_ref.`;
  return { data, layout: layout as unknown as Record<string, unknown>, ariaLabel, summary };
}

// ---------------------------------------------------------------------------------------------
// Cross-section inset (SVG)
// ---------------------------------------------------------------------------------------------

export interface Tick {
  value: number;
  pos: number;
}

export interface InsetLayout {
  width: number;
  height: number;
  plot: { x0: number; y0: number; x1: number; y1: number };
  sampledPath: string;
  boundaryPath: string | null;
  centre: { x: number; y: number };
  xTicks: Tick[];
  yTicks: Tick[];
  /** Pixels per metre (identical on both axes: equal aspect). */
  scale: number;
}

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

export function insetLayout(
  cs: { R: number[]; Z: number[] },
  boundary: { R: number[]; Z: number[] } | undefined,
  centre: { R: number; Z: number },
  size: { width: number; height: number; padLeft: number; padBottom: number; pad: number },
): InsetLayout {
  const all = { R: [...cs.R, ...(boundary?.R ?? [])], Z: [...cs.Z, ...(boundary?.Z ?? [])] };
  const rMin = Math.min(...all.R);
  const rMax = Math.max(...all.R);
  const zMin = Math.min(...all.Z);
  const zMax = Math.max(...all.Z);
  const plot = { x0: size.padLeft, y0: size.pad, x1: size.width - size.pad, y1: size.height - size.padBottom };
  const w = plot.x1 - plot.x0;
  const h = plot.y1 - plot.y0;
  const margin = 0.06;
  const spanR = (rMax - rMin) * (1 + 2 * margin);
  const spanZ = (zMax - zMin) * (1 + 2 * margin);
  const scale = Math.min(w / spanR, h / spanZ);
  const rMid = (rMin + rMax) / 2;
  const zMid = (zMin + zMax) / 2;
  const cx = plot.x0 + w / 2;
  const cy = plot.y0 + h / 2;
  const X = (R: number) => cx + (R - rMid) * scale;
  const Y = (Z: number) => cy - (Z - zMid) * scale;
  const path = (p: { R: number[]; Z: number[] }) =>
    p.R.map((R, i) => `${i === 0 ? 'M' : 'L'}${X(R).toFixed(2)},${Y(p.Z[i]!).toFixed(2)}`).join(' ') + ' Z';
  const rLo = rMid - w / 2 / scale;
  const rHi = rMid + w / 2 / scale;
  const zLo = zMid - h / 2 / scale;
  const zHi = zMid + h / 2 / scale;
  const step = niceStep(Math.min(rHi - rLo, zHi - zLo), 4);
  return {
    width: size.width,
    height: size.height,
    plot,
    sampledPath: path(cs),
    boundaryPath: boundary ? path(boundary) : null,
    centre: { x: X(centre.R), y: Y(centre.Z) },
    xTicks: ticks(rLo, rHi, step).map((value) => ({ value, pos: X(value) })),
    yTicks: ticks(zLo, zHi, step).map((value) => ({ value, pos: Y(value) })),
    scale,
  };
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

/**
 * The float64 comparison against stella's out.nc is only recorded in the provenance prose
 * ("vs stella's float64 out.nc bmag: max |error| 2.9e-13 over 25 samples"). Read it if present.
 */
export function float64Match(details: string): { maxAbsError: number; samples: number } | null {
  const m = /float64[^:]*:\s*max \|error\|\s*([0-9.]+(?:e[-+]?\d+)?)\s*over\s*(\d+)\s*samples/i.exec(details);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? { maxAbsError: v, samples: Number(m[2]) } : null;
}

/** Split a blocked-verification sentence into its reason and the "Unblock: …" step. */
export function splitUnblock(details: string): { reason: string; unblock: string | null } {
  const i = details.search(/\bUnblock:/);
  if (i < 0) return { reason: details.trim(), unblock: null };
  return { reason: details.slice(0, i).trim(), unblock: details.slice(i + 'Unblock:'.length).trim() };
}
