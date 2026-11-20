// Budget view data -> props logic (pure).
import type { FixtureCheckData, Provenance } from '../../design';
import type { LiveState } from '../../lib/liveStatus';

/** TS mirror of contracts/budget.schema.json. */
export interface BudgetScenario {
  id: string;
  title: string;
  headline: string;
  inputs: Record<string, number | string>;
  derivation: string;
  interpretation: string;
  provenance: Provenance;
}
export interface BudgetArtifact {
  schemaVersion: 1;
  ceilingUsd: number;
  postedUsd: number;
  plannedUsd: number;
  remainingAfterPlanUsd: number;
  scenarios: BudgetScenario[];
  fixtures: FixtureCheckData[];
}

export interface LedgerSegment {
  id: 'posted' | 'plan' | 'remaining';
  label: string;
  usd: number;
  /** Share of the ceiling, 0–100. */
  pct: number;
}

/** "Planned: 2 rehearsals + 1 live slot", with the rehearsal count read from the live-demo scenario inputs. */
export function planLabel(a: BudgetArtifact): string {
  const n = Number(a.scenarios.find((s) => s.id === 'live-demo')?.inputs.rehearsals);
  return Number.isInteger(n) && n > 0 ? `Planned: ${n} rehearsal${n === 1 ? '' : 's'} + 1 live slot` : 'Planned: rehearsals + live slot';
}

/** PRD ledger against the ceiling: posted, newly planned (rehearsals + slot), remaining. */
export function ledgerSegments(a: BudgetArtifact): LedgerSegment[] {
  const pct = (v: number) => Math.max(0, Math.min(100, (v / a.ceilingUsd) * 100));
  const plan = a.plannedUsd - a.postedUsd;
  return [
    { id: 'posted', label: 'Posted earlier', usd: a.postedUsd, pct: pct(a.postedUsd) },
    { id: 'plan', label: planLabel(a), usd: plan, pct: pct(plan) },
    { id: 'remaining', label: 'Remaining', usd: a.remainingAfterPlanUsd, pct: pct(a.remainingAfterPlanUsd) },
  ];
}

/** Dollars with two decimals and a true minus sign in front of the currency symbol (−$1.11, never $-1.11). */
export const usd = (v: number) => {
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 && Number(abs.replace(/,/g, '')) !== 0 ? `−$${abs}` : `$${abs}`;
};

export interface GuardView {
  ceilingUsd: number;
  billedUsd: number;
  pendingUsd: number;
  slotEstimateUsd: number;
  afterSlotUsd: number;
  remainingAfterSlotUsd: number;
  slotFits: boolean;
  hardTimeoutS: number | null;
  mode: string;
}

/** The live budget guard's own numbers — only when /api/live/status answered. */
export function guardView(s: LiveState): GuardView | null {
  if (s.status !== 'ready') return null;
  const b = s.data.budget;
  const after = b.billedUsd + b.pendingUsd + b.slotEstimateUsd;
  return {
    ceilingUsd: b.ceilingUsd,
    billedUsd: b.billedUsd,
    pendingUsd: b.pendingUsd,
    slotEstimateUsd: b.slotEstimateUsd,
    afterSlotUsd: after,
    remainingAfterSlotUsd: b.ceilingUsd - after,
    slotFits: b.slotFits,
    hardTimeoutS: b.hardTimeoutS ?? null,
    mode: s.data.mode,
  };
}

/**
 * The guard's planning figures recorded in decision.md D-015 (no artifact or API field carries the
 * rehearsal estimate or the planned total yet). Shown with that source, never as PRD numbers, and
 * marked as possibly out of date as soon as the live guard reports a different slot estimate.
 */
export const GUARD_PLAN_D015 = {
  source: 'decision.md · D-015',
  slotUsd: 2.65,
  slotHardTimeoutS: 1500,
  rehearsalUsd: 7.73,
  rehearsalHardTimeoutS: 4500,
  plannedUsd: 26.21,
} as const;

/** True when the live guard answered and its slot estimate is no longer the one D-015 planned with. */
export function guardPlanStale(guard: GuardView | null, planSlotUsd: number = GUARD_PLAN_D015.slotUsd): boolean {
  return guard !== null && Math.round(guard.slotEstimateUsd * 100) !== Math.round(planSlotUsd * 100);
}

export interface PlanCheck {
  label: string;
  usd: number;
  inside: boolean;
  /** Dollars over the ceiling (0 when inside). */
  overBy: number;
}

/** Each plan against the artifact's ceiling: the "stays inside" statement is computed, not typed in. */
export function planChecks(a: BudgetArtifact, guardPlannedUsd: number): PlanCheck[] {
  const check = (label: string, v: number): PlanCheck => {
    const over = Math.round((v - a.ceilingUsd) * 100) / 100;
    return { label, usd: v, inside: over <= 0, overBy: Math.max(0, over) };
  };
  return [check('PRD plan', a.plannedUsd), check('D-015 guard plan', guardPlannedUsd)];
}

export interface RangeFixture {
  id: string;
  label: string;
  /** False when neither the label nor the note carries "PRD range [lo, hi]": the range is then shown as unavailable. */
  rangeAvailable: boolean;
  lo: number | null;
  hi: number | null;
  loText: string;
  hiText: string;
  unit: string;
  computed: number | null;
  computedText: string;
  inside: boolean | null;
  /** The backend's flag disagrees with the range test — shown, treated as outside. */
  inconsistent: boolean;
}

