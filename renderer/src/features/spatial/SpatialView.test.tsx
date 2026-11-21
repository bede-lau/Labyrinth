import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FixtureCheckData } from '../../design';
import { backing, fixtureUnit, spatialBacking } from './model';
import { planeAngle, planeRange, ringLayout, shortestDelta } from './ring';
import { SpatialReplay } from './SpatialReplay';
import { SpatialView } from './SpatialView';
import { checkSpatial, type SpatialArtifact } from './types';

const recorded = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/spatial.json'), 'utf8')) as SpatialArtifact;
// Preserve coverage of the earlier PRD-reported artifact. The primary fixture uses the recorded evidence.
const artifact: SpatialArtifact = {
  ...recorded,
  timing: { cpuMeanS: 184.69, gpuMeanS: 145.44, speedup: 1.27, speedupRecomputed: 184.69 / 145.44 },
  fixtures: recorded.fixtures.map((f) => {
    if (f.id === 'speedup') return { ...f, computed: 1.269871, basis: 'arithmetic',
      note: '184.69 s / 145.44 s = 1.26987; only the division is redone, both means are PRD-reported.' };
    return { ...f, computed: null, matches: null, basis: undefined };
  }),
  provenance: { ...recorded.provenance, kind: 'prd-reported',
    verification: { outcome: 'blocked', details: 'Saved GENE-X checkpoints and timing logs are not in this repo.' } },
};
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
  expect(within(ring).getByTestId('cpu-node')).toHaveTextContent('Shared fieldCPU');
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

test('recorded checkpoints, timings and reference values render as verified replay', async () => {
  serve(recorded);
  render(<SpatialView />);
  const section = await screen.findByRole('region', {name: 'Runtime comparison'});
  for (const value of ['1.27×','184.69 s','145.44 s','39.25 s','4/4']) expect(section).toHaveTextContent(value);
  expect(screen.getByText(/Proposed control loop/)).toBeInTheDocument();
});

test('replay pauses within a stage, moves from the recorded layout to the proposed loop, and can restart offline', () => {
  vi.useFakeTimers();
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  try {
    render(<SpatialReplay recorded>{phase => <span>{phase}</span>}</SpatialReplay>);
    const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
    const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

    click('Play replay');
    advance(1000);
    click('Pause');
    advance(9000);
    expect(screen.getByText('compute')).toBeInTheDocument();
    click('Play replay');
    advance(1710);
    expect(screen.getByText('exchange')).toBeInTheDocument();
    advance(2700);
    expect(screen.getByText('field')).toBeInTheDocument();
    advance(2700);
    expect(screen.getByRole('status')).toHaveTextContent('Predict where heat');
    click('Next stage');
    expect(screen.getByRole('status')).toHaveTextContent('Test a change');
    click('Previous stage');
    expect(screen.getByRole('status')).toHaveTextContent('Predict where heat');
    click('Play replay');
    for (let i = 0; i < 4; i++) advance(2700);
    expect(screen.getByRole('status')).toHaveTextContent('next prediction');
    click('Replay again');
    expect(screen.getByText('compute')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
