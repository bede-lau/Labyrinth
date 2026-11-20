import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { planeAngle, planeRange, ringLayout, shortestDelta } from './ring';
import { GEOMETRY_LABEL, SpatialView, speedupFixture } from './SpatialView';
import { checkSpatial, type SpatialArtifact } from './types';

// The committed artifact is the fixture (data only; read from disk, served through fetch).
const artifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/spatial.json'), 'utf8')) as SpatialArtifact;
const clone = (): SpatialArtifact => JSON.parse(JSON.stringify(artifact)) as SpatialArtifact;

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
  const fx = speedupFixture(artifact);
  expect(fx).toMatchObject({ claimed: 1.27, computed: 1.269871, printedDecimals: 2, matches: true });

  serve(artifact);
  render(<SpatialView />);
  const timing = await screen.findByTestId('timing');
  expect(within(timing).getByRole('group', { name: 'CPU mean: 184.69 s' })).toBeInTheDocument();
  expect(within(timing).getByRole('group', { name: 'GPU mean: 145.44 s' })).toBeInTheDocument();
  // DS-13: only the division is redone here, on two PRD-reported means. That is "Arithmetic consistent",
  // not the "Match" of a value recomputed from data.
  const speed = screen.getByRole('group', { name: /^Speedup \(CPU ÷ GPU\): Arithmetic consistent\. Claimed 1\.27, computed 1\.27/ });
  expect(speed).toHaveAttribute('data-basis', 'arithmetic');
  expect(speed).toHaveAttribute('data-outcome', 'match');
  expect(within(speed).queryByText('Match')).toBeNull();
  expect(speed).toHaveTextContent('184.69 s ÷ 145.44 s = 1.2699');
  expect(within(screen.getByTestId('tally')).getByRole('group', { name: 'Passed the reference: 4 of 4 runs' })).toBeInTheDocument();

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

  // A mismatch would be loud: a claim that the recomputed ratio does not reproduce.
  const off = speedupFixture({ ...artifact, timing: { ...artifact.timing, speedup: 1.3 } });
  expect(off.matches).toBe(false);
});

