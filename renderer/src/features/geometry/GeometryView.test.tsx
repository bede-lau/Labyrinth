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
  tracerPassed,
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
  // D-023: the float64 comparison is a contract field now, and the 129-sample acceptance is blocked by contract.
  expect(real.validation.float64Reference).toMatchObject({ samplesCompared: 25, tolerance: 1e-10, allWithinTolerance: true });
  expect(real.validation.float64Reference.maxAbsError).toBeLessThan(1e-12);
  expect(real.validation.acceptance129.outcome).toBe('blocked');

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

  await user.keyboard('{ArrowLeft}');
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
  expect(screen.getByText(spec.summary)).toBeInTheDocument();
});

test('G10 validation panel: stella reference result, and acceptance-129 shown as BLOCKED with its reason, never passed', async () => {
  const g = geometryFixture();
  serve(g);
  const first = render(<GeometryView />);
  const ref = (await screen.findByRole('heading', { name: 'Tracer vs stella saved geometry (ρ 0.7)' })).closest('section')!;
  expect(within(ref).getByText('Verified')).toBeInTheDocument();
  expect(ref).toHaveTextContent('All 25 saved samples agree to their printed 4 significant figures');
  expect(within(ref).getByRole('group', { name: 'Samples compared: 25' })).toBeInTheDocument();
  expect(within(ref).getByRole('group', { name: 'Max |Δ| in |B|: 0.000487 B ref' })).toBeInTheDocument();
  // FB-5: the float64 comparison is validation.float64Reference (rounded up, hence "≤"), not parsed prose.
  expect(within(ref).getByTestId('float64')).toHaveTextContent(
    'Against stella’s float64 output (out.nc): max |Δ| in |B| ≤ 3.0 × 10−13 Bref, relative ≤ 3.0 × 10−13, over 25 samples. Tolerance 1.0 × 10−10 Bref: every sample is within it.',
  );
  expect(within(within(ref).getByTestId('float64')).getByRole('link', { name: g.validation.float64Reference.source.label })).toHaveAttribute(
    'href',
    'https://example.org/stella/out.nc',
  );

  const acc = screen.getByTestId('acceptance129');
  expect(within(acc).getByRole('heading')).toHaveTextContent('PRD acceptance: bean |B| vs all 129 saved stella samples (ρ 0.8)');
  expect(acc.querySelector('.lab-pill[data-status="blocked"]')).toHaveTextContent('Blocked');
  expect(acc.querySelector('[data-status="passed"]')).toBeNull();
  expect(acc).not.toHaveTextContent(/Verified|passed|Match\b/);
  const note = within(acc).getByRole('note');
  expect(note).toHaveAccessibleName(/^Blocked:/);
  expect(note).toHaveTextContent('not in this repo or at the cited stella commit');
  expect(note).toHaveTextContent('To unblock: add the stella .geometry/.out.nc file holding the 129 samples to data/raw/.');
  first.unmount();

  // D-023: the contract fixes the acceptance at "blocked". An artifact claiming it passed (or failed) is
  // refused and named, never drawn with a "Verified" acceptance pill.
  for (const outcome of ['passed', 'failed'] as const) {
    const bad = { ...g, validation: { ...g.validation, acceptance129: { outcome, details: 'max error 2e-3' } } } as unknown as GeometryArtifact;
    expect(checkGeometry(bad)).toBe(
      `validation.acceptance129.outcome is "${outcome}"; the contract fixes it at "blocked" until the 129 stella samples exist (D-007, D-023)`,
    );
    serve(bad);
    const r = render(<GeometryView />);
    expect(await screen.findByRole('heading', { name: 'Could not load artifacts/geometry.json' })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`acceptance129\\.outcome is "${outcome}"`))).toBeInTheDocument();
    expect(document.querySelector('.lab-pill[data-status="passed"], [data-testid="acceptance129"]')).toBeNull();
    r.unmount();
  }

  // A missing artifact names the file instead of rendering blank.
  serve({ error: 'gone' }, 404);
  render(<GeometryView />);
  expect(await screen.findByRole('heading', { name: 'Could not load artifacts/geometry.json' })).toBeInTheDocument();
});

