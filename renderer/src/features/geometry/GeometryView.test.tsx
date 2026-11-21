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
const colorBarTicks = () => [...document.querySelectorAll('.geo-colorbar__ticks > span')].map((s) => s.textContent);
/** Same box as CrossSectionInset.tsx draws into. */
const INSET = { width: 320, height: 260, padLeft: 48, padBottom: 40, pad: 10 };
const pathPoints = (d: string) => [...d.matchAll(/(-?[0-9.]+),(-?[0-9.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);

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
    // The fill is the gray surface token too — never a tube or series colour (unsampled stays gray).
    expect(m.surface.fill).toBe(themes[theme].scene.surfaceFill);
    expect(m.surface.opacity).toBe(themes[theme].scene.surfaceOpacity);
    expect(Object.values(themes[theme].series)).not.toContain(m.surface.fill);
    expect(Object.values(themes[theme].series)).not.toContain(m.surface.line);
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
  // D-023: the float64 comparison is a contract field now, and the 129-sample acceptance now uses saved Modal data.
  expect(real.validation.float64Reference).toMatchObject({ samplesCompared: 25, tolerance: 1e-10, allWithinTolerance: true });
  expect(real.validation.float64Reference.maxAbsError).toBeLessThan(1e-12);
  expect(real.validation.acceptance129.outcome).toBe('passed');

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
  // The scale is labelled with numbers: low, middle, high of the selected tube's |B| range, in that order.
  const [lo, hi] = tubeById(g, 'bean').bmagRange;
  expect(lo).toBeLessThan(hi);
  expect(colorBarTicks()).toEqual([lo.toFixed(3), ((lo + hi) / 2).toFixed(3), hi.toFixed(3)]);
  expect(bar).toHaveAccessibleName(`Colour bar: Bean (ζ = 0°) coloured by |B| / B_ref from ${lo.toFixed(3)} (dark) to ${hi.toFixed(3)} (light)`);
  expect(screen.getByRole('list', { name: 'Scene key' })).toHaveTextContent(/start θ\* = −π.*centre θ\* = 0.*end θ\* = π/);
});

test('G8 bean/triangular selector is keyboard accessible and switches the scene, the |B| plot and the inset', async () => {
  const g = geometryFixture();
  serve(g);
  const user = userEvent.setup();
  render(<GeometryView />);
  const group = await screen.findByRole('group', { name: 'W7-X GPU assignments' });
  const bean = within(group).getByRole('button', { name: /Bean/ });
  expect(bean).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('scene')).toHaveAttribute('data-selected', 'bean');
  expect(screen.getByTestId('chart')).toHaveAttribute('data-series', expect.stringContaining('Bean'));
  expect(screen.getByRole('heading', { name: 'Cross-section at ζ = 0°' })).toBeInTheDocument();

  bean.focus();
  await user.keyboard('{Tab}{Enter}');
  const tri = within(group).getByRole('button', { name: /Triangular/ });
  expect(tri).toHaveAttribute('aria-pressed', 'true');
  expect(tri).toHaveFocus();
  expect(screen.getByTestId('scene')).toHaveAttribute('data-selected', 'triangular');
  expect(last<{ model: SceneModel }>(rec.scene).model.tubes.find((t) => t.selected)?.id).toBe('triangular');
  expect(screen.getByTestId('chart')).toHaveAttribute('data-series', expect.stringContaining('Triangular'));
  expect(screen.getByRole('heading', { name: 'Cross-section at ζ = 36°' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /Cross-section at ζ = 36°/ })).toBeInTheDocument();

  // Everything that depends on the tube follows the switch, not just the headings: the colour-bar range,
  // both inset curves and the centre marker are the triangular tube's (the fixture tubes differ in all of them).
  const beanTube = tubeById(g, 'bean');
  const triTube = tubeById(g, 'triangular');
  expect(triTube.bmagRange).not.toEqual(beanTube.bmagRange);
  const [lo, hi] = triTube.bmagRange;
  expect(colorBarTicks()).toEqual([lo.toFixed(3), ((lo + hi) / 2).toFixed(3), hi.toFixed(3)]);
  expect(screen.getByRole('img', { name: /^Colour bar:/ })).toHaveAccessibleName(
    `Colour bar: Triangular (ζ = 36°) coloured by |B| / B_ref from ${lo.toFixed(3)} (dark) to ${hi.toFixed(3)} (light)`,
  );
  const triCentre = tubeMarkers(triTube)[1]!.sample;
  const wantTri = insetLayout(triTube.crossSection, g.surface.boundary!.triangular, { R: triCentre.R, Z: triCentre.Z }, INSET);
  const wantBean = insetLayout(beanTube.crossSection, g.surface.boundary!.bean, { R: 6, Z: 0 }, INSET);
  expect(wantTri.boundaryPath).not.toBe(wantBean.boundaryPath);
  expect(wantTri.sampledPath).not.toBe(wantBean.sampledPath);
  const inset = screen.getByRole('img', { name: /Cross-section at ζ = 36°/ });
  expect(within(inset).getByTestId('inset-boundary')).toHaveAttribute('d', wantTri.boundaryPath!);
  expect(within(inset).getByTestId('inset-sampled')).toHaveAttribute('d', wantTri.sampledPath);
  const dot = inset.querySelector('circle.geo-inset__centre--triangular')!;
  expect(Number(dot.getAttribute('cx'))).toBeCloseTo(wantTri.centre.x, 6);
  expect(Number(dot.getAttribute('cy'))).toBeCloseTo(wantTri.centre.y, 6);
  expect(screen.getByRole('list', { name: 'Scene key' })).toHaveTextContent('Bean (ζ = 0°), muted');

  await user.keyboard('{Shift>}{Tab}{/Shift}{Enter}');
  expect(screen.getByTestId('scene')).toHaveAttribute('data-selected', 'bean');
  const [blo, bhi] = beanTube.bmagRange;
  expect(colorBarTicks()).toEqual([blo.toFixed(3), ((blo + bhi) / 2).toFixed(3), bhi.toFixed(3)]);
  expect(within(screen.getByRole('img', { name: /Cross-section at ζ = 0°/ })).getByTestId('inset-boundary')).toHaveAttribute('d', wantBean.boundaryPath!);
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
  // Equal R and Z scale (the panel says so): a metre is the same number of pixels on both axes, for a
  // cross-section that is not a circle as well. The triangular fixture section is 0.84 m wide, 1.16 m tall.
  const tri = tubeById(g, 'triangular');
  const T = insetLayout(tri.crossSection, g.surface.boundary!.triangular, { R: 5.4, Z: 0 }, INSET);
  const pts = pathPoints(T.sampledPath);
  const { R, Z } = tri.crossSection;
  expect(pts).toHaveLength(R.length);
  for (let i = 1; i < pts.length; i++) {
    expect(pts[i]![0] - pts[0]![0]).toBeCloseTo((R[i]! - R[0]!) * T.scale, 1);
    expect(pts[0]![1] - pts[i]![1]).toBeCloseTo((Z[i]! - Z[0]!) * T.scale, 1); // screen y runs downward
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const spanR = Math.max(...R) - Math.min(...R);
  const spanZ = Math.max(...Z) - Math.min(...Z);
  expect(spanZ).toBeGreaterThan(spanR * 1.2);
  expect((Math.max(...ys) - Math.min(...ys)) / (Math.max(...xs) - Math.min(...xs))).toBeCloseTo(spanZ / spanR, 2);

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
  // The solid curve is the sampled surface and the dashed one the plasma boundary — not the other way round.
  const beanCentre = tubeMarkers(tube)[1]!.sample;
  const drawn = insetLayout(tube.crossSection, g.surface.boundary!.bean, { R: beanCentre.R, Z: beanCentre.Z }, INSET);
  expect(drawn.sampledPath).not.toBe(drawn.boundaryPath);
  expect(within(inset).getByTestId('inset-sampled')).toHaveAttribute('d', drawn.sampledPath);
  expect(within(inset).getByTestId('inset-boundary')).toHaveAttribute('d', drawn.boundaryPath!);
  expect(inset).toHaveAccessibleDescription(/Solid line: the sampled flux surface.*Dashed line: the plasma boundary/);
  expect(inset).toHaveTextContent('Major radius R (m)');
  expect(inset).toHaveTextContent('Z (m)');
  const chart = screen.getByTestId('chart');
  expect(chart).toHaveAccessibleName(/\|B\| in units of B_ref against field-line angle θ\* in radians/);
  expect(screen.queryByText(spec.summary)).toBeNull();
});

test('geometry retains verification status and omits the validation report', async () => {
  const g = geometryFixture();
  serve(g);
  render(<GeometryView />);
  expect(await screen.findByTestId('geo-verdict')).toHaveTextContent('129-sample acceptance blocked');
  expect(screen.queryByTestId('acceptance129')).toBeNull();
  expect(document.querySelector('.geo-layout__scene footer')).toBeNull();
});

test('G10 honesty labels: both checks named above the fold, provenance badge, no replay eyebrow, kind from the artifact, no live pill', async () => {
  const g = geometryFixture();
  serve(g);
  const first = render(<GeometryView />);
  const scene = await screen.findByRole('region', { name: /Field lines on the ρ = 0\.8 flux surface/ });
  // DS-8: the two verdicts are named in the first panel, each from its own artifact field.
  const header = scene.querySelector('.lab-panel__header')!;
  const verdicts = [...header.querySelectorAll('[data-testid="geo-verdict"] .lab-pill')].map((p) => `${p.getAttribute('data-status')}:${p.textContent}`);
  expect(verdicts).toEqual(['passed:ρ 0.7 check verified', 'blocked:129-sample acceptance blocked']);
  // Provenance record on the result panel; the compact view keeps the source on demand.
  expect(within(scene).getByRole('button', { name: 'Provenance of field-line geometry: Derived, Blocked' })).toBeInTheDocument();
  expect(scene.querySelector('.lab-panel__eyebrow')).toBeNull();
  expect(scene).not.toHaveTextContent(/· live|· Live|\bLIVE\b/);
  // Every panel that shows numbers carries the artifact's provenance kind.
  const chart = screen.getByRole('region', { name: /Field strength along the line/ });
  const inset = screen.getByRole('region', { name: /Cross-section at ζ = 0°/ });
  expect([...chart.querySelectorAll('.lab-pill')].map((p) => p.getAttribute('data-status'))).toEqual(['derived']);
  expect([...inset.querySelectorAll('.lab-pill')].map((p) => p.getAttribute('data-status'))).toEqual(['derived']);
  expect(document.querySelector('[data-status="live"]')).toBeNull();
  first.unmount();

  // The kind is read from the artifact, and the acceptance from validation.acceptance129, never from the
  // provenance record: a record that says "passed" leaves the acceptance blocked, with the artifact's reason.
  const other: GeometryArtifact = {
    ...g,
    provenance: { ...g.provenance, kind: 'archive', verification: { outcome: 'passed', details: 'synthetic record' } },
    validation: {
      ...g.validation,
      acceptance129: { outcome: 'blocked', details: 'Synthetic reason: the samples are elsewhere. Unblock: fetch them from the archive.' },
    },
  };
  serve(other);
  const second = render(<GeometryView />);
  const chart2 = await screen.findByRole('region', { name: /Field strength along the line/ });
  expect(chart2.querySelector('.lab-pill')).toHaveAttribute('data-status', 'archive');
  expect(screen.getByRole('region', { name: /Cross-section at ζ = 0°/ }).querySelector('.lab-pill')).toHaveAttribute('data-status', 'archive');
  const scene2 = screen.getByRole('region', { name: /Field lines on the ρ = 0\.8 flux surface/ });
  expect([...scene2.querySelectorAll('[data-testid="geo-verdict"] .lab-pill')].map((p) => `${p.getAttribute('data-status')}:${p.textContent}`)).toEqual([
    'passed:ρ 0.7 check verified',
    'blocked:129-sample acceptance blocked',
  ]);
  expect(screen.queryByTestId('acceptance129')).toBeNull();
  second.unmount();

  // An artifact is replayed evidence: a "live" provenance kind cannot put a LIVE pill on the chart or the inset.
  serve({ ...g, provenance: { ...g.provenance, kind: 'live' } });
  render(<GeometryView />);
  const chart3 = await screen.findByRole('region', { name: /Field strength along the line/ });
  expect(chart3.querySelector('.lab-pill')).toHaveAttribute('data-status', 'replay');
  expect(chart3.querySelector('[data-status="live"]')).toBeNull();
  expect(screen.getByRole('region', { name: /Cross-section at ζ = 0°/ }).querySelector('[data-status="live"]')).toBeNull();
});

test('DS-15 the cross-section inset is capped at its drawn size, so its labels keep their type size', () => {
  const css = readFileSync(resolve(__dirname, 'geometry.css'), 'utf8');
  expect(css).toMatch(/\.geo-inset__svg\s*\{[^}]*max-width:\s*320px/);
});
