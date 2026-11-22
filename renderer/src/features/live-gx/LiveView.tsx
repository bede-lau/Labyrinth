// Advance plasma (task 06, L9–L10). Reads the shared live status (lib/liveStatus.ts, one poller for
// the whole app). LIVE appears ONLY when the API reports mode "live" on a current, valid answer; every
// other state plays saved evidence and says so. Launch needs a fresh idle (or settled fallback) snapshot
// + the budget guard's approval + an explicit confirmation of the exact slot cost, and locks after one
// POST. Terminate stays available whenever a session may still be billing, and every unconfirmed
// termination is a loud alert. The status, alerts and controls never depend on the evidence below them:
// the worker list, the live chart and the replay each sit in their own error boundary (FE2-1).
import {
  Component,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  Alert,
  Callout,
  Icon,
  Panel,
  ProvenanceBadge,
  Stat,
  StatusPill,
  Unit,
  formatNumber,
  useResolvedTheme,
} from '../../design';
import { useArtifact, type ArtifactState } from '../../lib/artifacts';
import {
  REPLAY_PILL,
  fetchSavedRun,
  isLive,
  launchMayBeRunning,
  liveDanger,
  liveStatusStore,
  postLiveLaunch,
  sendTerminate,
  terminationProblem,
  useLiveStatus,
  type LiveComparison,
  type LiveState,
  type LiveStatus,
  type LiveWorker,
  type TerminateAnswer,
} from '../../lib/liveStatus';
import { comparisonSummary, liveComparison } from '../transport/model';
import { PlotlyChart } from '../transport/PlotlyChart';
import type { TransportArtifact } from '../transport/types';
import { TIME_UNIT, FLUX_UNIT, playFigure } from './chart';
import {
  EXPECTED_TUBE,
  canLaunch,
  canTerminate,
  clockAdvance,
  launchBlockedReason,
  modeView,
  overlapClaim,
  provenanceIsLive,
  savedRunQualified,
  savedRunSeries,
  savedRunToFetch,
  terminateAnswerExpired,
  trackClocks,
  workersPill,
  type ClockTrack,
  type Clocks,
  type PlaySeries,
  type SavedRun,
} from './model';
import { Playback } from './Playback';
import './live.css';

export interface LiveViewProps {
  /** Poll interval for /api/live/status (ms). */
  pollMs?: number;
  /** Start the replay automatically (default: yes, unless the user prefers reduced motion). */
  autoPlay?: boolean;
  /** The shell already announces danger reported by the shared status store. */
  shellAnnouncesDanger?: boolean;
}

type Budget = LiveStatus['budget'];

const usd = (v: number) => `$${formatNumber(v, 2)}`;
/** The slot cost exactly as it will be sent: cents when that is exact, the full number otherwise. */
const usdExact = (v: number) => (Number(v.toFixed(2)) === v ? `$${v.toFixed(2)}` : `$${String(v)}`);
const seconds = (ms: number) => formatNumber(ms / 1000, 1);

type SavedRunState =
  | { status: 'none' }
  | { status: 'loading'; id: string }
  | { status: 'error'; id: string; message: string }
  | { status: 'ready'; id: string; run: SavedRun };