test('G10 the tracer check follows the artifact: a failing stella reference is shown as Failed, never as Verified', async () => {
  const g = geometryFixture();
  const bad: GeometryArtifact = {
    ...g,
    validation: { ...g.validation, stellaReference: { ...g.validation.stellaReference, allWithinPrintedPrecision: false, maxAbsError: 0.0021 } },
  };
  serve(bad);
  render(<GeometryView />);
  const ref = (await screen.findByRole('heading', { name: 'Tracer vs stella saved geometry (ρ 0.7)' })).closest('section')!;
  expect(ref.querySelector('.lab-pill')).toHaveAttribute('data-status', 'failed');
  expect(ref.querySelector('.lab-pill')).toHaveTextContent('Failed');
  expect(within(ref).queryByText('Verified')).toBeNull();
  expect(ref).toHaveTextContent('Not every sample agrees to the printed 4 significant figures.');
  expect(ref).not.toHaveTextContent(/All 25 saved samples agree/);
  expect(within(ref).getByRole('group', { name: 'Max |Δ| in |B|: 0.002100 B ref' })).toBeInTheDocument();
  // The verdict above the fold says the same thing.
  const scene = screen.getByRole('region', { name: /Field lines on the ρ = 0\.8 flux surface/ });
  expect(within(scene).getByText('ρ 0.7 check failed').closest('.lab-pill')).toHaveAttribute('data-status', 'failed');
  expect(within(scene).queryByText('ρ 0.7 check verified')).toBeNull();
  expect(document.querySelector('.lab-pill[data-status="passed"]')).toBeNull();
});

test('G10 honesty labels: both checks named above the fold, provenance badge, replay eyebrow, kind from the artifact, no live pill', async () => {
  const g = geometryFixture();
  serve(g);
  const first = render(<GeometryView />);
  const scene = await screen.findByRole('region', { name: /Field lines on the ρ = 0\.8 flux surface/ });
  // DS-8: the two verdicts are named in the first panel, each from its own artifact field.
  const header = scene.querySelector('.lab-panel__header')!;
  const verdicts = [...header.querySelectorAll('[data-testid="geo-verdict"] .lab-pill')].map((p) => `${p.getAttribute('data-status')}:${p.textContent}`);
  expect(verdicts).toEqual(['passed:ρ 0.7 check verified', 'blocked:129-sample acceptance blocked']);
  // Provenance record on the result panel; the view is a replay and says so.
  expect(within(scene).getByRole('button', { name: 'Provenance of field-line geometry: Derived, Blocked' })).toBeInTheDocument();
  expect(scene).toHaveTextContent(/^Locate the tubes · replay/);
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
  const acc = within(screen.getByTestId('acceptance129')).getByRole('note');
  expect(acc).toHaveTextContent('Synthetic reason: the samples are elsewhere.');
  expect(acc).toHaveTextContent('To unblock: fetch them from the archive.');
  expect(screen.getByTestId('acceptance129').querySelector('.lab-pill')).toHaveAttribute('data-status', 'blocked');
  second.unmount();

  // An artifact is replayed evidence: a "live" provenance kind cannot put a LIVE pill on the chart or the inset.
  serve({ ...g, provenance: { ...g.provenance, kind: 'live' } });
  render(<GeometryView />);
  const chart3 = await screen.findByRole('region', { name: /Field strength along the line/ });
  expect(chart3.querySelector('.lab-pill')).toHaveAttribute('data-status', 'replay');
  expect(chart3.querySelector('[data-status="live"]')).toBeNull();
  expect(screen.getByRole('region', { name: /Cross-section at ζ = 0°/ }).querySelector('[data-status="live"]')).toBeNull();
});

test('FF-6 the scene footer links the equilibrium source only when it is a web address; a repository path is named, not linked', async () => {
  const g = geometryFixture();
  serve(g);
  const first = render(<GeometryView />);
  const scene = await screen.findByRole('region', { name: /Field lines on the ρ = 0\.8 flux surface/ });
  expect(within(scene).getByRole('link', { name: 'VMEC' })).toHaveAttribute('href', 'https://example.org/vmec');
  first.unmount();

  serve({ ...g, equilibrium: { ...g.equilibrium, source: { ...g.equilibrium.source, label: 'VMEC wout', url: 'data/raw/wout_w7x_kjm.nc' } } });
  render(<GeometryView />);
  const scene2 = await screen.findByRole('region', { name: /Field lines on the ρ = 0\.8 flux surface/ });
  expect(within(scene2).queryByRole('link', { name: /VMEC/ })).toBeNull();
  expect(document.querySelectorAll('a[href="data/raw/wout_w7x_kjm.nc"]')).toHaveLength(0);
  expect(within(scene2).getByTestId('equilibrium-source')).toHaveTextContent('VMEC wout data/raw/wout_w7x_kjm.nc');
  expect(scene2).toHaveTextContent(/Equilibrium: VMEC wout data\/raw\/wout_w7x_kjm\.nc sha256 /);
});