const RANGE = /PRD range \[([0-9][0-9,]*(?:\.[0-9]+)?),\s+([0-9][0-9,]*(?:\.[0-9]+)?)\]\s*([A-Za-z$-]+)?/;
const num = (s: string) => Number(s.replace(/,/g, ''));

/**
 * The four fixtures whose `claimed` is the midpoint of a PRD range (interface.md §2 item 7). They are
 * named here because the contract has no `claimedRange` field yet (interface.md §10): recognising them
 * by prose alone would let the midpoint through as a "Claimed (PRD)" figure the day the prose changes.
 */
export const RANGE_FIXTURE_IDS: readonly string[] = ['full-grid-days', 'full-grid-usd', 'halved-dt-days', 'halved-dt-usd'];

export function isRangeFixture(f: FixtureCheckData): boolean {
  return (
    RANGE_FIXTURE_IDS.includes(f.id) ||
    RANGE.test(f.label) ||
    RANGE.test(f.note ?? '') ||
    /midpoint of (?:the )?PRD range/i.test(`${f.label} ${f.note ?? ''}`)
  );
}

/** A range fixture: the PRD prints only a range, so the range is shown — never the midpoint. */
export function rangeFixture(f: FixtureCheckData): RangeFixture {
  const m = RANGE.exec(f.label) ?? RANGE.exec(f.note ?? '');
  const lo = m ? num(m[1] as string) : null;
  const hi = m ? num(m[2] as string) : null;
  const unit = m?.[3] ?? (fixtureUnit(f) === 'dimensionless' ? '' : fixtureUnit(f));
  const computed = f.computed;
  const inRange = computed === null || lo === null || hi === null ? null : computed >= lo && computed <= hi;
  const inside = inRange === null || f.matches === null ? null : inRange && f.matches;
  const decimals = unit === 'USD' ? 0 : 2;
  return {
    id: f.id,
    label: f.label.replace(/\s*[—-]\s*PRD range \[.*$/, '').trim(),
    rangeAvailable: m !== null,
    lo,
    hi,
    loText: m ? (m[1] as string) : '',
    hiText: m ? (m[2] as string) : '',
    unit,
    computed,
    computedText:
      computed === null
        ? '—'
        : computed.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
    inside,
    inconsistent: inRange !== null && f.matches !== null && inRange !== f.matches,
  };
}

/** Which fixtures belong under which scenario card. Unlisted fixtures go to "Other fixtures". */
export const SCENARIO_FIXTURES: Record<string, string[]> = {
  'live-demo': ['live-slot-usd', 'rehearsals-plus-slot-usd', 'planned-usd', 'remaining-usd'],
  'stella-published': ['stella-published-cpu-h'],
  'full-grid-modal': ['full-grid-days', 'full-grid-usd', 'halved-dt-days', 'halved-dt-usd'],
  'gx-benchmark': ['gx-1gpu-min', 'gx-4gpu-min'],
};

export function fixturesFor(a: BudgetArtifact, scenarioId: string): FixtureCheckData[] {
  const ids = SCENARIO_FIXTURES[scenarioId] ?? [];
  return ids.map((id) => a.fixtures.find((f) => f.id === id)).filter((f): f is FixtureCheckData => !!f);
}

export function unassignedFixtures(a: BudgetArtifact): FixtureCheckData[] {
  const known = new Set(
    a.scenarios.flatMap((s) => SCENARIO_FIXTURES[s.id] ?? []),
  );
  return a.fixtures.filter((f) => !known.has(f.id));
}

export function fixtureUnit(f: FixtureCheckData): string {
  if (/-usd$/.test(f.id)) return 'USD';
  if (/cpu-h$/.test(f.id)) return 'CPU-h';
  if (/-min$/.test(f.id)) return 'min';
  if (/-days$/.test(f.id)) return 'days';
  return 'dimensionless';
}

/**
 * Column label for the claimed value when the claim is not a figure the PRD prints. The artifact says
 * so in the fixture note ("value from tasks/04-budget/TASK.md (the PRD implies it but does not print
 * it)"); such a value must not sit under "Claimed (PRD)". Undefined keeps the default label.
 */
export function claimedLabelFor(f: FixtureCheckData): string | undefined {
  return /value from \S*TASK\.md/.test(f.note ?? '') ? 'Claimed (TASK.md)' : undefined;
}

/**
 * What a matching fixture row is backed by (DS-13). A value "recomputed" from inputs that are
 * themselves PRD-reported (161 h × 288 processors = 46,368) only shows the arithmetic is consistent;
 * it is not a data-backed match. Read from the artifact: the fixture's scenario is PRD-reported, or
 * its note says "inputs are PRD-reported".
 */
export function fixtureBasis(a: BudgetArtifact, f: FixtureCheckData): 'data' | 'arithmetic' {
  const scenario = a.scenarios.find((s) => (SCENARIO_FIXTURES[s.id] ?? []).includes(f.id));
  return scenario?.provenance.kind === 'prd-reported' || /inputs are PRD-reported/i.test(f.note ?? '') ? 'arithmetic' : 'data';
}
