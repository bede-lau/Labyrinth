// Budget (task 04, B6–B7): PRD ledger to the $40 ceiling, the guard's own plan from the artifact and
// its live estimate when the API answers (both distinct from the PRD's GPU-only figures), and scenario
// cards with headline, derivation and interpretation. Every fixture row, PRD ranges included, is the
// design system's FixtureCheck fed straight from the artifact (D-023): never a midpoint.
import {
  Callout,
  FixtureCheck,
  Icon,
  Panel,
  ProvenanceBadge,
  StatusPill,
  provenanceStatus,
  type FixtureCheckData,
} from '../../design';
import { useArtifact } from '../../lib/artifacts';
import { useLiveStatus } from '../../lib/liveStatus';
import {
  checkBudget,
  claimUsd,
  claimedLabelFor,
  fixtureUnit,
  fixturesFor,
  guardPlanStale,
  guardView,
  ledgerSegments,
  planChecks,
  unassignedFixtures,
  usd,
  type BudgetArtifact,
  type BudgetScenario,
  type GuardView,
  type PlanCheck,
} from './model';
import './budget.css';

/** Where the guard's planned figures come from when the live guard does not supply them. */
export const GUARD_PLAN_SOURCE = 'guard plan · budget.json';

export interface BudgetViewProps {
  livePollMs?: number;
}