test('FB-5 the float64 check is validation.float64Reference: its numbers, its verdict, its source; the prose is not read', async () => {
  const g = geometryFixture();
  // Prose that the old parser read, now contradicting the field: the field wins, the prose is never parsed.
  const failing: GeometryArtifact = {
    ...g,
    provenance: { ...g.provenance, verification: { outcome: 'blocked', details: "vs stella's float64 out.nc bmag: max |error| 2.9e-13 over 25 samples" } },
    validation: {
      ...g.validation,
      float64Reference: {
        samplesCompared: 24,
        tolerance: 1e-11,
        maxAbsError: 2.4e-9,
        maxRelError: 1.9e-9,
        allWithinTolerance: false,
        source: { label: 'out.nc copy', url: 'data/raw/stella_test2_vmec_geometry.out.nc', sha256: 'c'.repeat(64) },
      },
    },
  };
  serve(failing);
  const first = render(<GeometryView />);
  const ref = (await screen.findByRole('heading', { name: 'Tracer vs stella saved geometry (ρ 0.7)' })).closest('section')!;
  const f64 = within(ref).getByTestId('float64');
  expect(f64).toHaveTextContent(
    'Against stella’s float64 output (out.nc): max |Δ| in |B| ≤ 2.4 × 10−9 Bref, relative ≤ 1.9 × 10−9, over 24 samples. Tolerance 1.0 × 10−11 Bref: NOT every sample is within it.',
  );
  expect(f64).not.toHaveTextContent(/2\.9 × 10−13|: every sample is within it\./);
  expect(f64).toHaveAttribute('data-within', 'false');
  // A repository path is named, never linked (a relative href would open the app shell).
  expect(within(f64).queryByRole('link')).toBeNull();
  expect(f64).toHaveTextContent('Reference: out.nc copy data/raw/stella_test2_vmec_geometry.out.nc sha256 cccccccccc…');
  // The tracer check passes only when both comparisons of the rho 0.7 run pass: here it fails, above the fold too.
  expect(ref.querySelector('.lab-pill')).toHaveAttribute('data-status', 'failed');
  expect(ref).toHaveTextContent('All 25 saved samples agree to their printed 4 significant figures');
  const scene = screen.getByRole('region', { name: /Field lines on the ρ = 0\.8 flux surface/ });
  expect(within(scene).getByText('ρ 0.7 check failed').closest('.lab-pill')).toHaveAttribute('data-status', 'failed');
  expect(document.querySelector('.lab-pill[data-status="passed"]')).toBeNull();
  first.unmount();

  expect(tracerPassed(g.validation)).toBe(true);
  expect(tracerPassed(failing.validation)).toBe(false);
  expect(tracerPassed({ ...g.validation, stellaReference: { ...g.validation.stellaReference, allWithinPrintedPrecision: false } })).toBe(false);

  // An artifact from before D-023 (no float64Reference) is named, not half-drawn.
  const rest: Partial<GeometryArtifact['validation']> = { ...g.validation };
  delete rest.float64Reference;
  const old = { ...g, validation: rest } as unknown as GeometryArtifact;
  expect(checkGeometry(old)).toBe('validation block is incomplete');
  serve(old);
  render(<GeometryView />);
  expect(await screen.findByRole('heading', { name: 'Could not load artifacts/geometry.json' })).toBeInTheDocument();
});

test('DS-15 the cross-section inset is capped at its drawn size, so its labels keep their type size', () => {
  const css = readFileSync(resolve(__dirname, 'geometry.css'), 'utf8');
  expect(css).toMatch(/\.geo-inset__svg\s*\{[^}]*max-width:\s*320px/);
});
