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
  type FixtureCheckData,
} from '../../design';
import { useArtifact } from '../../lib/artifacts';
import { useLiveStatus } from '../../lib/liveStatus';
import {
  GUARD_PLAN_D015,
  fixtureUnit,
  fixturesFor,
  guardView,
  isRangeFixture,
  ledgerSegments,
  rangeFixture,
  unassignedFixtures,
  usd,
  type BudgetArtifact,
  type BudgetScenario,
  type GuardView,
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
      subtitle="PRD plan, recomputed: the earlier posted spend, two one-hour rehearsals and one 15-minute live slot. GPU time only."
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

function GuardPanel({ a, guard, unreachable }: { a: BudgetArtifact; guard: GuardView | null; unreachable: string | null }) {
  const g = GUARD_PLAN_D015;
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
              <span className="bg-src">{guard ? ' · from /api/live/status' : ` · ${g.source}`}</span>
            </span>
          </div>
          <div role="row" className="bg-compare__row">
            <span role="rowheader">One-hour rehearsal</span>
            <span role="cell" className="lab-num">{rehearsalGpuOnly(a)}</span>
            <span role="cell" className="lab-num">
              {usd(g.rehearsalUsd)}
              <span className="bg-src"> · {g.source}</span>
            </span>
          </div>
          <div role="row" className="bg-compare__row bg-compare__row--total">
            <span role="rowheader">Planned total incl. {usd(a.postedUsd)} posted</span>
            <span role="cell" className="lab-num">{usd(a.plannedUsd)}</span>
            <span role="cell" className="lab-num" data-testid="guard-planned">
              {usd(g.plannedUsd)}
              <span className="bg-src"> · {g.source}</span>
            </span>
          </div>
        </div>
      </div>
      <p className="bg-note">
        Setup (5 min per launch), idle margin and the storage/egress allowance are planning assumptions recorded in
        D-015, not PRD numbers; they are replaced by measured values after the first rehearsal. Both plans stay inside the{' '}
        {usd(a.ceilingUsd)} ceiling.
      </p>
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
  const fixtures = fixturesFor(a, s.id);
  return (
    <Panel
      eyebrow={prd ? 'PRD-reported context' : 'Derived estimate'}
      title={s.title}
      headingLevel={3}
      className="bg-card"
      status={<ProvenanceBadge provenance={s.provenance} subject={s.title} />}
    >
      <article className="bg-scenario" data-kind={s.provenance.kind} aria-label={`${s.title} scenario`}>
        <p className="bg-headline" data-kind={s.provenance.kind}>
          <StatusPill status={s.provenance.kind} />
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

function FixtureRow({ f }: { f: FixtureCheckData }) {
  if (!isRangeFixture(f)) return <FixtureCheck fixture={f} unit={fixtureUnit(f)} />;
  const r = rangeFixture(f);
  if (!r) return <FixtureCheck fixture={f} unit={fixtureUnit(f)} />;
  const outcome = r.inside === null ? 'unknown' : r.inside ? 'inside' : 'outside';
  const text = outcome === 'inside' ? 'Inside PRD range' : outcome === 'outside' ? 'Outside PRD range' : 'Not recomputable';
  const spoken = `${r.label}: ${text}. PRD range ${r.loText} to ${r.hiText} ${r.unit}, computed ${r.computedText} ${r.unit}${r.inconsistent ? '. The match flag disagrees with the range test.' : ''}`;
  return (
    <div className="bg-range" role="group" aria-label={spoken} data-outcome={outcome} data-testid={`range-${r.id}`}>
      <div className="bg-range__label">
        <span className="bg-range__name">{r.label}</span>
        <span className="bg-range__note">The PRD prints only a range; compared by range, not by rounding.</span>
        {r.inconsistent && <span className="bg-range__note bg-range__note--warn">Match flag disagrees with the range test — treated as outside.</span>}
      </div>
      <div className="bg-range__cell">
        <span className="bg-range__k">PRD range</span>
        <span className="bg-range__v lab-num">
          {r.loText}–{r.hiText} {r.unit}
        </span>
      </div>
      <div className="bg-range__cell">
        <span className="bg-range__k">Computed</span>
        <span className="bg-range__v lab-num">
          {r.computedText} {r.unit}
        </span>
      </div>
      <div className="bg-range__outcome">
        <Icon name={outcome === 'inside' ? 'check' : outcome === 'outside' ? 'cross' : 'dash'} size={12} />
        {text}
      </div>
    </div>
  );
}

