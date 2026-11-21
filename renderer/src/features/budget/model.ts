// Budget view data -> props logic (pure).
// A fixture row is drawn by the design system's FixtureCheck from the artifact alone: a PRD range comes
// from `claimedRange` and the basis of a match from `basis` (D-023), never from a list kept here.
import type { FixtureCheckData, Provenance, ProvenanceKind } from '../../design';
import { REPLAY_PILL, modePills, type LiveState } from '../../lib/liveStatus';

/**
 * The text of a panel's replay pill: "Replay · $0" only while the header's mode pills show it (DESIGN.md §5,
 * REPLAY_PILL), otherwise plain "Replay": $0 is not known during a danger, a launch, a live session, a
 * session that still lists workers or a status still being checked.
 */
export function replayPillText(s: LiveState): string {
  return modePills(s).some((p) => p.status === REPLAY_PILL.status && p.text === REPLAY_PILL.text) ? REPLAY_PILL.text : 'Replay';
}

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
/**
 * The live budget guard's own plan (D-015, D-023), computed by the backend with the guard itself:
 * posted spend + rehearsals + one live slot, each priced with setup, idle and storage/egress allowances.
 */
export interface GuardPlan {
  slotEstimateUsd: number;
  rehearsalEstimateUsd: number;
  slotHardTimeoutS: number;
  rehearsalHardTimeoutS: number;
  plannedTotalUsd: number;
  /** The guard's allowances (not PRD numbers) and whether every step fits the ceiling, in words. */
  assumptions: string;
}
export interface BudgetArtifact {
  schemaVersion: 1;
  ceilingUsd: number;
  postedUsd: number;
  /** The PRD's plan: Includes GPU, CPU and RAM. */
  plannedUsd: number;
  remainingAfterPlanUsd: number;
  scenarios: BudgetScenario[];
  fixtures: FixtureCheckData[];
  guardPlan: GuardPlan;
}

/** Structural check beyond schemaVersion: a budget artifact without the guard's plan is named, not half-drawn. */
export function checkBudget(a: BudgetArtifact): string | null {
  if (!Array.isArray(a.scenarios) || !Array.isArray(a.fixtures)) return 'scenarios or fixtures is missing';
  const g = a.guardPlan as Partial<GuardPlan> | undefined;
  if (!g || typeof g !== 'object') return 'guardPlan is missing (contract D-023)';
  for (const k of ['slotEstimateUsd', 'rehearsalEstimateUsd', 'plannedTotalUsd'] as const)
    if (typeof g[k] !== 'number' || !Number.isFinite(g[k])) return `guardPlan.${k} is not a number`;
  return null;
}

export interface LedgerSegment {
  id: 'posted' | 'plan' | 'remaining';
  label: string;
  usd: number;
  /** Share of the ceiling, 0–100. */
  pct: number;
  /** Where the figure comes from (null: the artifact does not say, so no kind is claimed). */
  kind: ProvenanceKind | null;
}

/** The scenario the PRD ledger's plan, remaining and planned total are computed from (the backend's live ledger). */
export const LEDGER_SCENARIO = 'live-demo';

/**
 * The provenance kind of the ledger's computed figures: the live-demo scenario's own kind in the artifact, never a
 * kind assumed here. Today "prd-reported" (an arithmetic re-check of PRD inputs), not "derived" (computed from
 * archives, common.schema.json). Null when the artifact has no live-demo scenario.
 */
