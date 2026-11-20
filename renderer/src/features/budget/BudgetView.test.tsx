import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FixtureCheckData } from '../../design';
import type { LiveStatus } from '../../lib/liveStatus';
import { BudgetView } from './BudgetView';
import { checkBudget, claimUsd, claimedLabelFor, guardPlanStale, ledgerSegments, planChecks, usd, type BudgetArtifact, type GuardView } from './model';

const ARTIFACT: BudgetArtifact = JSON.parse(readFileSync(resolve(__dirname, '../../../../artifacts/budget.json'), 'utf8'));
const clone = (): BudgetArtifact => JSON.parse(JSON.stringify(ARTIFACT)) as BudgetArtifact;
const fixture = (a: BudgetArtifact, id: string): FixtureCheckData => a.fixtures.find((f) => f.id === id)!;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const RANGE_IDS = ['full-grid-days', 'full-grid-usd', 'halved-dt-days', 'halved-dt-usd'];
/** The midpoints an earlier artifact put in `claimed` (14.5 d, $3,150, 29 d, $6,300): the PRD never printed them. */
const MIDPOINT: Record<string, RegExp> = {
  'full-grid-days': /(^|[^0-9.,])14\.5([^0-9]|$)/,
  'full-grid-usd': /(^|[^0-9.])3,?150([^0-9]|$)/,
  'halved-dt-days': /(^|[^0-9.,])29(\.0+)?([^0-9.]|$)/,
  'halved-dt-usd': /(^|[^0-9.])6,?300([^0-9]|$)/,
};

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

  // The guard's plan comes from the artifact's guardPlan (the backend priced it with the guard itself,
  // D-023), labelled with that source beside the PRD's GPU-only figures: each number under its own
  // column header, and nothing claims to come from the API while it is unreachable.
  expect(compareTable()).toEqual([
    ['Item', 'PRD (GPU time only)', 'Guard (incl. setup, idle, storage)'],
    ['15-min live slot', '$1.53', '$2.65 · guard plan · budget.json'],
    ['One-hour rehearsal', '$6.10', '$7.73 · guard plan · budget.json'],
    ['Planned total incl. $8.10 posted', '$21.83', '$26.21 · guard plan · budget.json'],
  ]);
  expect(ARTIFACT.guardPlan).toMatchObject({ slotEstimateUsd: 2.65, rehearsalEstimateUsd: 7.73, plannedTotalUsd: 26.21 });
  expect(screen.getByTestId('guard-slot')).not.toHaveTextContent(/api\/live\/status/);
  expect(screen.getByTestId('guard-planned')).not.toHaveTextContent(/out of date/);
  expect(document.body).not.toHaveTextContent(/decision\.md · D-015/);
  // The guard's allowances are the artifact's own words (not PRD numbers), with the plan's hard timeouts.
  expect(screen.getByTestId('guard-assumptions')).toHaveTextContent(ARTIFACT.guardPlan.assumptions);
  expect(screen.getByTestId('guard-assumptions')).toHaveTextContent('Hard timeouts in the plan: live slot 1500 s, rehearsal 4500 s.');
  expect(screen.getByTestId('plan-vs-ceiling')).toHaveTextContent(
    'Both plans stay inside the $40.00 ceiling: PRD GPU-only plan $21.83, Guard plan $26.21.',
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
  expect(compareTable()[3]).toEqual(['Planned total incl. $8.10 posted', '$21.83', '$26.21 · guard plan · budget.json']);
  expect(screen.queryByRole('note', { name: /differs from the guard plan/ })).toBeNull();
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
  expect(compareTable()[3]).toEqual(['Planned total incl. $9.99 posted', '$30.50', '$26.21 · guard plan · budget.json']);
  expect(screen.getByTestId('plan-vs-ceiling')).toHaveTextContent(
    'Both plans stay inside the $50.00 ceiling: PRD GPU-only plan $30.50, Guard plan $26.21.',
  );
  first.unmount();

  // A ceiling the guard plan does not fit under: the statement changes, it is not fixed text.
  const tight = clone();
  tight.ceilingUsd = 25;
  serve(null, tight);
  const second = render(<BudgetView livePollMs={60_000} />);
  const warn = await screen.findByRole('note', { name: /Over the \$25\.00 ceiling: Guard plan$/ });
  expect(warn).toHaveTextContent('Guard plan $26.21 is $1.21 over the $25.00 ceiling');
  expect(warn).toHaveTextContent('PRD GPU-only plan $21.83 stays inside it');
  expect(document.body).not.toHaveTextContent(/Both plans stay inside/);
  second.unmount();

  const over = clone();
  over.ceilingUsd = 20;
  serve(null, over);
  const third = render(<BudgetView livePollMs={60_000} />);
  const both = await screen.findByRole('note', { name: /Both plans exceed the \$20\.00 ceiling/ });
  expect(both).toHaveTextContent('PRD GPU-only plan $21.83 is $1.83 over');
  expect(both).toHaveTextContent('Guard plan $26.21 is $6.21 over');
  expect(planChecks(over).map((p) => p.inside)).toEqual([false, false]);
  expect(planChecks(ARTIFACT).map((p) => p.inside)).toEqual([true, true]);
  expect(usd(-1.11)).toBe('−$1.11');
  third.unmount();

  // FB-2: every guard figure is the artifact's guardPlan (here: what the backend prices with a 10-min idle
  // margin), not a constant kept in the renderer. A $27 ceiling fits the committed $26.21 plan but not this one.
  const repriced = clone();
  repriced.ceilingUsd = 27;
  repriced.guardPlan = {
    slotEstimateUsd: 3.15,
    rehearsalEstimateUsd: 8.24,
    slotHardTimeoutS: 1800,
    rehearsalHardTimeoutS: 4800,
    plannedTotalUsd: 27.73,
    assumptions: 'Synthetic plan: 10 min idle margin per launch.',
  };
  serve(null, repriced);
  render(<BudgetView livePollMs={60_000} />);
  await screen.findByTestId('ledger-bar');
  expect(compareTable().slice(1).map((r) => r[2])).toEqual([
    '$3.15 · guard plan · budget.json',
    '$8.24 · guard plan · budget.json',
    '$27.73 · guard plan · budget.json',
  ]);
  expect(screen.getByTestId('guard-assumptions')).toHaveTextContent(
    'Synthetic plan: 10 min idle margin per launch. Hard timeouts in the plan: live slot 1800 s, rehearsal 4800 s.',
  );
  expect(screen.getByTestId('guard-assumptions')).not.toHaveTextContent(ARTIFACT.guardPlan.assumptions);
  const guardOver = screen.getByRole('note', { name: /Over the \$27\.00 ceiling: Guard plan$/ });
  expect(guardOver).toHaveTextContent('Guard plan $27.73 is $0.73 over the $27.00 ceiling. PRD GPU-only plan $21.83 stays inside it.');
});