function useSavedRun(id: string | null): SavedRunState {
  const [state, setState] = useState<SavedRunState>({ status: 'none' });
  useEffect(() => {
    if (!id) {
      setState({ status: 'none' });
      return;
    }
    let alive = true;
    setState({ status: 'loading', id });
    fetchSavedRun(id).then(
      (run) => alive && setState({ status: 'ready', id, run }),
      (e: unknown) => alive && setState({ status: 'error', id, message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      alive = false;
    };
  }, [id]);
  return state;
}

/** accepted = 2xx ok; refused = the backend's 409; unknown = anything else (no answer, proxy error). */
interface LaunchAttempt {
  outcome: 'pending' | 'accepted' | 'refused' | 'unknown';
  text: string;
}

/** One "GPUs may still be billing" alert of the panel (DESIGN.md §5: the design system's Alert, never ad-hoc markup). */
interface DangerAlert {
  kind: string;
  title: string;
  reason: string;
  body: ReactNode;
}

const DASHBOARD = 'check the Modal dashboard until both workers are confirmed stopped.';

export function LiveView({ pollMs = 2000, autoPlay, shellAnnouncesDanger = false }: LiveViewProps = {}) {
  const live = useLiveStatus(pollMs);
  const transport = useArtifact<TransportArtifact>('transport');
  const saved = useSavedRun(savedRunToFetch(live));
  const [clocks, setClocks] = useState<Clocks>({});
  const [dialog, setDialog] = useState<Budget | null>(null); // the budget shown in the open confirmation
  const [dialogClosed, setDialogClosed] = useState<string | null>(null);
  const [launch, setLaunch] = useState<LaunchAttempt | null>(null);
  // The last Terminate answer, with the snapshot it was answered with (FE2-2: it expires against later ones).
  const [terminate, setTerminate] = useState<TerminateAnswer | null>(null);
  const [terminating, setTerminating] = useState(0);
  const [clearedSinceLaunch, setClearedSinceLaunch] = useState(false);
  const posting = useRef(false);
  const launchRef = useRef<HTMLButtonElement>(null);
  const data = live.status === 'ready' ? live.data : null;

  useEffect(() => {
    if (live.status === 'ready' && live.receivedAt !== undefined) {
      const at = live.receivedAt;
      setClocks((c) => trackClocks(c, live.data.workers, at));
    }
  }, [live]);

  // A Terminate answer is shown only until a later snapshot settles it, then forgotten.
  const shownTerminate = terminate && !terminateAnswerExpired(terminate, live) ? terminate : null;
  useEffect(() => {
    if (terminate && terminateAnswerExpired(terminate, live)) setTerminate(null);
  }, [terminate, live]);

  const termFailed = shownTerminate !== null && !shownTerminate.confirmed;
  // A failed Terminate answered to this page is a danger state even before the status poll says so.
  const localProblem =
    shownTerminate && !shownTerminate.confirmed
      ? (terminationProblem(shownTerminate.reason) ?? {
          marker: 'TERMINATE FAILED' as const,
          title: 'TERMINATE FAILED — GPUs may still be billing',
          reason: shownTerminate.reason,
        })
      : null;
  const statusProblem = terminationProblem(live);
  const problem = localProblem ?? statusProblem;
  const danger = liveDanger(live);
  const mv = modeView(live, localProblem);
  const isLiveNow = isLive(live);

  // The launch lock lives in the shared store (FA-4): a launch that may have started a session keeps Terminate available.
  const launchUnconfirmed = launchMayBeRunning(live) && !clearedSinceLaunch;
  const launchWhy = launchBlockedReason(live, Date.now(), termFailed);
  const launchEnabled = launchWhy === null && launch?.outcome !== 'pending';
  const terminateEnabled = canTerminate(live, { terminateFailed: termFailed, launchUnconfirmed });
  // "$0" appears in the replay only where the mode pills show it (never while GPUs may be billing).
  const zeroCost = mv.pills.some((p) => p.status === REPLAY_PILL.status && p.text === REPLAY_PILL.text);

  // Every "GPUs may still be billing" state, worst first. The first alert carries the Terminate control.
  const alerts: DangerAlert[] = [];
  if (problem) {
    alerts.push({
      kind: problem.marker === 'TERMINATE FAILED' ? 'terminate-failed' : 'termination-pending',
      title: problem.title,
      reason: problem.reason,
      body: `Send Terminate again, and ${DASHBOARD}`,
    });
  } else if (danger?.kind === 'stop-unconfirmed') {
    alerts.push({
      kind: danger.kind,
      title: danger.title,
      reason: danger.detail,
      body: `A stop was requested and the backend has not confirmed it. Terminate stays available; ${DASHBOARD}`,
    });
  }
  if (danger?.kind === 'connection-lost') {
    alerts.push({ kind: danger.kind, title: danger.title, reason: danger.detail, body: `Terminate stays available; also ${DASHBOARD}` });
  } else if (live.launchPhase === 'unknown' && launch?.outcome === 'unknown') {
    alerts.push({
      kind: 'launch-unknown',
      title: 'LAUNCH NOT CONFIRMED — a session may have started',
      reason: launch.text,
      body: `The request left this page but its outcome is unknown, so GPUs may be billing until a current status shows the mode. Use Terminate if in doubt, and ${DASHBOARD}`,
    });
  }
  const retry = termFailed || problem?.marker === 'TERMINATE FAILED';

  const closeDialog = (why: string | null) => {
    setDialog(null);
    setDialogClosed(why);
    launchRef.current?.focus();
  };

  // The open confirmation is valid only while launching is still allowed at the cost it shows.
  useEffect(() => {
    if (!dialog) return;
    const blocked = launchBlockedReason(live, Date.now(), termFailed);
    const cost = live.status === 'ready' ? live.data.budget.slotEstimateUsd : null;
    if (blocked) closeDialog(blocked);
    else if (cost !== null && cost !== dialog.slotEstimateUsd) {
      closeDialog(`the slot estimate changed from ${usdExact(dialog.slotEstimateUsd)} to ${usdExact(cost)}; open the confirmation again to see the new cost.`);
    }
  }, [live, dialog, termFailed]);

  const openDialog = () => {
    const now = liveStatusStore.getState();
    if (now.status !== 'ready' || !canLaunch(now, Date.now(), termFailed)) return;
    setDialogClosed(null);
    setDialog(now.data.budget);
  };

  const doLaunch = async (cost: number) => {
    if (posting.current) return; // a second click in the same frame
    const now = liveStatusStore.getState();
    const blocked = launchBlockedReason(now, Date.now(), termFailed);
    if (blocked || now.status !== 'ready' || now.data.budget.slotEstimateUsd !== cost) {
      closeDialog(blocked ?? 'the slot estimate changed; open the confirmation again to see the new cost.');
      return;
    }
    posting.current = true;
    liveStatusStore.lockLaunch(); // before the request leaves: no second POST while it is in flight
    setDialog(null);
    setDialogClosed(null);
    // FE2-2: an earlier Terminate answer describes the session before this launch, never the one it starts.
    setTerminate(null);
    setClearedSinceLaunch(false);
    setLaunch({ outcome: 'pending', text: '' });
    try {
      const r = await postLiveLaunch(cost);
      // FA-4 (maintainer, 2026-11-20): 202 -> locked until the mode changes; 409 -> nothing was launched,
      // so the next snapshot decides; no answer (or any other answer) -> unknown, the next snapshot decides.
      const outcome = r.ok ? 'accepted' : r.httpStatus === 409 ? 'refused' : 'unknown';
      liveStatusStore.launchAnswered(outcome);
      setLaunch({ outcome, text: r.reason });
      // Show what the backend says now, not the idle snapshot from before the POST.
      if (!r.status || !liveStatusStore.apply(r.status)) void liveStatusStore.refresh();
    } finally {
      posting.current = false;
      launchRef.current?.focus();
    }
  };

  const doTerminate = async () => {
    setTerminating((n) => n + 1);
    try {
      // FA-2 confirmation rule and the status the answer carries: lib/liveStatus.ts sendTerminate().
      const answer = await sendTerminate(liveStatusStore);
      setTerminate(answer);
      if (answer.confirmed) setClearedSinceLaunch(true);
    } finally {
      setTerminating((n) => n - 1);
    }
  };

  const terminateButton = (
    <button type="button" className="lg-btn lg-btn--danger" disabled={!terminateEnabled} aria-busy={terminating > 0} onClick={doTerminate}>
      {terminating > 0 ? 'Terminating… (send again)' : retry ? 'Retry terminate' : 'Terminate'}
    </button>
  );

  const provenance = data?.provenance;

  return (
    <div className="lg-view" data-split={!isLiveNow && !data?.workers.length && alerts.length === 0}>
      <Panel
        title="Nonlinear GX on two A100s"
        subtitle="Each GPU advances one local flux tube independently. Launch requires cost confirmation."
        status={
          <div className="lg-pills" data-testid="mode-pills">
            {mv.pills.map((p) => (
              <StatusPill key={`${p.status}:${p.text}`} status={p.status} size="md">
                {p.text}
              </StatusPill>
            ))}
            {provenance && (
              <ProvenanceBadge provenance={provenance} subject="live GX status" live={provenanceIsLive(live, Date.now())} />
            )}
          </div>
        }
      >
        {alerts.length > 0 && (
          <div className="lg-alerts">
            {alerts.map((a, i) => (
              <Alert
                key={a.kind}
                className="lg-alert"
                title={a.title}
                reason={a.reason}
                announce={!(shellAnnouncesDanger && danger?.kind === a.kind && danger.detail === a.reason)}
                action={i === 0 ? terminateButton : undefined}
              >
                {a.body}
              </Alert>
            ))}
          </div>
        )}

        <div className="lg-banner" data-tone={mv.tone} data-live={isLiveNow} data-testid="mode-banner">
          <Icon name={mv.icon} size={18} className="lg-banner__icon" />
          <div className="lg-banner__text">
            <p className="lg-banner__title">{mv.title}</p>
            <p className="lg-banner__body">
              {live.status === 'ready'
                ? statusProblem || danger?.kind === 'stop-unconfirmed'
                  ? 'The API reason is quoted in the alert above. This label stays until the API reports the termination as confirmed.'
                  : live.data.reason
                : live.status === 'connecting'
                  ? 'Waiting for the first status poll.'
                  : danger || live.cause === 'stale'
                    ? `${live.message}. Polling continues; this page updates as soon as the API answers again.`
                    : `${live.message}. No backend is answering (static replay build), so nothing can be launched from here.`}
            </p>
            {data && data.fallback.label && <p className="lg-banner__body lg-banner__fallback">{data.fallback.label}</p>}
          </div>
        </div>

        <BudgetLine live={live} />

        <div className="lg-actions">
          <button
            ref={launchRef}
            type="button"
            className="lg-btn lg-btn--primary"
            disabled={!launchEnabled}
            aria-describedby={!launchEnabled && launch?.outcome !== 'pending' ? 'lg-launch-why' : undefined}
            onClick={openDialog}
          >
            {launch?.outcome === 'pending' ? 'Launching…' : 'Launch live slot…'}
          </button>
          {alerts.length === 0 && terminateButton}
          {!launchEnabled && launch?.outcome !== 'pending' && (
            <span id="lg-launch-why" className="lg-why">
              Launch disabled: {launchWhy}
            </span>
          )}
        </div>
        {dialogClosed && (
          <p className="lg-msg" role="status" aria-label="Launch confirmation closed" data-ok="false">
            Launch confirmation closed, nothing was sent: {dialogClosed}
          </p>
        )}
        {launch && (launch.outcome === 'accepted' || launch.outcome === 'refused') && (
          <p className="lg-msg" role={launch.outcome === 'accepted' ? 'status' : 'alert'} data-ok={launch.outcome === 'accepted'}>
            {launch.outcome === 'accepted' ? 'Launch accepted: ' : 'Launch refused: '}
            {launch.text.replace(/^launch refused:\s*/i, '')}
          </p>
        )}
        {launch?.outcome === 'unknown' && live.launchPhase !== 'unknown' && live.status === 'ready' && (
          <p className="lg-msg" role="status" data-ok="false">
            Launch outcome unknown ({launch.text}); the status received since reports mode "{live.data.mode}".
          </p>
        )}
        {shownTerminate?.confirmed && (
          <p className="lg-msg" role="status" data-ok="true">
            Terminate confirmed: {shownTerminate.reason}
          </p>
        )}
        {dialog && <ConfirmLaunch budget={dialog} onCancel={() => closeDialog(null)} onConfirm={doLaunch} />}
      </Panel>

      {/* FE2-1: everything below reads evidence; a failure there must never take the controls above with it. */}
      {data && data.workers.length > 0 && (
        <SectionBoundary what="the worker list" resetKey={data}>
          <Workers status={data} live={isLiveNow} clocks={clocks} />
        </SectionBoundary>
      )}

      {isLiveNow && data ? (
        <SectionBoundary what="the live chart" resetKey={data.workers}>
          <LiveChart workers={data.workers} comparison={liveComparison(live)} />
        </SectionBoundary>
      ) : (
        <SectionBoundary what="the replay" resetKey={`${transport.status}|${saved.status}`}>
          <ReplayPanel live={live} saved={saved} transport={transport} autoPlay={autoPlay} billing={!zeroCost} />
        </SectionBoundary>
      )}
    </div>
  );
}

/**
 * FE2-1: an error boundary around one evidence section of the view. Its failure is named in place; the
 * status, the alerts and Terminate above it are rendered outside it and stay up. Tries again when
 * `resetKey` changes (new data for the section).
 */
class SectionBoundary extends Component<{ what: string; resetKey?: unknown; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[labyrinth] Advance plasma: ${this.props.what} failed to render`, error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const what = this.props.what;
    return (
      <Callout tone="warn" title={`${what.charAt(0).toUpperCase()}${what.slice(1)} could not be displayed`}>
        <p className="lab-mono lg-broken__message">{this.state.error.message}</p>
        <p>The status, the alerts and Terminate above are not affected.</p>
      </Callout>
    );
  }
}

function BudgetLine({ live }: { live: LiveState }) {
  if (live.status !== 'ready') {
    return <p className="lg-budget">Budget guard: not reachable — no slot estimate available.</p>;
  }
  const b = live.data.budget;
  // cross-RX-5: slotFits is the guard's approval (reconciled ledger, usable values, under the ceiling), not a ceiling fit.
  return (
    <p className="lg-budget lab-num" data-testid="budget-line">
      Budget guard: billed {usd(b.billedUsd)} + pending {usd(b.pendingUsd)} of the {usd(b.ceilingUsd)} ceiling · next slot{' '}
      {usdExact(b.slotEstimateUsd)} (incl. setup, idle and storage)
      {b.hardTimeoutS !== undefined ? ` · hard timeout ${b.hardTimeoutS} s` : ''} ·{' '}
      <strong>{b.slotFits ? 'next slot approved by the budget guard' : 'next slot refused by the budget guard'}</strong>
    </p>
  );
}

/** `budget` is frozen by the parent when the dialog opens: the cost shown is exactly the cost sent. */
function ConfirmLaunch({ budget: b, onCancel, onConfirm }: { budget: Budget; onCancel: () => void; onConfirm: (cost: number) => void }) {
  const id = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  const after = b.billedUsd + b.pendingUsd + b.slotEstimateUsd;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    } else if (e.key === 'Tab') {
      const order = [cancelRef.current, confirmRef.current];
      const i = order.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      order[(i + (e.shiftKey ? order.length - 1 : 1)) % order.length]?.focus();
    }
  };
  return (
    <div className="lg-dialog-backdrop">
      <div
        className="lg-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-desc`}
        onKeyDown={onKeyDown}
      >
        <h3 id={`${id}-title`} className="lg-dialog__title">
          Launch a live GX slot?
        </h3>
        <div id={`${id}-desc`} className="lg-dialog__body">
          <p>
            Two A100-40GB workers (GPU 0 bean, GPU 1 triangular) on Modal. The budget guard estimates this slot at{' '}
            <strong className="lab-num" data-testid="confirm-cost">
              {usdExact(b.slotEstimateUsd)}
            </strong>{' '}
            including setup, idle margin and storage
            {b.hardTimeoutS !== undefined ? <>, with a hard timeout of <span className="lab-num">{b.hardTimeoutS} s</span></> : null}.
          </p>
          <p className="lab-num">
            Billed {usd(b.billedUsd)} + pending {usd(b.pendingUsd)} + this slot {usdExact(b.slotEstimateUsd)} = {usd(after)} of the{' '}
            {usd(b.ceilingUsd)} ceiling.
          </p>
        </div>
        <div className="lg-dialog__actions">
          <button ref={cancelRef} type="button" className="lg-btn" onClick={onCancel}>
            Cancel
          </button>
          <button ref={confirmRef} type="button" className="lg-btn lg-btn--primary" onClick={() => onConfirm(b.slotEstimateUsd)}>
            Confirm launch — {usdExact(b.slotEstimateUsd)}
          </button>
        </div>
      </div>
    </div>
  );
}

