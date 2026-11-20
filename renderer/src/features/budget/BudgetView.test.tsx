import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LiveStatus } from '../../lib/liveStatus';
import { BudgetView } from './BudgetView';
import { claimedLabelFor, fixtureBasis, isRangeFixture, ledgerSegments, planChecks, rangeFixture, usd, type BudgetArtifact } from './model';

const ARTIFACT: BudgetArtifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/budget.json'), 'utf8'));
const clone = (): BudgetArtifact => JSON.parse(JSON.stringify(ARTIFACT)) as BudgetArtifact;
const fixture = (a: BudgetArtifact, id: string) => a.fixtures.find((f) => f.id === id)!;

const STATUS: LiveStatus = {
  schemaVersion: 1,
  mode: 'unavailable',
  reason: 'No Modal credentials.',
  qualified: false,
  budget: { ceilingUsd: 40, billedUsd: 8.1, pendingUsd: 0, slotEstimateUsd: 2.65, slotFits: true, hardTimeoutS: 1500 },
  workers: [],
  fallback: { active: true, label: 'No qualified GX rehearsal recorded', savedRunId: null },
};

function serve(live: LiveStatus | null, artifact: unknown = ARTIFACT, artifactStatus = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/artifacts/budget.json') return new Response(JSON.stringify(artifact), { status: artifactStatus });
      if (url === '/api/live/status') return live ? new Response(JSON.stringify(live)) : new Response('', { status: 502 });
      return new Response('', { status: 404 });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

/** The comparison table as text: [[header…], [row…], …]. */
function compareTable() {
  const table = screen.getByRole('table', { name: /Guard pricing compared with the PRD's GPU-only figures/ });
  return within(table)
    .getAllByRole('row')
    .map((r) => [...r.children].map((c) => c.textContent?.replace(/\s+/g, ' ').trim()));
}

test('B6 ledger bar to the $40 ceiling: posted, planned, remaining; live guard estimate distinguished from PRD GPU-only', async () => {
  // Replay build (API unreachable): PRD ledger only, guard clearly marked as not reachable.
  serve(null);
  const { unmount } = render(<BudgetView livePollMs={60_000} />);
  const bar = await screen.findByTestId('ledger-bar');
  expect(bar).toHaveAccessibleName(
    'Modal ledger against the $40.00 ceiling: Posted earlier $8.10, Planned: 2 rehearsals + 1 live slot $13.73, Remaining $18.17. Planned total $21.83.',
  );
  expect(screen.getByRole('heading', { name: 'Modal spend against the $40.00 ceiling' })).toBeInTheDocument();
  const segs = ledgerSegments(ARTIFACT);
  expect(segs.map((s) => s.usd.toFixed(2))).toEqual(['8.10', '13.73', '18.17']);
  expect(segs.reduce((a, s) => a + s.pct, 0)).toBeCloseTo(100, 6);
  const widths = [...bar.querySelectorAll<HTMLElement>('.bg-bar__seg')].map((e) => e.style.width);
  expect(widths).toEqual(['20.25%', '34.325%', '45.425%']);
  expect(screen.getByText('$21.83', { selector: 'dd' })).toBeInTheDocument();
  // The posted spend is a PRD-reported figure; what is computed from it is derived.
  const kind = (seg: string) => document.querySelector(`.bg-legend__item[data-seg="${seg}"] .lab-pill`)?.getAttribute('data-status');
  expect([kind('posted'), kind('plan'), kind('remaining')]).toEqual(['prd-reported', 'derived', 'derived']);
  expect(await screen.findByRole('note', { name: /Live budget guard not reachable/ })).toBeInTheDocument();
  expect(screen.queryByTestId('guard-live')).toBeNull();
  expect(screen.getByText('Guard not reachable')).toBeInTheDocument();

  // D-015 planning figures are labelled with their source, beside the PRD's GPU-only figures: each
  // number under its own column header, and nothing claims to come from the API while it is unreachable.
  expect(compareTable()).toEqual([
    ['Item', 'PRD (GPU time only)', 'Guard (incl. setup, idle, storage)'],
    ['15-min live slot', '$1.53', '$2.65 · decision.md · D-015'],
    ['One-hour rehearsal', '$6.10', '$7.73 · decision.md · D-015'],
    ['Planned total incl. $8.10 posted', '$21.83', '$26.21 · decision.md · D-015'],
  ]);
  expect(screen.getByTestId('guard-slot')).not.toHaveTextContent(/api\/live\/status/);
  expect(screen.getByTestId('guard-planned')).toHaveTextContent('$26.21 · decision.md · D-015');
  expect(screen.getByTestId('guard-planned')).not.toHaveTextContent(/out of date/);
  expect(screen.getByTestId('plan-vs-ceiling')).toHaveTextContent(
    'Both plans stay inside the $40.00 ceiling: PRD plan $21.83, D-015 guard plan $26.21.',
  );
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
  expect(screen.getByText('Guard · /api/live/status')).toBeInTheDocument();
  expect(compareTable()[1]).toEqual(['15-min live slot', '$1.53', '$2.65 · from /api/live/status']);
  expect(compareTable()[3]).toEqual(['Planned total incl. $8.10 posted', '$21.83', '$26.21 · decision.md · D-015']);
});

test('B6 the ledger, its title and the plan-versus-ceiling statement follow a modified artifact', async () => {
  const a = clone();
  Object.assign(a, { ceilingUsd: 50, postedUsd: 9.99, plannedUsd: 30.5, remainingAfterPlanUsd: 19.5 });
  serve(null, a);
  const first = render(<BudgetView livePollMs={60_000} />);
  const bar = await screen.findByTestId('ledger-bar');
  expect(screen.getByRole('heading', { name: 'Modal spend against the $50.00 ceiling' })).toBeInTheDocument();
  expect(bar).toHaveAccessibleName(
    'Modal ledger against the $50.00 ceiling: Posted earlier $9.99, Planned: 2 rehearsals + 1 live slot $20.51, Remaining $19.50. Planned total $30.50.',
  );
  expect([...bar.querySelectorAll<HTMLElement>('.bg-bar__seg')].map((e) => e.style.width)).toEqual(['19.98%', '41.02%', '39%']);
  expect(screen.getByText('$50.00 ceiling')).toBeInTheDocument();
  expect(compareTable()[3]).toEqual(['Planned total incl. $9.99 posted', '$30.50', '$26.21 · decision.md · D-015']);
  expect(screen.getByTestId('plan-vs-ceiling')).toHaveTextContent(
    'Both plans stay inside the $50.00 ceiling: PRD plan $30.50, D-015 guard plan $26.21.',
  );
  first.unmount();

  // A ceiling the guard plan does not fit under: the statement changes, it is not fixed text.
  const tight = clone();
  tight.ceilingUsd = 25;
  serve(null, tight);
  const second = render(<BudgetView livePollMs={60_000} />);
  const warn = await screen.findByRole('note', { name: /The D-015 guard plan exceeds the \$25\.00 ceiling/ });
  expect(warn).toHaveTextContent('D-015 guard plan $26.21 is $1.21 over the $25.00 ceiling');
  expect(warn).toHaveTextContent('PRD plan $21.83 stays inside it');
  expect(document.body).not.toHaveTextContent(/Both plans stay inside/);
  second.unmount();

  const over = clone();
  over.ceilingUsd = 20;
  serve(null, over);
  render(<BudgetView livePollMs={60_000} />);
  const both = await screen.findByRole('note', { name: /Both plans exceed the \$20\.00 ceiling/ });
  expect(both).toHaveTextContent('PRD plan $21.83 is $1.83 over');
  expect(both).toHaveTextContent('D-015 guard plan $26.21 is $6.21 over');
  expect(planChecks(over, 26.21).map((p) => p.inside)).toEqual([false, false]);
  expect(planChecks(ARTIFACT, 26.21).map((p) => p.inside)).toEqual([true, true]);
  expect(usd(-1.11)).toBe('−$1.11');
});

test('B6 a live guard estimate that differs from D-015 marks the D-015 planning figures as possibly out of date', async () => {
  serve({ ...STATUS, budget: { ...STATUS.budget, billedUsd: 36, pendingUsd: 2, slotEstimateUsd: 3.11, slotFits: false } });
  render(<BudgetView livePollMs={60_000} />);
  const guard = await screen.findByTestId('guard-live');
  expect(within(guard).getByText(/Next slot does NOT fit — replay only/)).toBeInTheDocument();
  expect(within(guard).getByText('−$1.11')).toBeInTheDocument(); // 40 − 36 − 2 − 3.11, never "$-1.11"
  expect(screen.getByTestId('guard-slot')).toHaveTextContent('$3.11 · from /api/live/status');
  // The rehearsal price and the planned total are still the D-015 planning figures (no API field carries
  // them): they keep their source and say that the live estimate has moved away from it.
  expect(screen.getByTestId('guard-planned')).toHaveTextContent('$26.21 · decision.md · D-015');
  expect(screen.getByTestId('guard-planned')).toHaveTextContent(/may be out of date/);
  expect(screen.getByTestId('guard-rehearsal')).toHaveTextContent(/may be out of date/);
  const stale = screen.getByRole('note', { name: /live guard estimate differs from the D-015 planning figures/ });
  expect(stale).toHaveTextContent('$3.11');
  expect(stale).toHaveTextContent('$2.65');
});

test('B7 scenario cards show headline, derivation and interpretation; PRD-reported vs derived; ranges never midpoints', async () => {
  serve(null);
  render(<BudgetView livePollMs={60_000} />);
  const KIND = { 'prd-reported': 'PRD-reported', derived: 'Derived', archive: 'Archive', live: 'Recorded run', rehearsal: 'Rehearsal' } as const;
  const OUTCOME = { passed: 'Verified', failed: 'Failed', blocked: 'Blocked', 'not-applicable': 'Not applicable' } as const;
  for (const s of ARTIFACT.scenarios) {
    const card = await screen.findByRole('article', { name: `${s.title} scenario` });
    expect(within(card).getByText(s.headline)).toBeInTheDocument();
    expect(within(card).getByText(s.derivation)).toBeInTheDocument();
    expect(within(card).getByText(s.interpretation)).toBeInTheDocument();
    expect(card).toHaveAttribute('data-kind', s.provenance.kind);
    expect(card.querySelector('.bg-headline .lab-pill')).toHaveAttribute('data-status', s.provenance.kind);
    expect(card.querySelector('.bg-headline .lab-pill')).toHaveTextContent(KIND[s.provenance.kind]);
    // Every card carries its provenance badge: kind and verification outcome from the artifact.
    expect(
      screen.getByRole('button', { name: `Provenance of ${s.title}: ${KIND[s.provenance.kind]}, ${OUTCOME[s.provenance.verification.outcome]}` }),
    ).toBeInTheDocument();
  }
  expect(screen.getByRole('article', { name: 'Published GPU-native GX bean benchmark scenario' })).toHaveAttribute('data-kind', 'prd-reported');
  expect(screen.getByRole('article', { name: 'Live demo scenario' })).toHaveAttribute('data-kind', 'derived');
  expect(screen.getAllByText('PRD-reported context')).toHaveLength(2);
  expect(screen.getAllByText('Derived estimate')).toHaveLength(2);

  // Range fixtures: the PRD range and the computed value, never the backend's midpoint "claimed" value.
  const RANGE_NOTE = 'The PRD prints only a range; compared by range, not by rounding.';
  const rangeText = (id: string) => screen.getByTestId(`range-${id}`).textContent;
  expect(rangeText('full-grid-days')).toBe(`Full-grid stella wall time${RANGE_NOTE}PRD range14–15 daysComputed14.45 daysInside PRD range`);
  expect(rangeText('full-grid-usd')).toBe(`Full-grid stella cost${RANGE_NOTE}PRD range3,100–3,200 USDComputed3,173 USDInside PRD range`);
  expect(rangeText('halved-dt-days')).toBe(`Full-grid wall time, halved timestep${RANGE_NOTE}PRD range28–30 daysComputed28.90 daysInside PRD range`);
  expect(rangeText('halved-dt-usd')).toBe(`Full-grid cost, halved timestep${RANGE_NOTE}PRD range6,200–6,400 USDComputed6,346 USDInside PRD range`);
  for (const id of ['full-grid-days', 'full-grid-usd', 'halved-dt-days', 'halved-dt-usd']) {
    const r = screen.getByTestId(`range-${id}`);
    expect(r).toHaveAttribute('data-outcome', 'inside');
    expect(r).not.toHaveTextContent(/midpoint|Claimed/i);
    const midpoint = fixture(ARTIFACT, id).claimed.toLocaleString('en-US').replace(/[.]/g, '\\.'); // 14.5, 3,150, 29, 6,300
    expect(r).not.toHaveTextContent(new RegExp(`(^|[^0-9.,])${midpoint}([^0-9.,]|$)`));
    expect(r).not.toHaveTextContent(new RegExp(`(^|[^0-9.,])${midpoint.replace(',', '')}([^0-9.,]|$)`));
  }
  expect(screen.getByRole('group', { name: 'Full-grid stella wall time: Inside PRD range. PRD range 14 to 15 days, computed 14.45 days' })).toBeInTheDocument();
  expect(rangeFixture(fixture(ARTIFACT, 'halved-dt-days'))).toMatchObject({ lo: 28, hi: 30, inside: true, rangeAvailable: true });

  // Ordinary fixtures still use claimed vs computed.
  const slot = screen.getByRole('group', { name: /^Live slot, 15 min at \$6\.10\/h: Match\. Claimed 1\.53/ });
  expect(slot).toHaveAttribute('data-basis', 'data');
  expect(screen.getByRole('group', { name: /^GX bean benchmark, 1 GPU, 4×8: Not recomputable/ })).toBeInTheDocument();
  // DS-13: 161 h × 288 = 46,368 only redoes the arithmetic on PRD-reported inputs (the scenario is
  // PRD-reported): "Arithmetic consistent", never the "Match" of a value recomputed from data.
  const published = screen.getByRole('group', { name: /^Published stella bean: 161 h × 288 processors: Arithmetic consistent\. Claimed 46368 CPU-h, computed 46368 CPU-h/ });
  expect(published).toHaveAttribute('data-basis', 'arithmetic');
  expect(within(published).queryByText('Match')).toBeNull();
  expect(fixtureBasis(ARTIFACT, fixture(ARTIFACT, 'stella-published-cpu-h'))).toBe('arithmetic');
  expect(fixtureBasis(ARTIFACT, fixture(ARTIFACT, 'planned-usd'))).toBe('data');
  expect(screen.getAllByText('Arithmetic consistent')).toHaveLength(1);
  // $18.17 is not a PRD figure (the PRD implies it; TASK.md states it): its column says so.
  const remaining = screen.getByRole('group', { name: /^Remaining of the \$40 ceiling after the plan: Match\. Claimed 18\.17/ });
  expect(within(remaining).getByText('Claimed (TASK.md)')).toBeInTheDocument();
  expect(remaining).not.toHaveTextContent('Claimed (PRD)');
  expect(within(screen.getByRole('group', { name: /^Planned incl\. \$8\.10 posted: Match/ })).getByText('Claimed (PRD)')).toBeInTheDocument();
  expect(claimedLabelFor(fixture(ARTIFACT, 'remaining-usd'))).toBe('Claimed (TASK.md)');
  expect(claimedLabelFor(fixture(ARTIFACT, 'planned-usd'))).toBeUndefined();
});

test('B7 range rows follow a modified artifact: outside the range, matches false, matches null, and a flag that disagrees', async () => {
  const a = clone();
  Object.assign(fixture(a, 'full-grid-days'), { computed: 15.2, matches: false }); // really outside
  Object.assign(fixture(a, 'full-grid-usd'), { matches: false }); // inside by value, flag says no
  Object.assign(fixture(a, 'halved-dt-days'), { matches: null }); // not recomputable
  Object.assign(fixture(a, 'halved-dt-usd'), { computed: 6500.4 }); // outside by value, flag still true
  Object.assign(fixture(a, 'live-slot-usd'), { computed: 1.52, matches: false });
  a.scenarios.find((s) => s.id === 'gx-benchmark')!.provenance = {
    ...a.scenarios.find((s) => s.id === 'gx-benchmark')!.provenance,
    kind: 'derived',
    verification: { outcome: 'failed', details: 'synthetic' },
  };
  serve(null, a);
  render(<BudgetView livePollMs={60_000} />);

  const days = await screen.findByTestId('range-full-grid-days');
  expect(days).toHaveAttribute('data-outcome', 'outside');
  expect(days).toHaveAccessibleName('Full-grid stella wall time: Outside PRD range. PRD range 14 to 15 days, computed 15.20 days');
  expect(within(days).getByText('Outside PRD range')).toBeInTheDocument();

  const cost = screen.getByTestId('range-full-grid-usd');
  expect(cost).toHaveAttribute('data-outcome', 'outside');
  expect(cost).toHaveAccessibleName(
    'Full-grid stella cost: Outside PRD range. PRD range 3,100 to 3,200 USD, computed 3,173 USD. The match flag disagrees with the range test.',
  );
  expect(cost).toHaveTextContent('Match flag disagrees with the range test — treated as outside.');

  const halved = screen.getByTestId('range-halved-dt-days');
  expect(halved).toHaveAttribute('data-outcome', 'unknown');
  expect(halved).toHaveAccessibleName('Full-grid wall time, halved timestep: Not recomputable. PRD range 28 to 30 days, computed 28.90 days');
  expect(within(halved).queryByText('Inside PRD range')).toBeNull();

  const halvedCost = screen.getByTestId('range-halved-dt-usd');
  expect(halvedCost).toHaveAttribute('data-outcome', 'outside');
  expect(halvedCost).toHaveAccessibleName(
    'Full-grid cost, halved timestep: Outside PRD range. PRD range 6,200 to 6,400 USD, computed 6,500 USD. The match flag disagrees with the range test.',
  );
  expect(screen.queryByText('Inside PRD range')).toBeNull();

  // An ordinary fixture that stops matching is a mismatch; a scenario whose provenance changes is relabelled.
  expect(screen.getByRole('group', { name: /^Live slot, 15 min at \$6\.10\/h: Mismatch\. Claimed 1\.53 USD, computed 1\.52 USD, difference minus 0\.01/ })).toBeInTheDocument();
  const gx = screen.getByRole('article', { name: 'Published GPU-native GX bean benchmark scenario' });
  expect(gx).toHaveAttribute('data-kind', 'derived');
  expect(gx.querySelector('.bg-headline .lab-pill')).toHaveTextContent('Derived');
  expect(screen.getByRole('button', { name: 'Provenance of Published GPU-native GX bean benchmark: Derived, Failed' })).toBeInTheDocument();
  expect(screen.getAllByText('PRD-reported context')).toHaveLength(1);
});

test('B7 a range fixture that loses its range text shows the range as unavailable, never the midpoint as a PRD figure', async () => {
  const a = clone();
  const f = fixture(a, 'halved-dt-days');
  f.label = 'Full-grid wall time, halved timestep';
  f.note = 'midpoint';
  const g = fixture(a, 'full-grid-usd');
  g.label = 'Full-grid stella cost';
  delete g.note;
  serve(null, a);
  render(<BudgetView livePollMs={60_000} />);
  const row = await screen.findByTestId('range-halved-dt-days');
  expect(row).toHaveAttribute('data-outcome', 'unknown');
  expect(row).toHaveAccessibleName(
    'Full-grid wall time, halved timestep: PRD range unavailable. The artifact does not carry the PRD range, so no comparison is made. Computed 28.90 days',
  );
  expect(within(row).getByText('PRD range unavailable')).toBeInTheDocument();
  expect(row).toHaveTextContent('unavailable in the artifact');
  expect(row).toHaveTextContent('28.90 days');
  // The midpoint (29 / 3,150) is nowhere, and nothing in the row is labelled as a PRD claim or a match.
  expect(row).not.toHaveTextContent(/(^|[^0-9.])29([^0-9.]|$)/);
  expect(row).not.toHaveTextContent(/Claimed|Match|Inside PRD range/);
  const cost = screen.getByTestId('range-full-grid-usd');
  expect(cost).toHaveAttribute('data-outcome', 'unknown');
  expect(cost).not.toHaveTextContent(/3,?150/);
  expect(cost).toHaveTextContent('3,173 USD');
  expect(screen.queryByRole('group', { name: /Claimed 29\b|Claimed 3,?150/ })).toBeNull();
  expect(document.body).not.toHaveTextContent(/Claimed \(PRD\)\s*29(?![0-9.])/);

  expect(isRangeFixture(f)).toBe(true);
  expect(isRangeFixture(g)).toBe(true);
  expect(rangeFixture(f)).toMatchObject({ rangeAvailable: false, lo: null, hi: null, inside: null, unit: 'days' });
  expect(isRangeFixture(fixture(ARTIFACT, 'live-slot-usd'))).toBe(false);
});

test('B7 a scenario whose provenance kind is "live" is shown as a recorded run: an artifact can never earn the LIVE pill', async () => {
  const a = clone();
  const s = a.scenarios.find((x) => x.id === 'gx-benchmark')!;
  s.provenance = { ...s.provenance, kind: 'live' };
  serve(null, a);
  render(<BudgetView livePollMs={60_000} />);
  const card = await screen.findByRole('article', { name: 'Published GPU-native GX bean benchmark scenario' });
  const pill = card.querySelector('.bg-headline .lab-pill')!;
  expect(pill).toHaveAttribute('data-status', 'replay');
  expect(pill).toHaveTextContent('Recorded run');
  expect(document.querySelector('.lab-pill[data-status="live"]')).toBeNull();
  expect(document.body).not.toHaveTextContent(/\bLIVE\b/);
  // The card is not mislabelled as a derived estimate either.
  expect(screen.getAllByText('Derived estimate')).toHaveLength(2);
  expect(screen.getByText('Recorded run context')).toBeInTheDocument();
});

test('A3 budget: a missing or invalid artifact shows an error naming the file, never a blank view', async () => {
  serve(null, { error: 'gone' }, 404);
  const first = render(<BudgetView livePollMs={60_000} />);
  expect(screen.getByRole('heading', { name: 'Loading budget figures…' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Budget figures could not be loaded' })).toBeInTheDocument();
  expect(screen.getByRole('note', { name: /artifacts\/budget\.json failed to load/ })).toHaveTextContent('/artifacts/budget.json: HTTP 404');
  expect(screen.queryByTestId('ledger-bar')).toBeNull();
  first.unmount();

  serve(null, { ...ARTIFACT, schemaVersion: 2 });
  render(<BudgetView livePollMs={60_000} />);
  expect(await screen.findByRole('note', { name: /artifacts\/budget\.json failed to load/ })).toHaveTextContent('unexpected schemaVersion');
});

test('DS-1 / DS-19 fixture rows reflow by the width of their card, and the scenario grid never orphans a card', () => {
  const css = readFileSync(resolve(__dirname, 'budget.css'), 'utf8');
  // The rows sit in ~450–690 px cards on a 1440 px screen: a viewport media query never fires there.
  expect(css).toMatch(/\.bg-fixtures\s*\{[^}]*container-type:\s*inline-size/);
  expect(css).toMatch(/@container[^{]*\{[^@]*\.bg-range\s*\{[^}]*grid-template-columns/);
  expect(css).not.toMatch(/@media[^{]*\{[^@]*\.bg-range\b/);
  // Two columns or one, by the width of the view: never three plus an orphan.
  expect(css).toMatch(/\.bg-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  expect(css).not.toMatch(/auto-fit/);
  // Money columns align right.
  expect(css).toMatch(/\.bg-compare__row\s*>\s*:not\(:first-child\)\s*\{[^}]*text-align:\s*right/);
});