test('B6 a live guard estimate that differs from the artifact guard plan marks the plan figures as possibly out of date', async () => {
  serve({ ...STATUS, budget: { ...STATUS.budget, billedUsd: 36, pendingUsd: 2, slotEstimateUsd: 3.11, slotFits: false } });
  const first = render(<BudgetView livePollMs={60_000} />);
  const guard = await screen.findByTestId('guard-live');
  expect(within(guard).getByText(/Next slot does NOT fit — replay only/)).toBeInTheDocument();
  expect(within(guard).getByText('−$1.11')).toBeInTheDocument(); // 40 − 36 − 2 − 3.11, never "$-1.11"
  expect(screen.getByTestId('guard-slot')).toHaveTextContent('$3.11 · from /api/live/status');
  // The rehearsal price and the planned total are still the plan's figures (no API field carries them):
  // they keep their source and say that the live estimate has moved away from it.
  expect(screen.getByTestId('guard-planned')).toHaveTextContent('$26.21 · guard plan · budget.json · may be out of date');
  expect(screen.getByTestId('guard-rehearsal')).toHaveTextContent('$7.73 · guard plan · budget.json · may be out of date');
  const stale = screen.getByRole('note', { name: /live guard estimate differs from the guard plan in the artifact/ });
  expect(stale).toHaveTextContent('The guard now estimates the next slot at $3.11; the plan in artifacts/budget.json was priced with $2.65.');
  first.unmount();

  // The comparison is with the artifact's plan, not a constant: a plan priced at $3.11 agrees with a live $3.11 …
  const same = clone();
  same.guardPlan = { ...same.guardPlan, slotEstimateUsd: 3.11 };
  serve({ ...STATUS, budget: { ...STATUS.budget, slotEstimateUsd: 3.11 } }, same);
  const second = render(<BudgetView livePollMs={60_000} />);
  await screen.findByTestId('guard-live');
  expect(screen.getByTestId('guard-planned')).not.toHaveTextContent(/out of date/);
  expect(screen.queryByRole('note', { name: /differs from the guard plan/ })).toBeNull();
  second.unmount();

  // … and disagrees with the live $2.65 the committed plan would have matched.
  serve(STATUS, same);
  render(<BudgetView livePollMs={60_000} />);
  await screen.findByTestId('guard-live');
  expect(screen.getByTestId('guard-planned')).toHaveTextContent(/may be out of date/);
  expect(screen.getByRole('note', { name: /differs from the guard plan/ })).toHaveTextContent('was priced with $3.11');

  // Cents decide, not float noise; no live answer is never "stale".
  const view = (slot: number) => ({ slotEstimateUsd: slot }) as GuardView;
  expect(guardPlanStale(view(2.6500000001), ARTIFACT.guardPlan)).toBe(false);
  expect(guardPlanStale(view(2.66), ARTIFACT.guardPlan)).toBe(true);
  expect(guardPlanStale(null, ARTIFACT.guardPlan)).toBe(false);
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

  // FB-1, range fixtures (D-023): `claimed` is null and the PRD range is `claimedRange`. The row shows
  // "PRD range lo–hi unit" and the computed value checked lo ≤ computed ≤ hi; no midpoint anywhere.
  const row = (f: FixtureCheckData) => screen.getByRole('group', { name: new RegExp(`^${escapeRe(f.label)}: `) });
  const SPOKEN: Record<string, string> = {
    'full-grid-days': 'Full-grid stella wall time: Arithmetic in PRD range. PRD range 14 to 15 days, computed 14.45 days, distance to the range 0.00',
    'full-grid-usd': 'Full-grid stella cost: Arithmetic in PRD range. PRD range 3100 to 3200 USD, computed 3172.76 USD, distance to the range 0.00',
    'halved-dt-days': 'Full-grid wall time, halved timestep: Arithmetic in PRD range. PRD range 28 to 30 days, computed 28.90 days, distance to the range 0.00',
    'halved-dt-usd': 'Full-grid cost, halved timestep: Arithmetic in PRD range. PRD range 6200 to 6400 USD, computed 6345.52 USD, distance to the range 0.00',
  };
  for (const id of RANGE_IDS) {
    const f = fixture(ARTIFACT, id);
    expect(f.claimed).toBeNull();
    expect(f.claimedRange).toHaveLength(2);
    const r = row(f);
    expect(r).toHaveAccessibleName(SPOKEN[id]);
    expect(r).toHaveAttribute('data-claim', 'range');
    expect(r).toHaveAttribute('data-outcome', 'match');
    expect(within(r).getByText('PRD range')).toBeInTheDocument();
    expect(r).not.toHaveTextContent(/midpoint|Claimed/i);
    expect(r).not.toHaveTextContent(MIDPOINT[id]!);
  }
  expect(row(fixture(ARTIFACT, 'full-grid-usd')).querySelector('[data-testid="claimed"]')).toHaveTextContent(/^3100–3200\s*USD$/);
  expect(screen.getAllByText('Arithmetic in PRD range')).toHaveLength(4);
  expect(document.querySelector('.bg-range')).toBeNull();

  // FB-3: what a match is backed by is the fixture's own `basis` (absent = data), never a list kept here.
  for (const f of ARTIFACT.fixtures) expect(row(f)).toHaveAttribute('data-basis', f.basis ?? 'data');
  expect(ARTIFACT.fixtures.filter((f) => f.basis === 'arithmetic').map((f) => f.id)).toEqual([
    'live-slot-usd', 'rehearsals-plus-slot-usd', 'planned-usd', 'remaining-usd', 'stella-published-cpu-h', ...RANGE_IDS,
  ]);
  // 161 h × 288 = 46,368 only redoes the arithmetic on PRD-reported inputs: "Arithmetic consistent", never "Match".
  const published = screen.getByRole('group', { name: /^Published stella bean: 161 h × 288 processors: Arithmetic consistent\. Claimed 46368 CPU-h, computed 46368 CPU-h/ });
  expect(within(published).queryByText('Match')).toBeNull();
  expect(screen.getByRole('group', { name: /^Live slot, 15 min at \$6\.10\/h: Arithmetic consistent\. Claimed 1\.53 USD, computed 1\.53 USD/ })).toBeInTheDocument();
  expect(screen.getAllByText('Arithmetic consistent')).toHaveLength(5);
  expect(screen.queryByText('Match')).toBeNull();
  expect(screen.getByRole('group', { name: /^GX bean benchmark, 1 GPU, 4×8: Not recomputable\. Claimed 28 min, computed value not available$/ })).toHaveAttribute('data-basis', 'data');
  // $18.17 is not a PRD figure (the PRD implies it; TASK.md states it): its column says so.
  const remaining = screen.getByRole('group', { name: /^Remaining of the \$40 ceiling after the plan: Arithmetic consistent\. Claimed 18\.17/ });
  expect(within(remaining).getByText('Claimed (TASK.md)')).toBeInTheDocument();
  expect(remaining).not.toHaveTextContent('Claimed (PRD)');
  expect(within(screen.getByRole('group', { name: /^Planned incl\. \$8\.10 posted: Arithmetic consistent/ })).getByText('Claimed (PRD)')).toBeInTheDocument();
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
  const group = (label: string) => screen.getByRole('group', { name: new RegExp(`^${escapeRe(label)}: `) });

  await screen.findByTestId('ledger-bar');
  const days = group('Full-grid stella wall time');
  expect(days).toHaveAttribute('data-outcome', 'mismatch');
  expect(days).toHaveAccessibleName('Full-grid stella wall time: Outside PRD range. PRD range 14 to 15 days, computed 15.20 days, distance to the range plus 0.20');
  expect(within(days).getByText('Outside PRD range')).toBeInTheDocument();

  const cost = group('Full-grid stella cost');
  expect(cost).toHaveAttribute('data-outcome', 'mismatch');
  expect(cost).toHaveAccessibleName(
    'Full-grid stella cost: Mismatch. PRD range 3100 to 3200 USD, computed 3172.76 USD, distance to the range 0.00. The match flag disagrees with the range test.',
  );
  expect(cost).toHaveTextContent('Match flag disagrees with the range test — treated as a mismatch.');

  const halved = group('Full-grid wall time, halved timestep');
  expect(halved).toHaveAttribute('data-outcome', 'unknown');
  expect(halved).toHaveAccessibleName('Full-grid wall time, halved timestep: Not recomputable. PRD range 28 to 30 days, computed 28.90 days, distance to the range 0.00');
  expect(within(halved).getByText('PRD range')).toBeInTheDocument();

  const halvedCost = group('Full-grid cost, halved timestep');
  expect(halvedCost).toHaveAttribute('data-outcome', 'mismatch');
  expect(halvedCost).toHaveAccessibleName(
    'Full-grid cost, halved timestep: Outside PRD range. PRD range 6200 to 6400 USD, computed 6500.40 USD, distance to the range plus 100.40. The match flag disagrees with the range test.',
  );
  expect(screen.queryByText(/Inside PRD range|Arithmetic in PRD range/)).toBeNull();
  for (const id of RANGE_IDS) expect(group(fixture(a, id).label)).not.toHaveTextContent(MIDPOINT[id]!);

  // An ordinary fixture that stops matching is a mismatch; a scenario whose provenance changes is relabelled.
  expect(screen.getByRole('group', { name: /^Live slot, 15 min at \$6\.10\/h: Mismatch\. Claimed 1\.53 USD, computed 1\.52 USD, difference minus 0\.01/ })).toBeInTheDocument();
  const gx = screen.getByRole('article', { name: 'Published GPU-native GX bean benchmark scenario' });
  expect(gx).toHaveAttribute('data-kind', 'derived');
  expect(gx.querySelector('.bg-headline .lab-pill')).toHaveTextContent('Derived');
  expect(screen.getByRole('button', { name: 'Provenance of Published GPU-native GX bean benchmark: Derived, Failed' })).toBeInTheDocument();
  expect(screen.getAllByText('PRD-reported context')).toHaveLength(1);
});

