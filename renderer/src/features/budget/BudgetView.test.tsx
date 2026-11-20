import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LiveStatus } from '../../lib/liveStatus';
import { BudgetView } from './BudgetView';
import { ledgerSegments, rangeFixture, type BudgetArtifact } from './model';

const ARTIFACT: BudgetArtifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/budget.json'), 'utf8'));

const STATUS: LiveStatus = {
  schemaVersion: 1,
  mode: 'unavailable',
  reason: 'No Modal credentials.',
  qualified: false,
  budget: { ceilingUsd: 40, billedUsd: 8.1, pendingUsd: 0, slotEstimateUsd: 2.65, slotFits: true, hardTimeoutS: 1500 },
  workers: [],
  fallback: { active: true, label: 'No qualified GX rehearsal recorded', savedRunId: null },
};

function serve(live: LiveStatus | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/artifacts/budget.json') return new Response(JSON.stringify(ARTIFACT), { status: 200 });
      if (url === '/api/live/status') return live ? new Response(JSON.stringify(live)) : new Response('', { status: 502 });
      return new Response('', { status: 404 });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

test('B6 ledger bar to the $40 ceiling: posted, planned, remaining; live guard estimate distinguished from PRD GPU-only', async () => {
  // Replay build (API unreachable): PRD ledger only, guard clearly marked as not reachable.
  serve(null);
  const { unmount } = render(<BudgetView livePollMs={60_000} />);
  const bar = await screen.findByTestId('ledger-bar');
  expect(bar).toHaveAccessibleName(
    'Modal ledger against the $40.00 ceiling: Posted earlier $8.10, Planned: 2 rehearsals + 1 live slot $13.73, Remaining $18.17. Planned total $21.83.',
  );
  const segs = ledgerSegments(ARTIFACT);
  expect(segs.map((s) => s.usd.toFixed(2))).toEqual(['8.10', '13.73', '18.17']);
  expect(segs.reduce((a, s) => a + s.pct, 0)).toBeCloseTo(100, 6);
  const widths = [...bar.querySelectorAll<HTMLElement>('.bg-bar__seg')].map((e) => e.style.width);
  expect(widths).toEqual(['20.25%', '34.325%', '45.425%']);
  expect(screen.getByText('$21.83', { selector: 'dd' })).toBeInTheDocument();
  expect(await screen.findByRole('note', { name: /Live budget guard not reachable/ })).toBeInTheDocument();
  expect(screen.queryByTestId('guard-live')).toBeNull();
  // D-015 planning figures are labelled with their source, beside the PRD's GPU-only figures.
  expect(screen.getByTestId('guard-planned')).toHaveTextContent('$26.21 · decision.md · D-015');
  unmount();

  // API reachable: the guard's own numbers come from /api/live/status.
  serve({ ...STATUS, budget: { ...STATUS.budget, billedUsd: 8.1, pendingUsd: 1.0, slotEstimateUsd: 2.65 } });
  render(<BudgetView livePollMs={60_000} />);
  const guard = await screen.findByTestId('guard-live');
  expect(within(guard).getByRole('img')).toHaveAccessibleName(
    'Live budget guard: billed $8.10, pending $1.00, next slot estimate $2.65, of the $40.00 ceiling',
  );
  expect(within(guard).getByText('$28.25')).toBeInTheDocument(); // 40 − 8.10 − 1.00 − 2.65
  expect(within(guard).getByText(/Next slot fits under the ceiling/)).toBeInTheDocument();
  expect(screen.getByTestId('guard-slot')).toHaveTextContent('$2.65 · from /api/live/status');
  const compare = screen.getByRole('table', { name: /Guard pricing compared with the PRD's GPU-only figures/ });
  expect(within(compare).getByText('$1.53')).toBeInTheDocument();
  expect(within(compare).getByText('$21.83')).toBeInTheDocument();
});

test('B7 scenario cards show headline, derivation and interpretation; PRD-reported vs derived; ranges never midpoints', async () => {
  serve(null);
  render(<BudgetView livePollMs={60_000} />);
  for (const s of ARTIFACT.scenarios) {
    const card = await screen.findByRole('article', { name: `${s.title} scenario` });
    expect(within(card).getByText(s.headline)).toBeInTheDocument();
    expect(within(card).getByText(s.derivation)).toBeInTheDocument();
    expect(within(card).getByText(s.interpretation)).toBeInTheDocument();
    expect(card).toHaveAttribute('data-kind', s.provenance.kind);
    const pillText = s.provenance.kind === 'prd-reported' ? 'PRD-reported' : 'Derived';
    expect(within(card).getAllByText(pillText).length).toBeGreaterThan(0);
  }
  expect(screen.getByRole('article', { name: 'Published GPU-native GX bean benchmark scenario' })).toHaveAttribute('data-kind', 'prd-reported');
  expect(screen.getByRole('article', { name: 'Live demo scenario' })).toHaveAttribute('data-kind', 'derived');

  // Range fixtures: the PRD range and the computed value, never the backend's midpoint "claimed" value.
  const days = screen.getByTestId('range-full-grid-days');
  expect(days).toHaveTextContent('14–15 days');
  expect(days).toHaveTextContent('14.45 days');
  expect(days).toHaveTextContent('Inside PRD range');
  expect(days).not.toHaveTextContent('14.5 ');
  const cost = screen.getByTestId('range-full-grid-usd');
  expect(cost).toHaveTextContent('3,100–3,200 USD');
  expect(cost).toHaveTextContent('3,173 USD');
  expect(cost).not.toHaveTextContent(/3,?150/);
  expect(screen.getByTestId('range-halved-dt-usd')).not.toHaveTextContent(/6,?300/);
  expect(rangeFixture(ARTIFACT.fixtures.find((f) => f.id === 'halved-dt-days')!)).toMatchObject({ lo: 28, hi: 30, inside: true });

  // Ordinary fixtures still use claimed vs computed.
  expect(screen.getByRole('group', { name: /^Live slot, 15 min at \$6\.10\/h: Match\. Claimed 1\.53/ })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: /^GX bean benchmark, 1 GPU, 4×8: Not recomputable/ })).toBeInTheDocument();
});