export function BudgetView({ livePollMs = 5000 }: BudgetViewProps = {}) {
  const state = useArtifact<BudgetArtifact>('budget');
  const live = useLiveStatus(livePollMs);
  if (state.status === 'loading') {
    return (
      <Panel eyebrow="Budget" title="Loading budget figures…">
        <p className="bg-muted">Reading artifacts/budget.json.</p>
      </Panel>
    );
  }
  const problem = state.status === 'ready' ? checkBudget(state.data) : null;
  if (state.status === 'error' || problem) {
    const file = state.status === 'error' ? state.file : 'artifacts/budget.json';
    return (
      <Panel eyebrow="Budget" title="Budget figures could not be loaded">
        <Callout tone="warn" title={`${file} failed to load`}>
          {state.status === 'error' ? state.message : `${file}: ${problem}`}
        </Callout>
      </Panel>
    );
  }
  const guard = guardView(live);
  return (
    <div className="bg-view">
      <Ledger a={state.data} />
      <GuardPanel a={state.data} guard={guard} unreachable={live.status === 'unreachable' ? live.message : null} />
      <div className="bg-grid">
        {state.data.scenarios.map((s) => (
          <ScenarioCard key={s.id} s={s} a={state.data} />
        ))}
      </div>
      {unassignedFixtures(state.data).length > 0 && (
        <Panel eyebrow="Budget" title="Other fixtures" headingLevel={3}>
          <div className="bg-fixtures">
            {unassignedFixtures(state.data).map((f) => (
              <FixtureRow key={f.id} f={f} />
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function Ledger({ a }: { a: BudgetArtifact }) {
  const segs = ledgerSegments(a);
  const spoken =
    `Modal ledger against the ${usd(a.ceilingUsd)} ceiling: ` +
    segs.map((s) => `${s.label} ${usd(s.usd)}`).join(', ') +
    `. Planned total ${usd(a.plannedUsd)}.`;
  return (
    <Panel
      eyebrow="Budget"
      title={`Modal spend against the ${usd(a.ceilingUsd)} ceiling`}
      subtitle="PRD plan, recomputed: the earlier posted spend, the rehearsals and one live slot. GPU time only."
      status={
        <div className="bg-badges">
          <StatusPill status="derived" />
          <StatusPill status="replay">Replay · $0</StatusPill>
        </div>
      }
    >
      <div className="bg-bar" role="img" aria-label={spoken} data-testid="ledger-bar">
        {segs.map((s) => (
          <div key={s.id} className="bg-bar__seg" data-seg={s.id} style={{ width: `${s.pct}%` }} />
        ))}
      </div>
      <div className="bg-bar__scale lab-num" aria-hidden="true">
        <span>$0</span>
        <span>{usd(a.ceilingUsd)} ceiling</span>
      </div>
      <dl className="bg-legend">
        {segs.map((s) => (
          <div key={s.id} className="bg-legend__item" data-seg={s.id}>
            <dt>
              <span className="bg-legend__swatch" data-seg={s.id} aria-hidden="true" />
              {s.label}
            </dt>
            <dd className="lab-num">{usd(s.usd)}</dd>
            <dd className="bg-legend__kind">
              <StatusPill status={s.id === 'posted' ? 'prd-reported' : 'derived'} />
            </dd>
          </div>
        ))}
        <div className="bg-legend__item bg-legend__item--total">
          <dt>Planned total (posted + plan)</dt>
          <dd className="lab-num">{usd(a.plannedUsd)}</dd>
          <dd className="bg-legend__kind">
            <StatusPill status="derived" />
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

/** Where a figure comes from, after the figure: " · decision.md · D-015". On a narrow row it drops to its own line. */
function SourceTag({ children, stale = false }: { children: string; stale?: boolean }) {
  return (
    <span className={stale ? 'bg-src bg-src--stale' : 'bg-src'}>
      <span className="bg-src__sep"> · </span>
      {children}
    </span>
  );
}

/** Both plans against the ceiling, from the numbers: a plain line when they fit, a warning when one does not. */
function PlansVsCeiling({ plans, ceilingUsd }: { plans: PlanCheck[]; ceilingUsd: number }) {
  const over = plans.filter((p) => !p.inside);
  const ceiling = usd(ceilingUsd);
  if (over.length === 0) {
    return (
      <p className="bg-plans" data-testid="plan-vs-ceiling">
        <Icon name="check" size={14} />
        <span>
          {plans.length === 2 ? 'Both plans stay' : 'Every plan stays'} inside the {ceiling} ceiling:{' '}
          <span className="lab-num">{plans.map((p) => `${p.label} ${usd(p.usd)}`).join(', ')}</span>.
        </span>
      </p>
    );
  }
  const title =
    over.length === plans.length
      ? `${plans.length === 2 ? 'Both plans exceed' : 'Every plan exceeds'} the ${ceiling} ceiling`
      : `Over the ${ceiling} ceiling: ${over.map((p) => p.label).join(' and ')}`;
  return (
    <Callout tone="warn" title={title}>
      <span data-testid="plan-vs-ceiling" className="lab-num">
        {over.map((p) => `${p.label} ${usd(p.usd)} is ${usd(p.overBy)} over the ${ceiling} ceiling`).join('; ')}.
        {plans.filter((p) => p.inside).map((p) => ` ${p.label} ${usd(p.usd)} stays inside it.`)}
      </span>
    </Callout>
  );
}

function GuardPanel({ a, guard, unreachable }: { a: BudgetArtifact; guard: GuardView | null; unreachable: string | null }) {
  const g = a.guardPlan;
  const stale = guardPlanStale(guard, g);
  const staleNote = stale && <SourceTag stale>may be out of date</SourceTag>;
  return (
    <Panel
      eyebrow="Budget"
      title="Live budget guard: setup, idle and storage included"
      subtitle="The guard prices more than GPU time before every allocation, so its figures are higher than the PRD's GPU-only plan."
      status={guard ? <StatusPill status="derived">Guard · /api/live/status</StatusPill> : <StatusPill status="not-applicable">Guard not reachable</StatusPill>}
    >
      {guard ? (
        <div className="bg-guard" data-testid="guard-live">
          <div className="bg-bar" role="img" aria-label={`Live budget guard: billed ${usd(guard.billedUsd)}, pending ${usd(guard.pendingUsd)}, next slot estimate ${usd(guard.slotEstimateUsd)}, of the ${usd(guard.ceilingUsd)} ceiling`}>
            <div className="bg-bar__seg" data-seg="posted" style={{ width: `${(guard.billedUsd / guard.ceilingUsd) * 100}%` }} />
            <div className="bg-bar__seg" data-seg="pending" style={{ width: `${(guard.pendingUsd / guard.ceilingUsd) * 100}%` }} />
            <div className="bg-bar__seg" data-seg="slot" style={{ width: `${(Math.max(0, guard.slotEstimateUsd) / guard.ceilingUsd) * 100}%` }} />
          </div>
          <dl className="bg-legend">
            <div className="bg-legend__item"><dt><span className="bg-legend__swatch" data-seg="posted" aria-hidden="true" />Billed (ledger)</dt><dd className="lab-num">{usd(guard.billedUsd)}</dd></div>
            <div className="bg-legend__item"><dt><span className="bg-legend__swatch" data-seg="pending" aria-hidden="true" />Pending</dt><dd className="lab-num">{usd(guard.pendingUsd)}</dd></div>
            <div className="bg-legend__item"><dt><span className="bg-legend__swatch" data-seg="slot" aria-hidden="true" />Next live slot (guard estimate)</dt><dd className="lab-num">{usd(guard.slotEstimateUsd)}</dd></div>
            <div className="bg-legend__item bg-legend__item--total"><dt>Remaining after that slot</dt><dd className="lab-num">{usd(guard.remainingAfterSlotUsd)}</dd></div>
          </dl>
          <p className="bg-fits" data-fits={guard.slotFits}>
            <Icon name={guard.slotFits ? 'check' : 'blocked'} size={14} />
            {guard.slotFits ? 'Next slot fits under the ceiling' : 'Next slot does NOT fit — replay only'}
            {guard.hardTimeoutS !== null && <span className="lab-num"> · hard timeout {guard.hardTimeoutS} s</span>}
          </p>
        </div>
      ) : (
        <Callout tone="info" title="Live budget guard not reachable — no guard estimate shown">
          {unreachable ? `${unreachable}. ` : 'Connecting to /api/live/status… '}
          This is the static replay build; the guard's live billed, pending and slot figures appear only when the main
          process answers.
        </Callout>
      )}
      <div className="bg-compare" role="table" aria-label="Guard pricing compared with the PRD's GPU-only figures">
        <div role="rowgroup">
          <div role="row" className="bg-compare__row bg-compare__row--head">
            <span role="columnheader">Item</span>
            <span role="columnheader">PRD (GPU time only)</span>
            <span role="columnheader">Guard (incl. setup, idle, storage)</span>
          </div>
        </div>
        <div role="rowgroup">
          <div role="row" className="bg-compare__row">
            <span role="rowheader">15-min live slot</span>
            <span role="cell" className="lab-num" data-testid="prd-slot">{claimUsd(a.fixtures.find((x) => x.id === 'live-slot-usd'))}</span>
            <span role="cell" className="lab-num" data-testid="guard-slot">
              {guard ? usd(guard.slotEstimateUsd) : usd(g.slotEstimateUsd)}
              <SourceTag>{guard ? 'from /api/live/status' : GUARD_PLAN_SOURCE}</SourceTag>
            </span>
          </div>
          <div role="row" className="bg-compare__row">
            <span role="rowheader">One-hour rehearsal</span>
            <span role="cell" className="lab-num">{rehearsalGpuOnly(a)}</span>
            <span role="cell" className="lab-num" data-testid="guard-rehearsal">
              {usd(g.rehearsalEstimateUsd)}
              <SourceTag>{GUARD_PLAN_SOURCE}</SourceTag>
              {staleNote}
            </span>
          </div>
          <div role="row" className="bg-compare__row bg-compare__row--total">
            <span role="rowheader">Planned total incl. {usd(a.postedUsd)} posted</span>
            <span role="cell" className="lab-num">{usd(a.plannedUsd)}</span>
            <span role="cell" className="lab-num" data-testid="guard-planned">
              {usd(g.plannedTotalUsd)}
              <SourceTag>{GUARD_PLAN_SOURCE}</SourceTag>
              {staleNote}
            </span>
          </div>
        </div>
      </div>
      {stale && guard && (
        <Callout tone="info" title="The live guard estimate differs from the guard plan in the artifact">
          The guard now estimates the next slot at <span className="lab-num">{usd(guard.slotEstimateUsd)}</span>; the
          plan in artifacts/budget.json was priced with <span className="lab-num">{usd(g.slotEstimateUsd)}</span>. The
          rehearsal price and the planned total above are the plan's figures (no API field carries them), so they may
          be out of date.
        </Callout>
      )}
      <p className="bg-note" data-testid="guard-assumptions">
        {g.assumptions}{' '}
        <span className="lab-num">
          Hard timeouts in the plan: live slot {g.slotHardTimeoutS} s, rehearsal {g.rehearsalHardTimeoutS} s.
        </span>
      </p>
      <PlansVsCeiling plans={planChecks(a)} ceilingUsd={a.ceilingUsd} />
    </Panel>
  );
}

/** PRD GPU-only price of one rehearsal, recomputed from the live-demo scenario inputs (rate × hours). */
function rehearsalGpuOnly(a: BudgetArtifact): string {
  const inputs = a.scenarios.find((s) => s.id === 'live-demo')?.inputs;
  const rate = Number(inputs?.rateUsdPerH);
  const hours = Number(inputs?.rehearsalH);
  return Number.isFinite(rate) && Number.isFinite(hours) ? usd(rate * hours) : '—';
}

function ScenarioCard({ s, a }: { s: BudgetScenario; a: BudgetArtifact }) {
  const prd = s.provenance.kind === 'prd-reported';
  const kind = provenanceStatus(s.provenance.kind);
  const fixtures = fixturesFor(a, s.id);
  return (
    <Panel
      eyebrow={prd ? 'PRD-reported context' : s.provenance.kind === 'derived' ? 'Derived estimate' : `${kind.label} context`}
      title={s.title}
      headingLevel={3}
      className="bg-card"
      status={<ProvenanceBadge provenance={s.provenance} subject={s.title} />}
    >
      <article className="bg-scenario" data-kind={s.provenance.kind} aria-label={`${s.title} scenario`}>
        <p className="bg-headline" data-kind={s.provenance.kind}>
          {/* No live flag: an artifact is replayed evidence, its provenance can never earn the LIVE pill. */}
          <StatusPill status={kind.status}>{kind.label}</StatusPill>
          <span className="lab-num">{s.headline}</span>
        </p>
        <dl className="bg-def">
          <dt>Derivation</dt>
          <dd className="lab-num">{s.derivation}</dd>
          <dt>Interpretation</dt>
          <dd>{s.interpretation}</dd>
        </dl>
        <details className="bg-details">
          <summary>Inputs</summary>
          <dl className="bg-inputs">
            {Object.entries(s.inputs).map(([k, v]) => (
              <div key={k}>
                <dt className="lab-mono">{k}</dt>
                <dd className="lab-num">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </details>
        {fixtures.length > 0 && (
          <div className="bg-fixtures">
            {fixtures.map((f) => (
              <FixtureRow key={f.id} f={f} />
            ))}
          </div>
        )}
      </article>
    </Panel>
  );
}

/**
 * One PRD figure against its recomputed value, straight from the artifact: FixtureCheck reads a PRD
 * range from `claimedRange` (never a midpoint) and what a match is backed by from `basis` (D-023).
 */
function FixtureRow({ f }: { f: FixtureCheckData }) {
  return <FixtureCheck fixture={f} unit={fixtureUnit(f)} claimedLabel={claimedLabelFor(f)} />;
}