function Workers({ status, live, clocks }: { status: LiveStatus; live: boolean; clocks: Clocks }) {
  const workers = [...status.workers].sort((a, b) => a.gpuIndex - b.gpuIndex);
  const overlap = overlapClaim(workers, live);
  const pill = workersPill(status, live);
  return (
    <Panel
      eyebrow="Advance plasma"
      title={live ? 'Workers (live)' : `Workers (${status.mode}, not live)`}
      subtitle="Device IDs as reported by each worker; sim clocks and samples in archive units after conversion."
      status={<StatusPill status={pill.status}>{pill.text}</StatusPill>}
      headingLevel={3}
    >
      <div className="lg-workers">
        {workers.map((w) => (
          <WorkerCard key={w.gpuIndex} w={w} track={clocks[w.gpuIndex]} />
        ))}
      </div>
      {workers.length === 2 && (
        <p className="lg-overlap" data-testid="overlap" data-concurrent={overlap.concurrent}>
          {overlap.text}
        </p>
      )}
    </Panel>
  );
}

function WorkerCard({ w, track }: { w: LiveWorker; track: ClockTrack | undefined }) {
  const expected = EXPECTED_TUBE[w.gpuIndex];
  const last = w.samples[w.samples.length - 1];
  const advance = clockAdvance(track);
  const hasDevice = w.deviceId.trim() !== '';
  return (
    <article className="lg-worker" aria-label={`GPU ${w.gpuIndex}, ${w.tube} tube`} data-testid={`worker-${w.gpuIndex}`}>
      <header className="lg-worker__head">
        <span className="lg-worker__gpu">GPU {w.gpuIndex}</span>
        <span className="lg-worker__tube">{w.tube} tube</span>
        <span className="lg-worker__state" data-state={w.state}>
          {w.state}
        </span>
      </header>
      <p className="lg-worker__dev">
        Device ID{' '}
        <span className={hasDevice ? 'lab-mono' : 'lg-worker__nodev'} data-testid={`device-${w.gpuIndex}`}>
          {hasDevice ? w.deviceId : 'not reported yet'}
        </span>
      </p>
      {w.tube !== expected && (
        <p className="lg-worker__warn">Expected the {expected} tube on GPU {w.gpuIndex}.</p>
      )}
      <div className="lg-worker__stats">
        <Stat label={`GPU ${w.gpuIndex} sim clock`} value={w.simTime} unit={TIME_UNIT} decimals={1} />
        <Stat
          label={`GPU ${w.gpuIndex} flux samples`}
          value={w.samples.length}
          unit="dimensionless"
          decimals={0}
          note={
            last ? (
              <>
                latest Q = {formatNumber(last.Q, 3)} <Unit unit={FLUX_UNIT} /> at t = {formatNumber(last.t, 1)} <Unit unit={TIME_UNIT} />
              </>
            ) : undefined
          }
        />
      </div>
      {/* Evidence-based: a claim needs two timestamped status readings; "advancing" needs them to differ. */}
      <p className="lg-worker__clock" data-testid={`clock-${w.gpuIndex}`} data-advancing={advance !== null && advance.delta > 0}>
        {advance === null ? (
          'Clock: waiting for a second reading'
        ) : advance.delta > 0 ? (
          <>
            Clock advancing: +{formatNumber(advance.delta, 1)} <Unit unit={TIME_UNIT} /> between two readings {seconds(advance.overMs)} s apart
          </>
        ) : advance.delta === 0 ? (
          <>
            Clock not advancing: unchanged at {formatNumber(w.simTime, 1)} <Unit unit={TIME_UNIT} /> between two readings{' '}
            {seconds(advance.overMs)} s apart
          </>
        ) : (
          <>
            Clock not advancing: it went back by {formatNumber(-advance.delta, 1)} <Unit unit={TIME_UNIT} /> between two readings{' '}
            {seconds(advance.overMs)} s apart
          </>
        )}
      </p>
      {w.error && <p className="lg-worker__error" role="alert">Worker error: {w.error}</p>}
    </article>
  );
}

