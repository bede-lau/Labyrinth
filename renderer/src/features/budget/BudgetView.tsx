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
  type ProvenanceKind,
} from '../../design';
import { useArtifact } from '../../lib/artifacts';
import { launchMayBeRunning, liveDanger, sessionMayBeBilling, useLiveStatus, type LiveState } from '../../lib/liveStatus';
import { hrefFor } from '../../shell/routes';
import {
  checkBudget,
  claimUsd,
  claimedLabelFor,
  fixtureUnit,
  fixturesFor,
  guardPlanStale,
  guardRefusal,
  guardSegments,
  guardView,
  ledgerKind,
  ledgerSegments,
  planChecks,
  replayPillText,
  unassignedFixtures,
  usd,
  type BudgetArtifact,
  type BudgetScenario,
  type GuardView,
  type PlanCheck,
} from './model';
import './budget.css';

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour12: false });

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
      <Ledger a={state.data} replay={replayPillText(live)} />
      <GuardPanel a={state.data} guard={guard} live={live} />
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

/**
 * A ledger figure's provenance pill, from the artifact's scenario kind (never a kind typed in here); nothing when
 * the artifact does not say. Kind "live" is a recorded run, as on the scenario cards: never the LIVE pill.
 */
function KindPill({ kind }: { kind: ProvenanceKind | null }) {
  if (!kind) return null;
  const p = provenanceStatus(kind);
  return (
    <StatusPill status={p.status} className="bg-kind">
      {p.label}
    </StatusPill>
  );
}

function Ledger({ a, replay }: { a: BudgetArtifact; replay: string }) {
  const segs = ledgerSegments(a);
  const kind = ledgerKind(a);
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
          <KindPill kind={kind} />
          {/* "Replay · $0" only while the header shows it: never "$0" beside a bill that may be running. */}
          <StatusPill status="replay">{replay}</StatusPill>
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
              <KindPill kind={s.kind} />
            </dd>
          </div>
        ))}
        <div className="bg-legend__item bg-legend__item--total">
          <dt>Planned total (posted + plan)</dt>
          <dd className="lab-num">{usd(a.plannedUsd)}</dd>
          <dd className="bg-legend__kind">
            <KindPill kind={kind} />
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

/**
 * The guard's verdict on the next slot, worded from the numbers (cross-RX-6). `slotFits` is the guard's whole
 * decision: it is also false for a ledger that is not reconciled or cannot be read, so "does NOT fit under the
 * ceiling" is said only when billed + pending + slot really exceeds it. A hard timeout of 0 allows no slot and
 * is not shown as a timeout.
 */
function GuardFits({ guard, reason }: { guard: GuardView; reason: string | null }) {
  const timeout =
    guard.hardTimeoutS !== null && guard.hardTimeoutS > 0 ? <span className="lab-num"> · hard timeout {guard.hardTimeoutS} s</span> : null;
  if (guard.slotFits) {
    return (
      <p className="bg-fits" data-fits="true" data-testid="guard-fits">
        <Icon name="check" size={14} />
        Next slot fits under the ceiling
        {timeout}
      </p>
    );
  }
  const over = guard.afterSlotUsd > guard.ceilingUsd + 1e-9;
  const refusal = guardRefusal(reason);
  return (
    <>
      <p className="bg-fits" data-fits="false" data-testid="guard-fits">
        <Icon name="blocked" size={14} />
        {over ? 'Next slot does NOT fit under the ceiling — replay only' : 'Next slot refused by the budget guard, not by the ceiling — replay only'}
        {timeout}
      </p>
      {!over && (
        <p className="bg-note lab-num" data-testid="guard-why">
          Billed + pending + next slot = {usd(guard.afterSlotUsd)} is within the {usd(guard.ceilingUsd)} ceiling. The guard
          also refuses a slot when the ledger is not reconciled or cannot be read; the billed and pending figures above are
          then not verified (an unreadable ledger is reported as $0.00).
        </p>
      )}
      {refusal && (
        <p className="bg-note" data-testid="guard-reason">
          The guard’s reason: “{refusal}”
        </p>
      )}
    </>
  );
}

function GuardBar({ guard }: { guard: GuardView }) {
  const { segments, overUsd } = guardSegments(guard);
  const spoken =
    `Live budget guard: billed ${usd(guard.billedUsd)}, pending ${usd(guard.pendingUsd)}, next slot estimate ${usd(guard.slotEstimateUsd)}, ` +
    `of the ${usd(guard.ceilingUsd)} ceiling` +
    (overUsd > 0 ? `; ${usd(overUsd)} over the ceiling` : '');
  return (
    <>
      <div className={overUsd > 0 ? 'bg-bar bg-bar--over' : 'bg-bar'} role="img" aria-label={spoken} data-testid="guard-bar" data-over={overUsd > 0}>
        {segments.map((s) => (
          <div key={s.id} className="bg-bar__seg" data-seg={s.id} style={{ width: `${s.pct}%` }} />
        ))}
      </div>
      {overUsd > 0 && (
        <p className="bg-over lab-num" data-testid="guard-over">
          Over the ceiling by {usd(overUsd)}: billed + pending + next slot = {usd(guard.afterSlotUsd)}. The bar stops at the{' '}
          {usd(guard.ceilingUsd)} ceiling.
        </p>
      )}
    </>
  );
}