test('FB-1 a range is read from claimedRange only: no range and no claim shows "—", prose is never parsed, an old midpoint is never shown', async () => {
  const a = clone();
  // No claimedRange and claimed null: the PRD value is not available. The label still carries the old
  // "PRD range [..]" prose, which must not be read back into a range.
  const f = fixture(a, 'halved-dt-days');
  delete f.claimedRange;
  f.label = 'Full-grid wall time, halved timestep — PRD range [28, 30] days';
  // An old artifact's midpoint beside the range (the schema now forbids it): the range still wins.
  fixture(a, 'full-grid-usd').claimed = 3150;
  // The PRD column of the guard table reads the same fixture: no claim, no figure.
  Object.assign(fixture(a, 'live-slot-usd'), { claimed: null, matches: null });
  serve(null, a);
  const first = render(<BudgetView livePollMs={60_000} />);
  await screen.findByTestId('ledger-bar');

  const none = screen.getByRole('group', { name: /^Full-grid wall time, halved timestep — PRD range \[28, 30\] days: / });
  expect(none).toHaveAccessibleName(
    'Full-grid wall time, halved timestep — PRD range [28, 30] days: No PRD value. Claimed value not available, computed 29 days',
  );
  expect(none).toHaveAttribute('data-claim', 'none');
  expect(none).toHaveAttribute('data-outcome', 'unknown');
  expect(within(none).getByTestId('claimed')).toHaveTextContent(/^—$/);
  expect(within(none).getByText('No PRD value')).toBeInTheDocument();
  expect(within(none).queryByText('PRD range')).toBeNull();

  const cost = screen.getByRole('group', { name: /^Full-grid stella cost: / });
  expect(cost).toHaveAccessibleName('Full-grid stella cost: Arithmetic in PRD range. PRD range 3100 to 3200 USD, computed 3172.76 USD, distance to the range 0.00');
  expect(cost).not.toHaveTextContent(MIDPOINT['full-grid-usd']!);
  expect(screen.queryByRole('group', { name: /Claimed 3,?150/ })).toBeNull();

  expect(screen.getByTestId('prd-slot')).toHaveTextContent(/^—$/);
  expect(screen.getByRole('group', { name: /^Live slot, 15 min at \$6\.10\/h: No PRD value\. Claimed value not available, computed 1\.53 USD$/ })).toBeInTheDocument();
  first.unmount();

  // A slot price the PRD printed as a range is shown as that range in the guard table, never collapsed.
  const ranged = clone();
  Object.assign(fixture(ranged, 'live-slot-usd'), { claimed: null, claimedRange: [1.5, 1.6] });
  serve(null, ranged);
  render(<BudgetView livePollMs={60_000} />);
  await screen.findByTestId('ledger-bar');
  expect(screen.getByTestId('prd-slot')).toHaveTextContent(/^\$1\.50–\$1\.60$/);
  expect(screen.getByRole('group', { name: /^Live slot, 15 min at \$6\.10\/h: Arithmetic in PRD range\. PRD range 1\.50 to 1\.60 USD/ })).toHaveAttribute('data-claim', 'range');
  expect(screen.getByTestId('prd-slot')).not.toHaveTextContent('1.55');
  expect(claimUsd({ ...fixture(ranged, 'live-slot-usd'), claimedRange: [1.6, 1.5] })).toBe('$1.50–$1.60');
  expect(claimUsd(undefined)).toBe('—');
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
  const second = render(<BudgetView livePollMs={60_000} />);
  expect(await screen.findByRole('note', { name: /artifacts\/budget\.json failed to load/ })).toHaveTextContent('unexpected schemaVersion');
  second.unmount();

  // An artifact from before D-023 has no guardPlan: named, never a half-drawn guard panel.
  const old: Partial<BudgetArtifact> = clone();
  delete old.guardPlan;
  serve(null, old);
  render(<BudgetView livePollMs={60_000} />);
  expect(await screen.findByRole('note', { name: /artifacts\/budget\.json failed to load/ })).toHaveTextContent(
    'artifacts/budget.json: guardPlan is missing (contract D-023)',
  );
  expect(screen.queryByTestId('ledger-bar')).toBeNull();
  expect(checkBudget(ARTIFACT)).toBeNull();
  expect(checkBudget({ ...ARTIFACT, guardPlan: { ...ARTIFACT.guardPlan, plannedTotalUsd: Number.NaN } })).toBe('guardPlan.plannedTotalUsd is not a number');
  expect(checkBudget({ ...ARTIFACT, fixtures: undefined as unknown as FixtureCheckData[] })).toBe('scenarios or fixtures is missing');
});

test('DS-1 / DS-19 fixture rows reflow by the width of their card, and the scenario grid never orphans a card', () => {
  const css = readFileSync(resolve(__dirname, 'budget.css'), 'utf8');
  // The rows sit in ~450–690 px cards on a 1440 px screen: a viewport media query never fires there, so
  // the FixtureCheck rows (PRD ranges included) measure this wrapper. The hand-built range row is gone.
  expect(css).toMatch(/\.bg-fixtures\s*\{[^}]*container-type:\s*inline-size/);
  expect(css).not.toMatch(/\.bg-range/);
  // Two columns or one, by the width of the view: never three plus an orphan.
  expect(css).toMatch(/\.bg-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  expect(css).not.toMatch(/auto-fit/);
  // Money columns align right.
  expect(css).toMatch(/\.bg-compare__row\s*>\s*:not\(:first-child\)\s*\{[^}]*text-align:\s*right/);
});
