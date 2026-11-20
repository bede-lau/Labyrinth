// Budget (task 04, B6–B7): PRD ledger to the $40 ceiling, the live guard's own estimate when the
// API answers (distinct from the PRD's GPU-only figures), and scenario cards with headline,
// derivation and interpretation. Range fixtures show the PRD range, never a midpoint.
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
  GUARD_PLAN_D015,
  claimedLabelFor,
  fixtureBasis,
  fixtureUnit,
  fixturesFor,
  guardPlanStale,
  guardView,
  isRangeFixture,
  ledgerSegments,
  planChecks,
  rangeFixture,
  unassignedFixtures,
  usd,
  type BudgetArtifact,
  type BudgetScenario,
  type GuardView,
  type PlanCheck,
} from './model';
import './budget.css';

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
  if (state.status === 'error') {
    return (
      <Panel eyebrow="Budget" title="Budget figures could not be loaded">
        <Callout tone="warn" title={`${state.file} failed to load`}>
          {state.message}
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
              <FixtureRow key={f.id} f={f} a={state.data} />
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
      : `The ${over.map((p) => p.label).join(' and the ')} exceeds the ${ceiling} ceiling`;
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
  const g = GUARD_PLAN_D015;
  const stale = guardPlanStale(guard);
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
            <span role="cell" className="lab-num">{fixtureValue(a, 'live-slot-usd')}</span>
            <span role="cell" className="lab-num" data-testid="guard-slot">
              {guard ? usd(guard.slotEstimateUsd) : usd(g.slotUsd)}
              <SourceTag>{guard ? 'from /api/live/status' : g.source}</SourceTag>
            </span>
          </div>
          <div role="row" className="bg-compare__row">
            <span role="rowheader">One-hour rehearsal</span>
            <span role="cell" className="lab-num">{rehearsalGpuOnly(a)}</span>
            <span role="cell" className="lab-num" data-testid="guard-rehearsal">
              {usd(g.rehearsalUsd)}
              <SourceTag>{g.source}</SourceTag>
              {staleNote}
            </span>
          </div>
          <div role="row" className="bg-compare__row bg-compare__row--total">
            <span role="rowheader">Planned total incl. {usd(a.postedUsd)} posted</span>
            <span role="cell" className="lab-num">{usd(a.plannedUsd)}</span>
            <span role="cell" className="lab-num" data-testid="guard-planned">
              {usd(g.plannedUsd)}
              <SourceTag>{g.source}</SourceTag>
              {staleNote}
            </span>
          </div>
        </div>
      </div>
      {stale && guard && (
        <Callout tone="info" title="The live guard estimate differs from the D-015 planning figures">
          The guard now estimates the next slot at <span className="lab-num">{usd(guard.slotEstimateUsd)}</span>; D-015
          planned with <span className="lab-num">{usd(g.slotUsd)}</span>. The rehearsal price and the planned total
          above are still the D-015 figures (no API field carries them), so they may be out of date.
        </Callout>
      )}
      <p className="bg-note">
        Setup (5 min per launch), idle margin and the storage/egress allowance are planning assumptions recorded in
        D-015, not PRD numbers; they are replaced by measured values after the first rehearsal.
      </p>
      <PlansVsCeiling plans={planChecks(a, g.plannedUsd)} ceilingUsd={a.ceilingUsd} />
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

function fixtureValue(a: BudgetArtifact, id: string): string {
  const f = a.fixtures.find((x) => x.id === id);
  return f ? usd(f.claimed) : '—';
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
              <FixtureRow key={f.id} f={f} a={a} />
            ))}
          </div>
        )}
      </article>
    </Panel>
  );
}

function FixtureRow({ f, a }: { f: FixtureCheckData; a: BudgetArtifact }) {
  // The PRD prints only a range for these: `claimed` is a midpoint the PRD never stated, so the generic
  // claimed-vs-computed row is never used for them, even when the range text itself is missing.
  if (!isRangeFixture(f)) {
    return <FixtureCheck fixture={f} unit={fixtureUnit(f)} claimedLabel={claimedLabelFor(f)} basis={fixtureBasis(a, f)} />;
  }
  const r = rangeFixture(f);
  const outcome = !r.rangeAvailable || r.inside === null ? 'unknown' : r.inside ? 'inside' : 'outside';
  const text = !r.rangeAvailable
    ? 'PRD range unavailable'
    : outcome === 'inside'
      ? 'Inside PRD range'
      : outcome === 'outside'
        ? 'Outside PRD range'
        : 'Not recomputable';
  const computed = `${r.computedText} ${r.unit}`.trim();
  const spoken = r.rangeAvailable
    ? `${r.label}: ${text}. PRD range ${r.loText} to ${r.hiText} ${r.unit}, computed ${computed}${r.inconsistent ? '. The match flag disagrees with the range test.' : ''}`
    : `${r.label}: ${text}. The artifact does not carry the PRD range, so no comparison is made. Computed ${computed}`;
  return (
    <div className="bg-range" role="group" aria-label={spoken} data-outcome={outcome} data-testid={`range-${r.id}`}>
      <div className="bg-range__label">
        <span className="bg-range__name">{r.label}</span>
        <span className="bg-range__note">
          {r.rangeAvailable
            ? 'The PRD prints only a range; compared by range, not by rounding.'
            : 'The PRD prints only a range, and it is unavailable in the artifact: no comparison is made.'}
        </span>
        {r.inconsistent && <span className="bg-range__note bg-range__note--warn">Match flag disagrees with the range test — treated as outside.</span>}
      </div>
      <div className="bg-range__cell">
        <span className="bg-range__k">PRD range</span>
        <span className="bg-range__v lab-num">{r.rangeAvailable ? `${r.loText}–${r.hiText} ${r.unit}` : 'unavailable'}</span>
      </div>
      <div className="bg-range__cell">
        <span className="bg-range__k">Computed</span>
        <span className="bg-range__v lab-num">{computed}</span>
      </div>
      <div className="bg-range__outcome">
        <Icon name={outcome === 'inside' ? 'check' : outcome === 'outside' ? 'cross' : 'dash'} size={12} />
        {text}
      </div>
    </div>
  );
}
