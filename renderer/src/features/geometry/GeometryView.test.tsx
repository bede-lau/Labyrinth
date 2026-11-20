import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { bmagColor, normalizeBmag, sceneTheme, themes } from '../../design';
import { geometryFixture } from './fixture';
import { GeometryView } from './GeometryView';
import {
  bmagChartSpec,
  buildSceneModel,
  cameraPosition,
  DEFAULT_ORBIT,
  float64Match,
  gridIndex,
  insetLayout,
  orbitForKey,
  surfaceTriangles,
  surfaceWire,
  tubeById,
  tubeMarkers,
} from './model';
import type { SceneModel } from './model';
import { checkGeometry, type GeometryArtifact } from './types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// WebGL and Plotly do not exist in jsdom: the adapters are replaced by recorders, and the
// data -> props logic they receive is what is tested.
const rec = vi.hoisted(() => ({ scene: [] as unknown[], chart: [] as unknown[] }));
vi.mock('./FluxScene', () => ({
  FluxScene: (p: { model: SceneModel; label: string }) => {
    rec.scene.push(p);
    return <div data-testid="scene" data-selected={p.model.selected} aria-label={p.label} role="img" />;
  },
}));
vi.mock('./PlotlyChart', () => ({
  PlotlyChart: (p: { data: { name: string }[]; ariaLabel: string; layout: unknown }) => {
    rec.chart.push(p);
    return <div data-testid="chart" role="img" aria-label={p.ariaLabel} data-series={p.data[0]?.name} />;
  },
}));

function serve(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}
const last = <T,>(a: unknown[]) => a[a.length - 1] as T;