/**
 * No current guard answer. Never the "static replay build" wording once a status has been seen: when the API
 * stops answering after a snapshot of a session that may be billing, say so, show its last-known figures with
 * their time, and point to Terminate (FF-8).
 */
function GuardUnreachable({ live }: { live: LiveState }) {
  const last = live.status === 'unreachable' ? (live.lastKnown ?? null) : null;
  if (live.status !== 'unreachable' || !last) {
    return (
      <Callout tone="info" title="Live budget guard not reachable — no guard estimate shown">
        {live.status === 'unreachable' ? `${live.message}. ` : 'Connecting to /api/live/status… '}
        This is the static replay build; the guard's live billed, pending and slot figures appear only when the main
        process answers.
      </Callout>
    );
  }
  const danger = liveDanger(live);
  const mayBill = sessionMayBeBilling(last.data) || launchMayBeRunning(live);
  const b = last.data.budget;
  return (
    <Callout
      tone={mayBill ? 'warn' : 'info'}
      title={
        mayBill
          ? (danger?.title ?? 'NO FRESH STATUS — a session may be billing')
          : 'Live budget guard not answering — no current guard estimate'
      }
      action={mayBill ? <a href={hrefFor('advance')}>Open Advance plasma to send Terminate</a> : undefined}
    >
      <span data-testid="guard-last-known">
        The live API stopped answering ({live.message}). Its last status, received at {clock(last.receivedAt)}, reported mode
        “{last.data.mode}”: billed <span className="lab-num">{usd(b.billedUsd)}</span>, pending{' '}
        <span className="lab-num">{usd(b.pendingUsd)}</span>, next slot estimate <span className="lab-num">{usd(b.slotEstimateUsd)}</span>{' '}
        of the <span className="lab-num">{usd(b.ceilingUsd)}</span> ceiling. These figures are not current.
        {mayBill
          ? ' The connection to a session that may be billing was lost: GPUs may still be billing. Use Terminate in Advance plasma.'
          : ' The guard’s current figures appear again when the main process answers.'}
      </span>
    </Callout>
  );
}

function GuardPanel({ a, guard, live }: { a: BudgetArtifact; guard: GuardView | null; live: LiveState }) {
  const g = a.guardPlan;
  const stale = guardPlanStale(guard, g);
  const staleNote = stale && <SourceTag stale>may be out of date</SourceTag>;
  const danger = liveDanger(live);
  return (
    <Panel
      eyebrow="Budget"
      title="Live budget guard: setup, idle and storage included"
      subtitle="The guard prices more than GPU time before every allocation, so its figures are higher than the PRD's GPU-only plan."
      status={
        guard ? (
          <StatusPill status="derived">Guard · /api/live/status</StatusPill>
        ) : danger?.kind === 'connection-lost' ? (
          <StatusPill status="billing-risk">{danger.pill}</StatusPill>
        ) : (
          <StatusPill status="not-applicable">Guard not reachable</StatusPill>
        )
      }
    >
      {guard ? (
        <div className="bg-guard" data-testid="guard-live">
          <GuardBar guard={guard} />
          <dl className="bg-legend">
            <div className="bg-legend__item"><dt><span className="bg-legend__swatch" data-seg="posted" aria-hidden="true" />Billed (ledger)</dt><dd className="lab-num">{usd(guard.billedUsd)}</dd></div>
            <div className="bg-legend__item"><dt><span className="bg-legend__swatch" data-seg="pending" aria-hidden="true" />Pending</dt><dd className="lab-num">{usd(guard.pendingUsd)}</dd></div>
            <div className="bg-legend__item"><dt><span className="bg-legend__swatch" data-seg="slot" aria-hidden="true" />Next live slot (guard estimate)</dt><dd className="lab-num">{usd(guard.slotEstimateUsd)}</dd></div>
            <div className="bg-legend__item bg-legend__item--total"><dt>Remaining after that slot</dt><dd className="lab-num">{usd(guard.remainingAfterSlotUsd)}</dd></div>
          </dl>
          <GuardFits guard={guard} reason={live.status === 'ready' ? live.data.reason : null} />
        </div>
      ) : (
        <GuardUnreachable live={live} />
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
            <span role="rowheader">{rehearsalLabel(a)}</span>
            <span role="cell" className="lab-num" data-testid="prd-rehearsal">{rehearsalGpuOnly(a)}</span>
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

const liveDemoInput = (a: BudgetArtifact, key: string): number => {
  const v = a.scenarios.find((s) => s.id === 'live-demo')?.inputs[key];
  return v === undefined || v === '' ? Number.NaN : Number(v);
};

/** PRD GPU-only price of one rehearsal, recomputed from the live-demo scenario inputs (rate × hours). */
function rehearsalGpuOnly(a: BudgetArtifact): string {
  const rate = liveDemoInput(a, 'rateUsdPerH');
  const hours = liveDemoInput(a, 'rehearsalH');
  return Number.isFinite(rate) && Number.isFinite(hours) ? usd(rate * hours) : '—';
}

/** The row names the rehearsal length the price is for ("One-hour rehearsal" for the PRD's 1 h). */
function rehearsalLabel(a: BudgetArtifact): string {
  const hours = liveDemoInput(a, 'rehearsalH');
  return !Number.isFinite(hours) || hours === 1 ? 'One-hour rehearsal' : `One rehearsal, ${hours} h`;
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
