import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FixtureCheckData } from '../../design';
import { backing, fixtureUnit, otherFixtures, spatialBacking } from './model';
import { planeAngle, planeRange, ringLayout, shortestDelta } from './ring';
import { GEOMETRY_LABEL, SpatialView } from './SpatialView';
import { checkSpatial, type SpatialArtifact } from './types';

// The committed artifact is the fixture (data only; read from disk, served through fetch).
const artifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/spatial.json'), 'utf8')) as SpatialArtifact;
const clone = (): SpatialArtifact => JSON.parse(JSON.stringify(artifact)) as SpatialArtifact;
const fx = (a: SpatialArtifact, id: string): FixtureCheckData => a.fixtures.find((f) => f.id === id)!;
const SPEEDUP = /^GPU speedup over CPU \(CPU mean \/ GPU mean\): /;
const RUNS = /^Controlled runs that passed the reference \(\d of \d\): /;

function serve(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}
afterEach(() => vi.unstubAllGlobals());

const pills = (root: ParentNode = document) =>
  [...root.querySelectorAll('.lab-pill')].map((p) => `${p.getAttribute('data-status')}:${p.textContent}`);
const panel = (name: string | RegExp) => screen.getByRole('region', { name });

test('S5 ring of 6 toroidal planes coloured by rank, exchange arrows both ways, CPU field-solve node, "Dommaschk geometry — not W7-X"', async () => {
  expect(checkSpatial(artifact)).toBeNull();
  // Layout logic: plane ownership, one rank per half, arrows take the short way round.
  const L = ringLayout(artifact);
  expect(L.nodes.map((n) => `${n.plane}:${n.rank}`)).toEqual(['1:0', '2:0', '3:0', '4:1', '5:1', '6:1']);
  expect(L.nodes.filter((n) => n.rank === 0).every((n) => n.x > L.cx)).toBe(true);
  expect(L.nodes.filter((n) => n.rank === 1).every((n) => n.x < L.cx)).toBe(true);
  expect(shortestDelta(planeAngle(6, 6), planeAngle(1, 6))).toBeCloseTo(Math.PI / 3); // 6 -> 1 wraps clockwise
  expect(shortestDelta(planeAngle(4, 6), planeAngle(3, 6))).toBeCloseTo(-Math.PI / 3);
  expect(L.arrows.map((a) => `${a.fromPlane}->${a.toPlane}:${a.track}`)).toEqual(['3->4:outer', '4->3:inner', '6->1:inner', '1->6:outer']);
  // Sweep flag follows the direction: 3->4 and 6->1 clockwise (1), the reverse anticlockwise (0).
  const sweep = (d: string) => d.split(' ')[4];
  expect(L.arrows.map((a) => sweep(a.d))).toEqual(['1', '0', '1', '0']);
  expect(planeRange([1, 2, 3])).toBe('1–3');

  serve(artifact);
  render(<SpatialView />);
  const ring = await screen.findByRole('img', { name: /Ring of 6 toroidal planes on the Dommaschk geometry, coloured by MPI rank/ });
  const planes = ring.querySelectorAll('[data-plane]');
  expect(planes).toHaveLength(6);
  expect([...planes].map((p) => `${p.getAttribute('data-plane')}:${p.getAttribute('class')}`)).toEqual([
    '1:sp-node sp-rank--0',
    '2:sp-node sp-rank--0',
    '3:sp-node sp-rank--0',
    '4:sp-node sp-rank--1',
    '5:sp-node sp-rank--1',
    '6:sp-node sp-rank--1',
  ]);
  // Rank is also encoded by shape, not colour alone.
  expect(ring.querySelectorAll('[data-rank="0"] circle')).toHaveLength(3);
  expect(ring.querySelectorAll('[data-rank="1"] rect')).toHaveLength(3);
  const arrows = [...ring.querySelectorAll('[data-exchange]')];
  expect(arrows.map((a) => a.getAttribute('data-exchange'))).toEqual(['3->4', '4->3', '6->1', '1->6']);
  expect(arrows.every((a) => a.getAttribute('marker-end')?.startsWith('url(#'))).toBe(true);
  expect(ring).toHaveTextContent('planes 3 ↔ 4');
  expect(ring).toHaveTextContent('planes 6 ↔ 1');
  expect(within(ring).getByTestId('cpu-node')).toHaveTextContent('Field solveCPU');
  expect(ring).toHaveTextContent('Rank 0 · GPU 0');
  expect(ring).toHaveTextContent('Rank 1 · GPU 1');
  // Text alternative for the diagram.
  expect(ring).toHaveAccessibleDescription(/Rank 0 on GPU 0 owns planes 1–3\. Rank 1 on GPU 1 owns planes 4–6\..*field solve runs on the CPU/);
  expect(screen.getByRole('list', { name: 'Diagram key' })).toHaveTextContent('Rank 0 on GPU 0: planes 1–3');
  // The geometry label is visible and explicit.
  expect(GEOMETRY_LABEL).toBe('Dommaschk geometry — not W7-X');
  expect(screen.getByTestId('geometry-label')).toHaveTextContent('Dommaschk geometry — not W7-X');
  expect(screen.getByRole('heading', { level: 2, name: 'GENE-X on Dommaschk geometry — not W7-X' })).toBeInTheDocument();

  // DS-20: the two ranks must not borrow the stella / GENE series colours (they would read as those codes).
  const css = readFileSync(resolve(__dirname, 'spatial.css'), 'utf8');
  expect(css).not.toMatch(/--lab-series-(stella|gene|gx)/i);
  expect(css).toMatch(/\.sp-rank--0\s*\{[^}]*--rank:\s*var\(--lab-color-/);
  expect(css).toMatch(/\.sp-rank--1\s*\{[^}]*--rank:\s*var\(--lab-color-/);
});

test('S6 timing CPU 184.69 s vs GPU 145.44 s (1.27×), run tally 4/4, provenance PRD-reported / blocked, independence note', async () => {
  // D-023: the speedup check, the run tally check and the two means are the artifact's own fixtures.
  expect(artifact.fixtures.map((f) => f.id)).toEqual(['speedup', 'controlled-runs-passed', 'cpu-mean-s', 'gpu-mean-s']);
  expect(fx(artifact, 'speedup')).toMatchObject({ claimed: 1.27, computed: 1.269871, printedDecimals: 2, matches: true, basis: 'arithmetic' });

  serve(artifact);
  render(<SpatialView />);
  const timing = await screen.findByTestId('timing');
  expect(within(timing).getByRole('group', { name: 'CPU mean: 184.69 s' })).toBeInTheDocument();
  expect(within(timing).getByRole('group', { name: 'GPU mean: 145.44 s' })).toBeInTheDocument();
  // Only the division is redone here, on two PRD-reported means: the artifact says basis "arithmetic", so it
  // reads "Arithmetic consistent", not the "Match" of a value recomputed from data.
  const checks = screen.getByTestId('timing-checks');
  const speed = within(checks).getByRole('group', { name: SPEEDUP });
  expect(speed).toHaveAccessibleName('GPU speedup over CPU (CPU mean / GPU mean): Arithmetic consistent. Claimed 1.27, computed 1.27, difference 0.00');
  expect(speed).toHaveAttribute('data-basis', 'arithmetic');
  expect(speed).toHaveAttribute('data-outcome', 'match');
  expect(within(speed).queryByText('Match')).toBeNull();
  expect(speed).toHaveTextContent('184.69 s / 145.44 s = 1.26987; only the division is redone, both means are PRD-reported.');
  // The two means are PRD figures this repo cannot recompute: shown as such, from their fixtures.
  expect(within(checks).getByRole('group', { name: 'CPU mean wall-clock per run: Not recomputable. Claimed 184.69 s, computed value not available' })).toBeInTheDocument();
  expect(within(checks).getByRole('group', { name: 'GPU mean wall-clock per run: Not recomputable. Claimed 145.44 s, computed value not available' })).toBeInTheDocument();
  expect(within(screen.getByTestId('tally')).getByRole('group', { name: 'Passed the reference: 4 of 4 runs' })).toBeInTheDocument();
  expect(within(screen.getByTestId('runs-check')).getByRole('group', { name: RUNS })).toHaveAccessibleName(
    'Controlled runs that passed the reference (4 of 4): Not recomputable. Claimed 4, computed value not available',
  );
  expect(screen.queryByRole('region', { name: 'Other PRD checks' })).toBeNull();

  // Provenance: PRD-reported + Blocked, never "Verified" for this replay.
  const badge = screen.getByRole('button', { name: /^Provenance of GENE-X spatial-parallelism replay: PRD-reported, Blocked$/ });
  expect(badge).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getAllByText('PRD-reported').length).toBeGreaterThanOrEqual(3);
  expect(document.querySelector('.lab-pill[data-status="passed"]')).toBeNull();
  const blocked = screen.getAllByRole('note').find((n) => /^Blocked:/.test(n.getAttribute('aria-label') ?? '') || n.textContent?.includes('cannot be checked'))!;
  expect(blocked).toHaveTextContent('checkpoints and timing logs are not in this repo');
  expect(blocked).toHaveTextContent('To unblock:');

  // Independence note.
  const indep = screen.getByRole('note', { name: /The live W7-X tubes are independent/ });
  expect(indep).toHaveTextContent('no exchange between them');
});

test('S6 honesty wording: PRD-reported means, only the ratio recomputed, replay not live, nothing verified here', async () => {
  serve(artifact);
  render(<SpatialView />);
  const timing = await screen.findByRole('region', { name: 'CPU vs GPU runtime' });
  // Where the numbers come from is said in words, next to them.
  expect(timing).toHaveTextContent('Mean wall-clock time per controlled run, as stated in the PRD.');
  expect(timing).toHaveTextContent('Dashed outlines: PRD-reported means that this repo cannot recompute.');
  expect(timing).toHaveTextContent('only the division is redone, both means are PRD-reported.');
  expect(pills(timing)).toEqual(['prd-reported:PRD-reported']);
  const tally = panel('Controlled runs');
  expect(tally).toHaveTextContent('Runs compared against the GENE-X reference, as stated in the PRD.');
  expect(pills(tally)).toEqual(['prd-reported:PRD-reported']);
  expect(screen.queryByRole('heading', { name: /Verified runs/ })).toBeNull();
  const why = panel('Why this is not verified here');
  expect(pills(why)).toEqual(['blocked:Blocked']);
  expect(within(why).getByRole('note')).toHaveAccessibleName('Blocked: Plane ownership, the 4/4 passes and the timings cannot be checked');

  // The ring panel is a replay, and says so; nothing in the view is live or verified.
  const ring = panel('GENE-X on Dommaschk geometry — not W7-X');
  expect(ring).toHaveTextContent(/^Spatial parallelism · replay/);
  expect(pills()).toEqual(['prd-reported:PRD-reported', 'blocked:Blocked', 'prd-reported:PRD-reported', 'prd-reported:PRD-reported', 'blocked:Blocked']);
  for (const p of [ring, timing, tally]) {
    expect(p.textContent ?? '').not.toMatch(/recomputed from|verified here|verified against|live ·|· live|\bLIVE\b|Verified/);
  }
  expect(document.querySelector('.lab-pill[data-status="live"]')).toBeNull();
  expect(document.querySelector('.lab-pill[data-status="passed"], .lab-pill[data-status="derived"]')).toBeNull();
  // The timing bars and tally marks of PRD-reported values keep the dashed, not-backed-by-data treatment.
  expect(screen.getByTestId('timing')).toHaveAttribute('data-kind', 'prd-reported');
  expect(screen.getByTestId('tally')).toHaveAttribute('data-kind', 'prd-reported');
});

test('S6 / FB-4 the run tally is N of M from runs, and its PRD check from the fixture: 3 of 4 against a PRD 4', async () => {
  const a = clone();
  a.runs = { controlled: 4, passedReference: 3 };
  Object.assign(fx(a, 'controlled-runs-passed'), { label: 'Controlled runs that passed the reference (3 of 4)', computed: 3, matches: false });
  serve(a);
  const first = render(<SpatialView />);
  const tally = await screen.findByTestId('tally');
  expect(within(tally).getByRole('group', { name: 'Passed the reference: 3 of 4 runs' })).toBeInTheDocument();
  const marks = [...tally.querySelectorAll('.sp-tally__run')].map((li) => `${li.textContent}:${li.classList.contains('sp-tally__run--pass')}`);
  expect(marks).toEqual(['1:true', '2:true', '3:true', '4:false']);
  expect(tally).toHaveTextContent('1 of 4 runs did not pass the reference.');
  expect(within(panel('Why this is not verified here')).getByRole('note')).toHaveAccessibleName(
    'Blocked: Plane ownership, the 3/4 passes and the timings cannot be checked',
  );
  // The PRD's 4 against the 3 recomputed here: a mismatch, and the panel's pill says so.
  expect(within(screen.getByTestId('runs-check')).getByRole('group', { name: RUNS })).toHaveAccessibleName(
    'Controlled runs that passed the reference (3 of 4): Mismatch. Claimed 4, computed 3, difference minus 1',
  );
  expect(pills(panel('Controlled runs'))).toEqual(['mismatch:Mismatch']);
  expect(tally).toHaveAttribute('data-kind', 'mismatch');
  expect(panel('Controlled runs')).not.toHaveTextContent('as stated in the PRD');
  // The timing panel is backed by its own fixtures, which did not change.
  expect(pills(panel('CPU vs GPU runtime'))).toEqual(['prd-reported:PRD-reported']);
  first.unmount();

  // Recomputed from data and matching the PRD: derived, not PRD-reported.
  const ok = clone();
  Object.assign(fx(ok, 'controlled-runs-passed'), { computed: 4, matches: true });
  serve(ok);
  render(<SpatialView />);
  await screen.findByTestId('tally');
  expect(pills(panel('Controlled runs'))).toEqual(['derived:Derived']);
  expect(screen.getByTestId('tally')).toHaveAttribute('data-kind', 'derived');
  expect(within(screen.getByTestId('runs-check')).getByRole('group', { name: RUNS })).toHaveAccessibleName(
    'Controlled runs that passed the reference (4 of 4): Match. Claimed 4, computed 4, difference 0',
  );
});

test('FB-4 pills and wording follow the fixtures, not the provenance kind', async () => {
  // The checkpoints arrive: both means and the tally are recomputed from data and match; the speedup is
  // then a data-backed check too. The provenance record is left as it was: the panels follow the fixtures.
  const a = clone();
  Object.assign(fx(a, 'cpu-mean-s'), { computed: 184.69, matches: true });
  Object.assign(fx(a, 'gpu-mean-s'), { computed: 145.44, matches: true });
  Object.assign(fx(a, 'controlled-runs-passed'), { computed: 4, matches: true });
  delete fx(a, 'speedup').basis;
  serve(a);
  const first = render(<SpatialView />);
  const timing = await screen.findByRole('region', { name: 'CPU vs GPU runtime' });
  expect(pills(timing)).toEqual(['derived:Derived']);
  expect(pills(panel('Controlled runs'))).toEqual(['derived:Derived']);
  expect(pills()).toEqual(['prd-reported:PRD-reported', 'blocked:Blocked', 'derived:Derived', 'derived:Derived', 'blocked:Blocked']);
  for (const p of [timing, panel('Controlled runs')]) expect(p).not.toHaveTextContent(/as stated in the PRD|Dashed outlines/);
  expect(screen.getByTestId('timing')).toHaveAttribute('data-kind', 'derived');
  expect(screen.getByRole('group', { name: SPEEDUP })).toHaveAccessibleName('GPU speedup over CPU (CPU mean / GPU mean): Match. Claimed 1.27, computed 1.27, difference 0.00');
  expect(screen.getByRole('group', { name: SPEEDUP })).toHaveAttribute('data-basis', 'data');
  expect(screen.getByRole('group', { name: /^CPU mean wall-clock per run: Match\. Claimed 184\.69 s, computed 184\.69 s/ })).toBeInTheDocument();
  first.unmount();

  // The other way round: the provenance record says derived / passed, but the fixtures still say nothing
  // here recomputes the means or the tally. The panels keep saying PRD-reported; the badge says what the record says.
  const b = clone();
  b.provenance = { ...b.provenance, kind: 'derived', verification: { outcome: 'passed', details: 'Recomputed from the saved checkpoints and timing logs.' } };
  serve(b);
  const second = render(<SpatialView />);
  await screen.findByRole('region', { name: 'CPU vs GPU runtime' });
  expect(pills()).toEqual(['derived:Derived', 'passed:Verified', 'prd-reported:PRD-reported', 'prd-reported:PRD-reported', 'passed:Verified']);
  expect(panel('CPU vs GPU runtime')).toHaveTextContent('as stated in the PRD');
  expect(screen.getByTestId('timing')).toHaveAttribute('data-kind', 'prd-reported');
  expect(within(panel('Verification')).getByRole('note')).toHaveAccessibleName(/^Note: The artifact records a passed verification/);
  second.unmount();

  // A failed verification is shown as failed, with the artifact's own words.
  const failed = clone();
  failed.provenance = { ...failed.provenance, verification: { outcome: 'failed', details: 'Run 3 differs from the reference by 4 %.' } };
  serve(failed);
  const third = render(<SpatialView />);
  const v = await screen.findByRole('region', { name: 'Verification failed' });
  expect(pills(v)).toEqual(['failed:Failed']);
  expect(within(v).getByRole('note')).toHaveTextContent('Run 3 differs from the reference by 4 %.');
  third.unmount();

  // An artifact is replayed evidence: even a "live" provenance kind cannot produce the LIVE pill here.
  const live = clone();
  live.provenance = { ...live.provenance, kind: 'live' };
  serve(live);
  render(<SpatialView />);
  const t = await screen.findByRole('region', { name: 'CPU vs GPU runtime' });
  expect(screen.getByRole('button', { name: /^Provenance of GENE-X spatial-parallelism replay: Recorded run, Blocked$/ })).toBeInTheDocument();
  expect(pills(t)).toEqual(['prd-reported:PRD-reported']);
  expect(document.querySelector('.lab-pill[data-status="live"]')).toBeNull();
  expect(document.body).not.toHaveTextContent(/\bLIVE\b/);
});

test('FB-4 the speedup check is the artifact fixture: matches false or null, a different speedup, a flag that disagrees', async () => {
  const check = async (edit: Partial<FixtureCheckData>) => {
    const a = clone();
    Object.assign(fx(a, 'speedup'), edit);
    serve(a);
    const r = render(<SpatialView />);
    const g = within(await screen.findByTestId('timing-checks')).getByRole('group', { name: SPEEDUP });
    const out = { name: g.getAttribute('aria-label'), outcome: g.getAttribute('data-outcome'), basis: g.getAttribute('data-basis') };
    r.unmount();
    return out;
  };
  // The arithmetic basis never softens a mismatch.
  expect(await check({ claimed: 1.3, matches: false })).toEqual({
    name: 'GPU speedup over CPU (CPU mean / GPU mean): Mismatch. Claimed 1.30, computed 1.27, difference minus 0.03',
    outcome: 'mismatch',
    basis: 'arithmetic',
  });
  expect(await check({ computed: null, matches: null })).toEqual({
    name: 'GPU speedup over CPU (CPU mean / GPU mean): Not recomputable. Claimed 1.27, computed value not available',
    outcome: 'unknown',
    basis: 'arithmetic',
  });
  // A different speedup, recorded consistently, is shown as recorded: nothing in the view says 1.27.
  expect(await check({ claimed: 2, computed: 2.004, note: '200.00 s / 100.00 s = 2.004.' })).toEqual({
    name: 'GPU speedup over CPU (CPU mean / GPU mean): Arithmetic consistent. Claimed 2.00, computed 2.00, difference 0.00',
    outcome: 'match',
    basis: 'arithmetic',
  });
  // A flag that says "matches" for values that print differently is a mismatch, and says so.
  expect(await check({ computed: 2, matches: true })).toEqual({
    name: 'GPU speedup over CPU (CPU mean / GPU mean): Mismatch. Claimed 1.27, computed 2.00, difference +0.73. The match flag disagrees with the printed values.',
    outcome: 'mismatch',
    basis: 'arithmetic',
  });
});

test('FB-4 an artifact without the spatial fixtures says so: unverified panels, no invented checks; extra fixtures are shown', async () => {
  const a = clone();
  a.fixtures = [{ id: 'planes-per-rank', label: 'Planes per rank', claimed: 3, computed: 3, printedDecimals: 0, matches: true }];
  serve(a);
  const first = render(<SpatialView />);
  const timing = await screen.findByRole('region', { name: 'CPU vs GPU runtime' });
  expect(pills(timing)).toEqual(['unverified:Unverified']);
  expect(pills(panel('Controlled runs'))).toEqual(['unverified:Unverified']);
  expect(timing).toHaveTextContent('The artifact carries no check of the speedup.');
  expect(panel('Controlled runs')).toHaveTextContent('The artifact carries no check of the run tally.');
  expect(within(timing).queryByRole('group', { name: SPEEDUP })).toBeNull();
  expect(screen.getByTestId('timing')).toHaveAttribute('data-kind', 'unverified');
  // The tally is still the artifact's runs; a fixture no panel places is not dropped.
  expect(within(screen.getByTestId('tally')).getByRole('group', { name: 'Passed the reference: 4 of 4 runs' })).toBeInTheDocument();
  expect(within(panel('Other PRD checks')).getByRole('group', { name: /^Planes per rank: Match\. Claimed 3, computed 3/ })).toBeInTheDocument();
  expect(otherFixtures(a).map((f) => f.id)).toEqual(['planes-per-rank']);
  first.unmount();

  // No fixtures array at all is a contract violation (D-023): the file is named, nothing is drawn.
  const old: Partial<SpatialArtifact> = clone();
  delete old.fixtures;
  expect(checkSpatial(old as SpatialArtifact)).toBe('fixtures is missing (contract D-023)');
  serve(old);
  render(<SpatialView />);
  expect(await screen.findByRole('heading', { name: 'Could not load artifacts/spatial.json' })).toBeInTheDocument();
  expect(screen.getByText(/fixtures is missing \(contract D-023\)/)).toBeInTheDocument();
});

test('FB-4 backing(): most cautious first, from fixtureOutcome and basis', () => {
  const f = (o: Partial<FixtureCheckData>): FixtureCheckData => ({ id: 'x', label: 'x', claimed: 1, computed: 1, printedDecimals: 0, matches: true, ...o });
  expect(backing([])).toEqual({ status: 'unverified', reported: false });
  expect(backing([f({}), null])).toEqual({ status: 'unverified', reported: false });
  expect(backing([f({}), f({})])).toEqual({ status: 'derived', reported: false });
  expect(backing([f({ basis: 'data' })])).toEqual({ status: 'derived', reported: false });
  expect(backing([f({}), f({ basis: 'arithmetic' })])).toEqual({ status: 'prd-reported', reported: true });
  expect(backing([f({}), f({ computed: null, matches: null })])).toEqual({ status: 'prd-reported', reported: true });
  expect(backing([f({ computed: null, matches: null }), f({ matches: false })])).toEqual({ status: 'mismatch', reported: false });
  expect(backing([f({ computed: 2 })])).toEqual({ status: 'mismatch', reported: false }); // flag true, values differ
  expect(spatialBacking(artifact)).toEqual({ timing: { status: 'prd-reported', reported: true }, runs: { status: 'prd-reported', reported: true } });
  expect(artifact.fixtures.map(fixtureUnit)).toEqual(['dimensionless', 'dimensionless', 's', 's']);
});