export function ledgerKind(a: BudgetArtifact): ProvenanceKind | null {
  return a.scenarios.find((s) => s.id === LEDGER_SCENARIO)?.provenance?.kind ?? null;
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
  const kind = ledgerKind(a);
  return [
    // The posted spend is an amount the PRD reports, not something computed.
    { id: 'posted', label: 'Posted earlier', usd: a.postedUsd, pct: pct(a.postedUsd), kind: 'prd-reported' },
    { id: 'plan', label: planLabel(a), usd: plan, pct: pct(plan), kind },
    { id: 'remaining', label: 'Remaining', usd: a.remainingAfterPlanUsd, pct: pct(a.remainingAfterPlanUsd), kind },
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

export interface GuardSegment {
  id: 'posted' | 'pending' | 'slot';
  /** Share of the ceiling, 0–100; together never more than 100. */
  pct: number;
}

/**
 * The guard bar: billed, pending, next slot. Each segment gets at most what is left of the bar, so a total
 * above the ceiling fills it exactly and `overUsd` (> 0) says by how much the total exceeds the ceiling.
 */
export function guardSegments(g: GuardView): { segments: GuardSegment[]; overUsd: number } {
  let left = 100;
  const seg = (id: GuardSegment['id'], v: number): GuardSegment => {
    const raw = g.ceilingUsd > 0 && Number.isFinite(v) ? (Math.max(0, v) / g.ceilingUsd) * 100 : 0;
    const pct = Math.min(left, raw);
    left -= pct;
    return { id, pct };
  };
  const segments = [seg('posted', g.billedUsd), seg('pending', g.pendingUsd), seg('slot', g.slotEstimateUsd)];
  // The guard's own test: unrounded, with 1e-9 for float noise only (budget_guard.py).
  const overUsd = g.afterSlotUsd > g.ceilingUsd + 1e-9 ? g.afterSlotUsd - g.ceilingUsd : 0;
  return { segments, overUsd };
}

/** The guard's own refusal clause ("Budget guard refused: …") when the status reason carries one. */
export function guardRefusal(reason: string | null | undefined): string | null {
  const i = (reason ?? '').indexOf('Budget guard refused:');
  return i < 0 ? null : (reason as string).slice(i).trim();
}

/**
 * True when the live guard answered and its slot estimate is no longer the one the artifact's guard
 * plan was priced with: the plan's other figures (rehearsal, total) may then be out of date.
 */
export function guardPlanStale(guard: GuardView | null, plan: GuardPlan): boolean {
  return guard !== null && Math.round(guard.slotEstimateUsd * 100) !== Math.round(plan.slotEstimateUsd * 100);
}

/** The two plans are never merged: the PRD prices allocated resources, and the guard adds allowances. */
export const PRD_PLAN_LABEL = 'PRD base estimate';
export const GUARD_PLAN_LABEL = 'Guard plan';

export interface PlanCheck {
  label: string;
  usd: number;
  inside: boolean;
  /** Dollars over the ceiling (0 when inside). */
  overBy: number;
}

/** Each plan against the artifact's ceiling: the "stays inside" statement is computed, not typed in. */
export function planChecks(a: BudgetArtifact): PlanCheck[] {
  const check = (label: string, v: number): PlanCheck => {
    const over = Math.round((v - a.ceilingUsd) * 100) / 100;
    return { label, usd: v, inside: over <= 0, overBy: Math.max(0, over) };
  };
  return [check(PRD_PLAN_LABEL, a.plannedUsd), check(GUARD_PLAN_LABEL, a.guardPlan.plannedTotalUsd)];
}

/**
 * What the PRD prints for a fixture, in dollars: its single value, its range (D-023: a range is
 * never collapsed to a midpoint), or "—" when it prints neither.
 */
export function claimUsd(f: FixtureCheckData | undefined): string {
  if (!f) return '—';
  if (f.claimedRange) {
    const [a, b] = f.claimedRange;
    return `${usd(Math.min(a, b))}–${usd(Math.max(a, b))}`;
  }
  return f.claimed === null ? '—' : usd(f.claimed);
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
 * Column label for the claimed value when the claim is not a figure the PRD prints: the contract's
 * `claimSource` "task" (D-023), never the note's prose. Such a value must not sit under "Claimed (PRD)".
 * A range keeps FixtureCheck's own "TASK.md range" label. Undefined keeps the default label.
 */
export function claimedLabelFor(f: FixtureCheckData): string | undefined {
  return f.claimSource === 'task' && !f.claimedRange ? 'Claimed (TASK.md)' : undefined;
}