test('S6 honesty wording: PRD-reported means, only the ratio recomputed, replay not live, nothing verified here', async () => {
  serve(artifact);
  render(<SpatialView />);
  const timing = await screen.findByRole('region', { name: 'CPU vs GPU runtime' });
  // Where the numbers come from is said in words, next to them.
  expect(timing).toHaveTextContent('Mean wall-clock time per controlled run, as stated in the PRD.');
  expect(timing).toHaveTextContent('Only the ratio is recomputed. Both means are PRD-reported (dashed outlines): no timing logs are in this repo.');
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

test('S6 the run tally is N of M from the artifact, not M of M', async () => {
  const a = clone();
  a.runs = { controlled: 4, passedReference: 3 };
  serve(a);
  render(<SpatialView />);
  const tally = await screen.findByTestId('tally');
  expect(within(tally).getByRole('group', { name: 'Passed the reference: 3 of 4 runs' })).toBeInTheDocument();
  const marks = [...tally.querySelectorAll('.sp-tally__run')].map((li) => `${li.textContent}:${li.classList.contains('sp-tally__run--pass')}`);
  expect(marks).toEqual(['1:true', '2:true', '3:true', '4:false']);
  expect(tally).toHaveTextContent('1 of 4 runs did not pass the reference.');
  expect(within(panel('Why this is not verified here')).getByRole('note')).toHaveAccessibleName(
    'Blocked: Plane ownership, the 3/4 passes and the timings cannot be checked',
  );
});

test('S6 status pills and source wording follow the artifact provenance, not fixed text', async () => {
  // If the checkpoints arrive and the artifact becomes derived / passed, no panel may keep saying PRD-reported / Blocked.
  const a = clone();
  a.provenance = { ...a.provenance, kind: 'derived', verification: { outcome: 'passed', details: 'Recomputed from the saved checkpoints and timing logs.' } };
  serve(a);
  const first = render(<SpatialView />);
  const timing = await screen.findByRole('region', { name: 'CPU vs GPU runtime' });
  expect(pills(timing)).toEqual(['derived:Derived']);
  expect(pills(panel('Controlled runs'))).toEqual(['derived:Derived']);
  expect(pills()).toEqual(['derived:Derived', 'passed:Verified', 'derived:Derived', 'derived:Derived', 'passed:Verified']);
  for (const p of [timing, panel('Controlled runs'), panel('Verification')]) {
    expect(p).not.toHaveTextContent(/PRD-reported|as stated in the PRD|Blocked|cannot be checked|not verified here/);
  }
  expect(screen.queryByRole('region', { name: 'Why this is not verified here' })).toBeNull();
  expect(within(panel('Verification')).getByRole('note')).toHaveTextContent('Recomputed from the saved checkpoints and timing logs.');
  expect(screen.getByTestId('timing')).toHaveAttribute('data-kind', 'derived');
  // With means that are no longer PRD-reported the ratio is a data-backed match again.
  expect(screen.getByRole('group', { name: /^Speedup \(CPU ÷ GPU\): Match\. Claimed 1\.27, computed 1\.27/ })).toHaveAttribute('data-basis', 'data');
  first.unmount();

  // The arithmetic basis never softens a mismatch.
  const wrong = clone();
  wrong.timing = { ...wrong.timing, speedup: 1.3 };
  serve(wrong);
  const mid = render(<SpatialView />);
  const miss = await screen.findByRole('group', { name: /^Speedup \(CPU ÷ GPU\): Mismatch\. Claimed 1\.30, computed 1\.27, difference minus 0\.03/ });
  expect(miss).toHaveAttribute('data-outcome', 'mismatch');
  expect(within(miss).queryByText('Arithmetic consistent')).toBeNull();
  mid.unmount();

  // A failed verification is shown as failed, with the artifact's own words.
  const failed = clone();
  failed.provenance = { ...failed.provenance, verification: { outcome: 'failed', details: 'Run 3 differs from the reference by 4 %.' } };
  serve(failed);
  const second = render(<SpatialView />);
  const v = await screen.findByRole('region', { name: 'Verification failed' });
  expect(pills(v)).toEqual(['failed:Failed']);
  expect(within(v).getByRole('note')).toHaveTextContent('Run 3 differs from the reference by 4 %.');
  second.unmount();

  // An artifact is replayed evidence: even a "live" provenance kind cannot produce the LIVE pill here.
  const live = clone();
  live.provenance = { ...live.provenance, kind: 'live' };
  serve(live);
  render(<SpatialView />);
  const t = await screen.findByRole('region', { name: 'CPU vs GPU runtime' });
  expect(pills(t)).toEqual(['replay:Recorded run']);
  expect(pills(panel('Controlled runs'))).toEqual(['replay:Recorded run']);
  expect(document.querySelector('.lab-pill[data-status="live"]')).toBeNull();
  expect(t.querySelector('.lab-pill[data-status="live"]')).toBeNull();
});

test('S6 the speedup note divides the two means itself and flags an artifact ratio that is not their quotient', () => {
  const ok = speedupFixture(artifact);
  expect(ok.note).toBe('Recomputed: 184.69 s ÷ 145.44 s = 1.2699');
  expect(ok.matches).toBe(true);
  // 200 / 100 = 2, but the artifact claims the recomputed ratio is 1.27: not a match, and the note says why.
  const bad = speedupFixture({ ...artifact, timing: { cpuMeanS: 200, gpuMeanS: 100, speedup: 1.27, speedupRecomputed: 1.27 } });
  expect(bad.note).toMatch(/^Recomputed: 200\.00 s ÷ 100\.00 s = 2\.0000\./);
  expect(bad.note).toMatch(/artifact records 1\.2700 as the recomputed ratio, which is not this quotient/);
  expect(bad.matches).toBe(false);
  // A genuinely different ratio is a plain mismatch.
  const off = speedupFixture({ ...artifact, timing: { cpuMeanS: 200, gpuMeanS: 100, speedup: 1.27, speedupRecomputed: 2 } });
  expect(off).toMatchObject({ claimed: 1.27, computed: 2, matches: false });
  expect(off.note).toBe('Recomputed: 200.00 s ÷ 100.00 s = 2.0000');
});