/** `comparison`: the backend's archive comparison, only for a fresh live snapshot that carries one (D-024). */
function LiveChart({ workers, comparison }: { workers: LiveWorker[]; comparison: LiveComparison | null }) {
  const theme = useResolvedTheme();
  const series: PlaySeries[] = useMemo(
    () =>
      [...workers]
        .sort((a, b) => a.gpuIndex - b.gpuIndex)
        .map((w) => ({
          id: `gx-${w.gpuIndex}`,
          name: `GX ${w.tube} · GPU ${w.gpuIndex} (live)`,
          seriesId: w.tube,
          t: w.samples.map((s) => s.t),
          Q: w.samples.map((s) => s.Q),
        })),
    [workers],
  );
  const fig = useMemo(() => playFigure(series, null, theme), [series, theme]);
  return (
    <Panel eyebrow="Advance plasma" title="New GX flux samples (live, archive units)" status={<StatusPill status="live">LIVE</StatusPill>} headingLevel={3}>
      <PlotlyChart data={fig.data} layout={fig.layout} ariaLabel="Live chart: new GX ion heat flux samples for both tubes versus time, archive units" summary={fig.summary} />
      <p className="lg-note">
        Q in <Unit unit={FLUX_UNIT} />, t in <Unit unit={TIME_UNIT} />; compare with the archives on the Check transport view.
      </p>
      {comparison && (
        <p className="lg-note" data-testid="comparison-summary">
          {comparisonSummary(comparison)} — see <a href="#/transport">Check transport</a>.
        </p>
      )}
    </Panel>
  );
}

