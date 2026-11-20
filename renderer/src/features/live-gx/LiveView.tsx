// Advance plasma (task 06, L9–L10). Polls /api/live/status via useLiveStatus. LIVE appears ONLY when
// the API reports mode "live"; every other state plays saved evidence and says so. Launch needs mode
// idle + budget.slotFits + an explicit confirmation of the slot cost; Terminate is always loud on failure.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  Callout,
  Icon,
  Panel,
  ProvenanceBadge,
  Stat,
  StatusPill,
  Unit,
  formatNumber,
  useResolvedTheme,
  type Provenance,
} from '../../design';
import { useArtifact, type ArtifactState } from '../../lib/artifacts';
import { useLiveStatus, type LiveState, type LiveStatus, type LiveWorker } from '../../lib/liveStatus';
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
  savedRunQualified,
  savedRunSeries,
  savedRunToFetch,
  statusTerminateFailure,
  trackClocks,
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
}

// The contract allows an optional provenance on the status; lib's LiveStatus type omits it.
const provenanceOf = (d: LiveStatus | null): Provenance | undefined => (d as (LiveStatus & { provenance?: Provenance }) | null)?.provenance;

const usd = (v: number) => `$${formatNumber(v, 2)}`;

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
    fetch(`/api/live/runs/${encodeURIComponent(id)}`, { headers: { Accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`/api/live/runs/${id}: HTTP ${res.status}`);
        return (await res.json()) as SavedRun;
      })
      .then(
        (run) => alive && setState({ status: 'ready', id, run }),
        (e: unknown) => alive && setState({ status: 'error', id, message: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      alive = false;
    };
  }, [id]);
  return state;
}

interface PostResult {
  httpOk: boolean;
  status: number;
  body: { ok?: boolean; reason?: string } | null;
}
async function postJson(url: string, body: unknown): Promise<PostResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  let parsed: PostResult['body'] = null;
  try {
    parsed = (await res.json()) as PostResult['body'];
  } catch {
    parsed = null;
  }
  return { httpOk: res.ok, status: res.status, body: parsed };
}

