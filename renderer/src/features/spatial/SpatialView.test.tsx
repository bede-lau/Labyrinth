import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { planeAngle, planeRange, ringLayout, shortestDelta } from './ring';
import { GEOMETRY_LABEL, SpatialView, speedupFixture } from './SpatialView';
import { checkSpatial, type SpatialArtifact } from './types';

// The committed artifact is the fixture (data only; read from disk, served through fetch).
const artifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/spatial.json'), 'utf8')) as SpatialArtifact;

function serve(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}
afterEach(() => vi.unstubAllGlobals());

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
});

test('S6 timing CPU 184.69 s vs GPU 145.44 s (1.27×), run tally 4/4, provenance PRD-reported / blocked, independence note', async () => {
  const fx = speedupFixture(artifact);
  expect(fx).toMatchObject({ claimed: 1.27, computed: 1.269871, printedDecimals: 2, matches: true });

  serve(artifact);
  render(<SpatialView />);
  const timing = await screen.findByTestId('timing');
  expect(within(timing).getByRole('group', { name: 'CPU mean: 184.69 s' })).toBeInTheDocument();
  expect(within(timing).getByRole('group', { name: 'GPU mean: 145.44 s' })).toBeInTheDocument();
  const speed = screen.getByRole('group', { name: /^Speedup \(CPU ÷ GPU\): Match\. Claimed 1\.27, computed 1\.27/ });
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