const isNumberList = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number');

/**
 * FE2-1: the archived bean traces to replay, or what is wrong with the file. The loader checks schemaVersion
 * only; a body such as {"schemaVersion":1} must name its problem here instead of throwing in a render.
 */
function archiveTraces(data: TransportArtifact): { series: PlaySeries[] } | { problem: string } {
  const traces: unknown = (data as { traces?: unknown }).traces;
  if (!Array.isArray(traces)) return { problem: '"traces" is not a list' };
  const series: PlaySeries[] = [];
  for (const [i, raw] of traces.entries()) {
    if (typeof raw !== 'object' || raw === null) return { problem: `traces[${i}] is not an object` };
    const t = raw as Record<string, unknown>;
    if (t.tube !== 'bean' || (t.code !== 'stella' && t.code !== 'GENE')) continue;
    if (typeof t.id !== 'string' || !isNumberList(t.t) || !isNumberList(t.Q) || t.t.length !== t.Q.length) {
      return { problem: `traces[${i}] (${t.code} bean) needs an id and number lists t and Q of equal length` };
    }
    series.push({ id: t.id, name: `${t.code} bean (archive)`, seriesId: t.code, t: t.t, Q: t.Q });
  }
  return { series };
}

/** cross-RX-11: why the archive plays instead of a GX run, from what is known about the saved run. */
function noGxRunBecause(live: LiveState, saved: SavedRunState): string {
  if (saved.status === 'error') return `saved run ${saved.id} could not be loaded`;
  if (saved.status === 'ready') return `saved run ${saved.id} did not pass every check`; // a qualified one plays instead
  if (saved.status === 'loading') return `saved run ${saved.id} is still loading`;
  if (live.status !== 'ready') return 'the live API names no saved run';
  const id = live.data.fallback.savedRunId;
  return id === null ? 'no qualified GX rehearsal is recorded' : `saved run ${id} is named, but the API does not report the service as qualified`;
}