export function LiveView({ pollMs = 2000, autoPlay }: LiveViewProps = {}) {
  const live = useLiveStatus(pollMs);
  const transport = useArtifact<TransportArtifact>('transport');
  const mv = modeView(live);
  const saved = useSavedRun(savedRunToFetch(live));
  const [clocks, setClocks] = useState<Clocks>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [launchMsg, setLaunchMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [terminate, setTerminate] = useState<{ ok: boolean; reason: string } | null>(null);
  const [busy, setBusy] = useState<'launch' | 'terminate' | null>(null);
  const launchRef = useRef<HTMLButtonElement>(null);
  const data = live.status === 'ready' ? live.data : null;

  useEffect(() => {
    if (data) setClocks((c) => trackClocks(c, data.workers));
  }, [data]);

  const statusTermFail = statusTerminateFailure(live);
  const termFailed = terminate !== null && !terminate.ok;
  const launchEnabled = canLaunch(live) && busy === null;
  const terminateEnabled = canTerminate(live, termFailed) && busy !== 'terminate';
  const isLiveNow = data?.mode === 'live';

  const doLaunch = async (cost: number) => {
    setDialogOpen(false);
    setBusy('launch');
    setLaunchMsg(null);
    try {
      const r = await postJson('/api/live/launch', { confirmCostUsd: cost });
      const ok = r.httpOk && r.body?.ok === true;
      setLaunchMsg({ ok, text: r.body?.reason ?? `HTTP ${r.status}` });
    } catch (e) {
      setLaunchMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
      launchRef.current?.focus();
    }
  };

  const doTerminate = async () => {
    setBusy('terminate');
    try {
      const r = await postJson('/api/live/terminate', {});
      const ok = r.httpOk && r.body?.ok === true;
      setTerminate({ ok, reason: r.body?.reason ?? `HTTP ${r.status}` });
    } catch (e) {
      setTerminate({ ok: false, reason: `No response from /api/live/terminate (${e instanceof Error ? e.message : String(e)}); termination is unconfirmed.` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="lg-view">
      <Panel
        eyebrow="Advance plasma"
        title="Nonlinear GX on two A100s: GPU 0 bean tube, GPU 1 triangular tube"
        subtitle="Status from /api/live/status. Nothing launches without an explicit, cost-confirmed request; replay costs $0."
        status={
          <div className="lg-pills" data-testid="mode-pills">
            {mv.pills.map((p) => (
              <StatusPill key={p.text} status={p.status} size="md">
                {p.text}
              </StatusPill>
            ))}
            {provenanceOf(data) && <ProvenanceBadge provenance={provenanceOf(data)!} subject="live GX status" />}
          </div>
        }
      >
        {(statusTermFail || termFailed) && (
          <div className="lg-danger" role="alert" data-testid="terminate-failed">
            <Icon name="alert" size={20} />
            <div>
              <p className="lg-danger__title">TERMINATE FAILED — GPUs may still be billing</p>
              <p className="lg-danger__body">
                {termFailed ? terminate?.reason : statusTermFail} Retry Terminate, and check the Modal dashboard until both
                workers are confirmed stopped.
              </p>
            </div>
          </div>
        )}

        <div className="lg-banner" data-tone={mv.tone} data-live={isLiveNow} data-testid="mode-banner">
          <p className="lg-banner__title">{mv.title}</p>
          <p className="lg-banner__body">
            {live.status === 'ready'
              ? live.data.reason
              : live.status === 'unreachable'
                ? `${live.message}. No backend is answering (static replay build), so nothing can be launched from here.`
                : 'Waiting for the first status poll.'}
          </p>
          {data && data.fallback.label && <p className="lg-banner__body lg-banner__fallback">{data.fallback.label}</p>}
        </div>

        <BudgetLine live={live} />

        <div className="lg-actions">
          <button
            ref={launchRef}
            type="button"
            className="lg-btn lg-btn--primary"
            disabled={!launchEnabled}
            aria-describedby={launchEnabled ? undefined : 'lg-launch-why'}
            onClick={() => setDialogOpen(true)}
          >
            {busy === 'launch' ? 'Launching…' : 'Launch live slot…'}
          </button>
          <button
            type="button"
            className="lg-btn lg-btn--danger"
            disabled={!terminateEnabled}
            onClick={doTerminate}
          >
            {busy === 'terminate' ? 'Terminating…' : termFailed || statusTermFail ? 'Retry terminate' : 'Terminate'}
          </button>
          {!launchEnabled && busy === null && (
            <span id="lg-launch-why" className="lg-why">
              Launch disabled: {launchBlockedReason(live)}
            </span>
          )}
        </div>
        {launchMsg && (
          <p className="lg-msg" role={launchMsg.ok ? 'status' : 'alert'} data-ok={launchMsg.ok}>
            {launchMsg.ok ? 'Launch accepted: ' : 'Launch refused: '}
            {launchMsg.text.replace(/^launch refused:\s*/i, '')}
          </p>
        )}
        {terminate?.ok && (
          <p className="lg-msg" role="status" data-ok="true">
            Terminate confirmed: {terminate.reason}
          </p>
        )}
        {dialogOpen && data && (
          <ConfirmLaunch status={data} onCancel={() => { setDialogOpen(false); launchRef.current?.focus(); }} onConfirm={doLaunch} />
        )}
      </Panel>

      {data && data.workers.length > 0 && <Workers status={data} clocks={clocks} />}

      {isLiveNow && data ? (
        <LiveChart workers={data.workers} />
      ) : (
        <ReplayPanel live={live} saved={saved} transport={transport} autoPlay={autoPlay} />
      )}
    </div>
  );
}

function BudgetLine({ live }: { live: LiveState }) {
  if (live.status !== 'ready') {
    return <p className="lg-budget">Budget guard: not reachable — no slot estimate available.</p>;
  }
  const b = live.data.budget;
  return (
    <p className="lg-budget lab-num" data-testid="budget-line">
      Budget guard: billed {usd(b.billedUsd)} + pending {usd(b.pendingUsd)} of the {usd(b.ceilingUsd)} ceiling · next slot{' '}
      {usd(b.slotEstimateUsd)} (incl. setup, idle and storage)
      {b.hardTimeoutS !== undefined ? ` · hard timeout ${b.hardTimeoutS} s` : ''} ·{' '}
      <strong>{b.slotFits ? 'slot fits' : 'slot does NOT fit'}</strong>
    </p>
  );
}

function ConfirmLaunch({ status, onCancel, onConfirm }: { status: LiveStatus; onCancel: () => void; onConfirm: (cost: number) => void }) {
  const id = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Freeze the price the user is shown; the POST confirms exactly this figure.
  const [b] = useState(status.budget);
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
              {usd(b.slotEstimateUsd)}
            </strong>{' '}
            including setup, idle margin and storage
            {b.hardTimeoutS !== undefined ? <>, with a hard timeout of <span className="lab-num">{b.hardTimeoutS} s</span></> : null}.
          </p>
          <p className="lab-num">
            Billed {usd(b.billedUsd)} + pending {usd(b.pendingUsd)} + this slot {usd(b.slotEstimateUsd)} = {usd(after)} of the{' '}
            {usd(b.ceilingUsd)} ceiling.
          </p>
        </div>
        <div className="lg-dialog__actions">
          <button ref={cancelRef} type="button" className="lg-btn" onClick={onCancel}>
            Cancel
          </button>
          <button ref={confirmRef} type="button" className="lg-btn lg-btn--primary" onClick={() => onConfirm(b.slotEstimateUsd)}>
            Confirm launch — {usd(b.slotEstimateUsd)}
          </button>
        </div>
      </div>
    </div>
  );
}

function Workers({ status, clocks }: { status: LiveStatus; clocks: Clocks }) {
  const live = status.mode === 'live';
  const workers = [...status.workers].sort((a, b) => a.gpuIndex - b.gpuIndex);
  const running = workers.filter((w) => w.state === 'running' || w.state === 'initializing');
  return (
    <Panel
      eyebrow="Advance plasma"
      title={live ? 'Workers (live)' : `Workers (${status.mode}, not live)`}
      subtitle="Device IDs as reported by each worker; sim clocks and samples in archive units after conversion."
      status={live ? <StatusPill status="live">LIVE</StatusPill> : <StatusPill status={status.mode === 'fallback' ? 'failed' : 'replay'}>{status.mode}</StatusPill>}
      headingLevel={3}
    >
      <div className="lg-workers">
        {workers.map((w) => (
          <WorkerCard key={w.gpuIndex} w={w} advance={clockAdvance(clocks[w.gpuIndex])} />
        ))}
      </div>
      {workers.length === 2 && (
        <p className="lg-overlap" data-testid="overlap">
          {running.length === 2
            ? 'Both solvers are executing concurrently on separate devices.'
            : `Concurrent execution not shown: ${running.length} of 2 workers running.`}
          {workers[0]?.deviceId === workers[1]?.deviceId && ' Warning: both workers report the same device ID.'}
        </p>
      )}
    </Panel>
  );
}

function WorkerCard({ w, advance }: { w: LiveWorker; advance: number | null }) {
  const expected = EXPECTED_TUBE[w.gpuIndex];
  const last = w.samples[w.samples.length - 1];
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
        Device ID <span className="lab-mono" data-testid={`device-${w.gpuIndex}`}>{w.deviceId}</span>
      </p>
      {w.tube !== expected && (
        <p className="lg-worker__warn">Expected the {expected} tube on GPU {w.gpuIndex}.</p>
      )}
      <div className="lg-worker__stats">
        <Stat label={`GPU ${w.gpuIndex} sim clock`} value={w.simTime} unit={TIME_UNIT} decimals={1} />
        <Stat label={`GPU ${w.gpuIndex} flux samples`} value={w.samples.length} unit="dimensionless" decimals={0} note={last ? `latest Q = ${formatNumber(last.Q, 3)} at t = ${formatNumber(last.t, 1)}` : undefined} />
      </div>
      <p className="lg-worker__clock" data-testid={`clock-${w.gpuIndex}`} data-advancing={advance !== null && advance > 0}>
        {advance === null
          ? 'Clock: waiting for a second reading'
          : advance > 0
            ? `Clock advancing: +${formatNumber(advance, 1)} since the previous reading`
            : 'Clock not advancing since the previous reading'}
      </p>
      {w.error && <p className="lg-worker__error" role="alert">Worker error: {w.error}</p>}
    </article>
  );
}

function LiveChart({ workers }: { workers: LiveWorker[] }) {
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
    </Panel>
  );
}

function ReplayPanel({
  live,
  saved,
  transport,
  autoPlay,
}: {
  live: LiveState;
  saved: SavedRunState;
  transport: ArtifactState<TransportArtifact>;
  autoPlay?: boolean;
}) {
  const archiveSeries: PlaySeries[] = useMemo(() => {
    if (transport.status !== 'ready') return [];
    return transport.data.traces
      .filter((t) => t.tube === 'bean' && (t.code === 'stella' || t.code === 'GENE'))
      .map((t) => ({ id: t.id, name: `${t.code} bean (archive)`, seriesId: t.code as 'stella' | 'GENE', t: t.t, Q: t.Q }));
  }, [transport]);

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

  const label =
    live.status === 'ready' && live.data.fallback.label
      ? `archived stella/GENE evidence (${live.data.fallback.label})`
      : 'archived stella/GENE evidence (no qualified GX rehearsal recorded)';
  return (
    <Panel
      eyebrow="Advance plasma"
      title="Replay: archived stella and GENE bean traces"
      subtitle="Saved evidence played back at $0. No GX run is shown because none is live and no qualified rehearsal is recorded."
      status={<StatusPill status="replay">Replay · $0</StatusPill>}
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
      {transport.status === 'ready' ? (
        <Playback kind="replay" label={label} series={archiveSeries} autoPlay={autoPlay} />
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