beforeEach(() => {
  rec.scene.length = 0;
  rec.chart.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

test('G7 scene: gray closed surface (seam wrapped), selected tube coloured by |B|, other muted, start/centre/end markers', async () => {
  // Triangulation wraps both periodic indices: a closed torus with no seam.
  const nPhi = 8;
  const nTheta = 6;
  const tri = surfaceTriangles(nPhi, nTheta);
  const V = nPhi * nTheta;
  expect(tri.length).toBe(V * 6);
  expect(Math.max(...tri)).toBe(V - 1);
  expect(new Set(tri).size).toBe(V);
  const edges = new Map<string, number>();
  for (let i = 0; i < tri.length; i += 3) {
    const t = [tri[i]!, tri[i + 1]!, tri[i + 2]!];
    for (let k = 0; k < 3; k++) {
      const a = t[k]!;
      const b = t[(k + 1) % 3]!;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  // Every edge shared by exactly two triangles (no boundary), and Euler characteristic V - E + F = 0 (torus).
  expect([...edges.values()].every((c) => c === 2)).toBe(true);
  expect(V - edges.size + tri.length / 3).toBe(0);
  // The last phi row connects to row 0, and the last theta column to column 0.
  expect(edges.has(`${gridIndex(0, 0, nPhi, nTheta)}-${gridIndex(nPhi - 1, 0, nPhi, nTheta)}`)).toBe(true);
  expect(edges.has(`${gridIndex(0, 0, nPhi, nTheta)}-${gridIndex(0, nTheta - 1, nPhi, nTheta)}`)).toBe(true);
  const wire = surfaceWire(nPhi, nTheta, 1, 1);
  expect(wire.length / 2).toBe(2 * V); // every grid edge once, closed in both directions

  const g = geometryFixture(nPhi, nTheta);
  for (const theme of ['light', 'dark'] as const) {
    const st = sceneTheme(theme);
    const m = buildSceneModel(g, 'bean', theme);
    expect(m.surface.line).toBe(themes[theme].scene.surfaceLine); // gray context
    expect(m.surface.positions.length).toBe(3 * V);
    const bean = m.tubes.find((t) => t.id === 'bean')!;
    const tri2 = m.tubes.find((t) => t.id === 'triangular')!;
    expect(bean.selected).toBe(true);
    expect(bean.opacity).toBe(1);
    expect(bean.radius).toBeCloseTo(tri2.radius * st.selectedWidth);
    const beanTube = tubeById(g, 'bean');
    beanTube.samples.forEach((s, i) => {
      const want = bmagColor(normalizeBmag(s.bmag, beanTube.bmagRange), theme);
      want.forEach((v, k) => expect(bean.colors![i * 3 + k]).toBeCloseTo(v, 6));
    });
    expect(tri2.colors).toBeNull();
    expect(tri2.color).toBe(st.fieldLine.triangular);
    expect(tri2.opacity).toBe(st.unselectedOpacity);
    // Markers at the first sample, the θ* = 0 sample and the last sample of the selected tube.
    expect(m.markers.map((k) => k.kind)).toEqual(['start', 'centre', 'end']);
    const S = beanTube.samples;
    expect(m.markers[0]!.position).toEqual([S[0]!.x, S[0]!.y, S[0]!.z]);
    expect(m.markers[1]!.position).toEqual([S[4]!.x, S[4]!.y, S[4]!.z]);
    expect(S[4]!.thetaStar).toBeCloseTo(0);
    expect(m.markers[2]!.position).toEqual([S[8]!.x, S[8]!.y, S[8]!.z]);
    expect(m.markers.every((k) => k.color === st.fieldLine.bean && k.outline === st.markers.outline)).toBe(true);
  }
  // The committed artifact has the same shape: 150 × 48 surface, 129 samples, centre on θ* = 0.
  const real = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/geometry.json'), 'utf8')) as GeometryArtifact;
  expect(checkGeometry(real)).toBeNull();
  const rm = buildSceneModel(real, 'bean', 'light');
  expect(rm.surface.triangles.length).toBe(real.surface.nPhi * real.surface.nTheta * 6);
  expect(Math.max(...rm.surface.triangles)).toBe(real.surface.nPhi * real.surface.nTheta - 1);
  const realBean = tubeById(real, 'bean');
  expect(tubeMarkers(realBean).map((k) => k.index)).toEqual([0, 64, 128]);
  expect(realBean.samples[64]!.thetaStar).toBe(0);
  expect(checkGeometry({ ...real, surface: { ...real.surface, positions: real.surface.positions.slice(3) } })).toMatch(/surface\.positions has/);

  // Camera keyboard control.
  expect(orbitForKey(DEFAULT_ORBIT, 'ArrowRight')!.azimuth).toBeGreaterThan(DEFAULT_ORBIT.azimuth);
  expect(orbitForKey(DEFAULT_ORBIT, '+')!.distance).toBeLessThan(DEFAULT_ORBIT.distance);
  expect(orbitForKey(DEFAULT_ORBIT, 'x')).toBeNull();
  expect(Math.hypot(...cameraPosition(DEFAULT_ORBIT, 6))).toBeCloseTo(DEFAULT_ORBIT.distance * 6);

  // DOM: the scene gets the model, the |B| colour bar is always shown with its label and range.
  serve(g);
  render(<GeometryView />);
  await waitFor(() => expect(screen.getByTestId('scene')).toBeInTheDocument());
  expect(last<{ model: SceneModel }>(rec.scene).model.selected).toBe('bean');
  const bar = screen.getByRole('img', { name: /Colour bar: .*\|B\| \/ B_ref/ });
  expect(bar).toHaveTextContent('|B| / Bref');
  expect(within(bar).getByTestId('colorbar').getAttribute('style')).toMatch(/linear-gradient/);
  expect(screen.getByRole('list', { name: 'Scene key' })).toHaveTextContent(/start θ\* = −π.*centre θ\* = 0.*end θ\* = π/);
});

test('G8 bean/triangular selector is keyboard accessible and switches the scene, the |B| plot and the inset', async () => {
  const g = geometryFixture();
  serve(g);
  const user = userEvent.setup();
  render(<GeometryView />);
  const group = await screen.findByRole('radiogroup', { name: 'Field line' });
  const bean = within(group).getByRole('radio', { name: /Bean/ });
  expect(bean).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByTestId('scene')).toHaveAttribute('data-selected', 'bean');
  expect(screen.getByTestId('chart')).toHaveAttribute('data-series', expect.stringContaining('Bean'));
  expect(screen.getByRole('heading', { name: 'Cross-section at ζ = 0°' })).toBeInTheDocument();

  bean.focus();
  await user.keyboard('{ArrowRight}');
  const tri = within(group).getByRole('radio', { name: /Triangular/ });
  expect(tri).toHaveAttribute('aria-checked', 'true');
  expect(tri).toHaveFocus();
  expect(screen.getByTestId('scene')).toHaveAttribute('data-selected', 'triangular');
  expect(last<{ model: SceneModel }>(rec.scene).model.tubes.find((t) => t.selected)?.id).toBe('triangular');
  expect(screen.getByTestId('chart')).toHaveAttribute('data-series', expect.stringContaining('Triangular'));
  expect(screen.getByRole('heading', { name: 'Cross-section at ζ = 36°' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /Cross-section at ζ = 36°/ })).toBeInTheDocument();

  await user.keyboard('{ArrowLeft}');
  expect(screen.getByTestId('scene')).toHaveAttribute('data-selected', 'bean');
});

test('G9 cross-section inset (solid sampled surface, dashed boundary) and |B|(θ*) chart with units', async () => {
  const g = geometryFixture();
  const tube = tubeById(g, 'bean');
  // Inset geometry: equal aspect, every point inside the plot box, centre marker placed in data coordinates.
  const L = insetLayout(tube.crossSection, g.surface.boundary!.bean, { R: 6, Z: 0 }, { width: 320, height: 260, padLeft: 48, padBottom: 40, pad: 10 });
  const nums = (d: string) => [...d.matchAll(/(-?[0-9.]+),(-?[0-9.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  for (const [x, y] of [...nums(L.sampledPath), ...nums(L.boundaryPath!)]) {
    expect(x).toBeGreaterThanOrEqual(L.plot.x0);
    expect(x).toBeLessThanOrEqual(L.plot.x1);
    expect(y).toBeGreaterThanOrEqual(L.plot.y0);
    expect(y).toBeLessThanOrEqual(L.plot.y1);
  }
  const [p0] = nums(L.sampledPath);
  const [q0] = nums(L.boundaryPath!);
  // Both rings start at theta 0 (outboard): radii 0.5 vs 0.62 m differ by 0.12 m · scale pixels.
  expect(q0![0] - p0![0]).toBeCloseTo(0.12 * L.scale, 1);
  expect(L.centre.y).toBeCloseTo(p0![1], 1); // Z = 0 on the midplane
  expect(L.sampledPath.endsWith('Z')).toBe(true);

  // Chart spec: |B| vs θ*, units on both axes, start/centre/end markers.
  const spec = bmagChartSpec(tube, 'light');
  const layout = spec.layout as { xaxis: { title: { text: string } }; yaxis: { title: { text: string } } };
  expect(layout.xaxis.title.text).toBe('Field-line angle θ* (rad)');
  expect(layout.yaxis.title.text).toBe('Field strength |B| (B<sub>ref</sub>)');
  const line = spec.data[0] as { x: number[]; y: number[] };
  expect(line.x).toEqual(tube.samples.map((s) => s.thetaStar));
  expect(line.y).toEqual(tube.samples.map((s) => s.bmag));
  expect(spec.data.slice(1).map((d) => (d as { name: string }).name)).toEqual(['start', 'centre', 'end']);
  expect(spec.summary).toMatch(/^Bean \(ζ = 0°\): 9 samples over θ\* −3\.142 to 3\.142 rad\. \|B\| ranges from/);

  serve(g);
  render(<GeometryView />);
  const inset = await screen.findByRole('img', { name: /Cross-section at ζ = 0°.*R and Z in metres/ });
  expect(within(inset).getByTestId('inset-boundary')).toHaveAttribute('stroke-dasharray', '4 3');
  expect(within(inset).getByTestId('inset-sampled')).not.toHaveAttribute('stroke-dasharray');
  expect(inset).toHaveTextContent('Major radius R (m)');
  expect(inset).toHaveTextContent('Z (m)');
  const chart = screen.getByTestId('chart');
  expect(chart).toHaveAccessibleName(/\|B\| in units of B_ref against field-line angle θ\* in radians/);
  expect(screen.getByText(spec.summary)).toBeInTheDocument();
});

test('G10 validation panel: stella reference result, and acceptance-129 shown as BLOCKED with its reason, never passed', async () => {
  const g = geometryFixture();
  expect(float64Match(g.provenance.verification.details)).toEqual({ maxAbsError: 2.9e-13, samples: 25 });
  serve(g);
  render(<GeometryView />);
  const ref = (await screen.findByRole('heading', { name: 'Tracer vs stella saved geometry (ρ 0.7)' })).closest('section')!;
  expect(within(ref).getByText('Verified')).toBeInTheDocument();
  expect(ref).toHaveTextContent('All 25 saved samples agree to their printed 4 significant figures');
  expect(within(ref).getByRole('group', { name: 'Samples compared: 25' })).toBeInTheDocument();
  expect(within(ref).getByRole('group', { name: 'Max |Δ| in |B|: 0.000487 B ref' })).toBeInTheDocument();
  expect(within(ref).getByTestId('float64')).toHaveTextContent('max |Δ| in |B| 2.9 × 10−13 Bref over 25 samples');

  const acc = screen.getByTestId('acceptance129');
  expect(within(acc).getByRole('heading')).toHaveTextContent('PRD acceptance: bean |B| vs all 129 saved stella samples (ρ 0.8)');
  expect(acc.querySelector('.lab-pill[data-status="blocked"]')).toHaveTextContent('Blocked');
  expect(acc.querySelector('[data-status="passed"]')).toBeNull();
  expect(acc).not.toHaveTextContent(/Verified|passed|Match\b/);
  const note = within(acc).getByRole('note');
  expect(note).toHaveAccessibleName(/^Blocked:/);
  expect(note).toHaveTextContent('not in this repo or at the cited stella commit');
  expect(note).toHaveTextContent('To unblock: add the stella .geometry/.out.nc file holding the 129 samples to data/raw/.');

  // The outcome comes from the artifact: if it were failed, it would say failed, not blocked.
  const failed: GeometryArtifact = { ...g, validation: { ...g.validation, acceptance129: { outcome: 'failed', details: 'max error 2e-3' } } };
  serve(failed);
  const r2 = render(<GeometryView />);
  await waitFor(() => expect(r2.container.querySelector('[data-testid="acceptance129"] .lab-pill[data-status="failed"]')).not.toBeNull());

  // A missing artifact names the file instead of rendering blank.
  r2.unmount();
  serve({ error: 'gone' }, 404);
  render(<GeometryView />);
  expect(await screen.findByRole('heading', { name: 'Could not load artifacts/geometry.json' })).toBeInTheDocument();
});