function ReplayPanel({
  live,
  saved,
  transport,
  autoPlay,
  billing,
}: {
  live: LiveState;
  saved: SavedRunState;
  transport: ArtifactState<TransportArtifact>;
  autoPlay?: boolean;
  /**
   * GPUs may be billing: the mode pills do not show "Replay · $0" (a danger, a launch that may be running, a
   * listed session). The replay costs nothing, but "$0" is not shown beside that (DESIGN.md §5).
   */
  billing: boolean;
}) {
  const archive = useMemo(() => (transport.status === 'ready' ? archiveTraces(transport.data) : null), [transport]);

  if (saved.status === 'ready' && savedRunQualified(saved.run)) {
    const series = savedRunSeries(saved.run);
    const devices = saved.run.phases.flatMap((p) => p.workers.map((w) => `GPU ${w.gpuIndex} ${w.deviceId}`));
    return (
      <Panel eyebrow="Advance plasma" title="Replay: saved GX rehearsal" status={<StatusPill status="rehearsal" />} headingLevel={3}>
        <Playback kind="rehearsal" label={`saved GX rehearsal run ${saved.id}`} series={series} autoPlay={autoPlay}>
          <p className="lg-note">
            Recorded rehearsal, not live. Checks: initialization ✓, checkpoint continuation ✓, distinct devices ✓, overlapping
            execution ✓. Devices recorded: <span className="lab-mono">{[...new Set(devices)].join(', ')}</span>.
          </p>
        </Playback>
      </Panel>
    );
  }

  const because = noGxRunBecause(live, saved);
  const label =
    live.status === 'ready' && live.data.fallback.label
      ? `archived stella/GENE evidence (${live.data.fallback.label})`
      : `archived stella/GENE evidence (${because})`;
  return (
    <Panel
      title="Replay: archived stella and GENE bean traces"
      subtitle={`${billing ? 'Saved evidence played back.' : 'Saved evidence played back at $0.'} No GX run is shown: none is live, and ${because}.`}
      status={<StatusPill status="replay">{billing ? 'Replay' : 'Replay · $0'}</StatusPill>}
      headingLevel={3}
    >
      {saved.status === 'error' && (
        <Callout tone="warn" title={`Saved run ${saved.id} could not be loaded — playing archived evidence instead`}>
          {saved.message}
        </Callout>
      )}
      {saved.status === 'ready' && !savedRunQualified(saved.run) && (
        <Callout tone="warn" title={`Saved run ${saved.id} did not pass every check — not played`}>
          A saved run is labelled a GX rehearsal only when initialization, continuation, distinct devices and overlap all
          verified (D-018).
        </Callout>
      )}
      {archive && 'problem' in archive ? (
        <Callout tone="warn" title="artifacts/transport.json has an unexpected shape — no archived evidence to replay">
          <p className="lab-mono lg-broken__message">{archive.problem}</p>
        </Callout>
      ) : archive ? (
        <Playback kind="replay" label={label} series={archive.series} autoPlay={autoPlay} />
      ) : transport.status === 'error' ? (
        <Callout tone="warn" title={`${transport.file} failed to load`}>
          {transport.message}
        </Callout>
      ) : (
        <p className="lg-note">Loading archived evidence…</p>
      )}
    </Panel>
  );
}
