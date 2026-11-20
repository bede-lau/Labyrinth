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

/** PRD ledger against the ceiling: posted, newly planned (rehearsals + slot), remaining. */
export function ledgerSegments(a: BudgetArtifact): LedgerSegment[] {
  const pct = (v: number) => Math.max(0, Math.min(100, (v / a.ceilingUsd) * 100));
  const plan = a.plannedUsd - a.postedUsd;
  return [
    { id: 'posted', label: 'Posted earlier', usd: a.postedUsd, pct: pct(a.postedUsd) },
    { id: 'plan', label: 'Planned: 2 rehearsals + 1 live slot', usd: plan, pct: pct(plan) },
    { id: 'remaining', label: 'Remaining', usd: a.remainingAfterPlanUsd, pct: pct(a.remainingAfterPlanUsd) },
  ];
}

export const usd = (v: number) =>
  `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
 * rehearsal estimate or the planned total yet). Shown with that source, never as PRD numbers.
 */
export const GUARD_PLAN_D015 = {
  source: 'decision.md · D-015',
  slotUsd: 2.65,
  slotHardTimeoutS: 1500,
  rehearsalUsd: 7.73,
  rehearsalHardTimeoutS: 4500,
  plannedUsd: 26.21,
} as const;

export interface RangeFixture {
  id: string;
  label: string;
  lo: number;
  hi: number;
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

export function isRangeFixture(f: FixtureCheckData): boolean {
  return RANGE.test(f.label) || RANGE.test(f.note ?? '');
}

/** A range fixture: the PRD prints only a range, so the range is shown — never the midpoint. */
export function rangeFixture(f: FixtureCheckData): RangeFixture | null {
  const m = RANGE.exec(f.label) ?? RANGE.exec(f.note ?? '');
  if (!m) return null;
  const lo = num(m[1] as string);
  const hi = num(m[2] as string);
  const unit = m[3] ?? '';
  const computed = f.computed;
  const inRange = computed === null ? null : computed >= lo && computed <= hi;
  const inside = inRange === null || f.matches === null ? null : inRange && f.matches;
  const decimals = unit === 'USD' ? 0 : 2;
  return {
    id: f.id,
    label: f.label.replace(/\s*[—-]\s*PRD range \[.*$/, '').trim(),
    lo,
    hi,
    loText: m[1] as string,
    hiText: m[2] as string,
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
