"""Live GX orchestrator: a state machine over two workers with an injected backend.

GPU 0 advances the bean tube and GPU 1 the triangular tube (PRD, Advance plasma). The backend
does the real work (Modal in production, `fake_backend` in tests); this module only:

* launches both workers (optionally resuming each from a checkpoint),
* polls them, records device IDs and wall-clock intervals, converts new flux samples from raw GX
  normalisation to archive units, and enforces that simulation clocks only advance,
* on any worker failure (or a malformed report, or a hard timeout before both workers finish) switches
  to `fallback`, preserves the error and terminates the other worker from the failure path itself,
* always terminates every launched worker after retrieval (also on exception), retrying with backoff;
  a termination that cannot be confirmed is reported loudly and never shown as `terminated`,
* renders snapshots in the shape of contracts/live-status.schema.json.

It never imports `modal` and makes no network calls itself.
"""
from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol

from ..transport.units import gx_to_archive

TUBES: tuple[tuple[int, str], ...] = ((0, "bean"), (1, "triangular"))
WORKER_STATES = {"pending", "initializing", "running", "checkpointed", "failed", "done"}
EXECUTING = {"running", "checkpointed", "done"}
UNITS = ("archive units: t in a/v_th,i (GX raw t x sqrt(2)), Q in Q_gB,i (GX raw Q / 2 sqrt(2)); "
         "conversion assumes identical dimensional references (UNREHEARSED)")
NO_REHEARSAL_LABEL = "No qualified GX rehearsal recorded — showing archived stella/GENE evidence"
TERMINATE_FAILED = "TERMINATE FAILED — check Modal dashboard; GPUs may still be billing"
TERMINATE_PENDING = "TERMINATION PENDING — cancel queued, not yet confirmed; GPUs may still be billing"
TERMINATE_BACKOFF_S = (0.5, 1.0, 2.0, 4.0)
MAX_TRANSIENT_POLLS = 2   # consecutive transient poll errors tolerated (inside the hard timeout) before failing


class TransientBackendError(Exception):
    """A backend call failed in a way that may succeed on retry (e.g. a client-side call timeout)."""


class LaunchInFlight(Exception):
    """backend.launch did not complete normally but MAY have started a worker: the call is still in flight
    (the backend cancels the late call the moment it returns) or it failed client-side after it was sent.
    `handle` must be terminated like any launched worker; `status` is the worker error shown to the operator
    (`{}` in the template is replaced by the message)."""

    def __init__(self, message: str, handle: Any, status: str = "launch did not complete in time ({}); its cancel is queued"):
        super().__init__(message)
        self.handle = handle
        self.status = status.format(message)


class TerminationPending(Exception):
    """backend.terminate cannot confirm yet (e.g. the launch is still in flight) but has queued the cancel.
    `subscribe(cb)` registers cb(confirmed: bool, error: str | None), called exactly once when settled."""

    def __init__(self, message: str, subscribe: Callable[[Callable[[bool, str | None], None]], None]):
        super().__init__(message)
        self.subscribe = subscribe


@dataclass(frozen=True)
class Checkpoint:
    tube: str
    sim_time_raw: float
    ref: str


class WorkerBackend(Protocol):
    def launch(self, tube: str, gpu_index: int, checkpoint: Checkpoint | None) -> Any: ...

    def poll(self, handle: Any) -> dict:
        """-> {device_id, state, sim_time_raw, new_samples_raw: [[t, Q], ...], error}
        optional: checkpoint {ref, sim_time_raw}, wall_start, wall_end (epoch s), solver_revision."""
        ...

    def terminate(self, handle: Any) -> None: ...


@dataclass
class WorkerRecord:
    gpu_index: int
    tube: str
    resume_from: Checkpoint | None = None
    device_id: str = ""
    state: str = "pending"
    sim_time_raw: float | None = None
    sim_time: float | None = None
    last_sample_t_raw: float | None = None
    wall_start: float | None = None     # local clock (orchestrator) — single clock source for intervals
    wall_end: float | None = None
    remote_wall_start: float | None = None  # as reported by the worker (its container's clock)
    remote_wall_end: float | None = None
    samples: list[dict] = field(default_factory=list)
    error: str | None = None
    checkpoint: Checkpoint | None = None
    solver_revision: str | None = None
    handle: Any = None
    launched: bool = False
    terminated: bool = False            # True only once backend.terminate() succeeded
    terminate_error: str | None = None
    terminate_pending: bool = False     # cancel queued with the backend; not confirmed yet
    transient_polls: int = 0

    def to_status(self) -> dict:
        return {
            "gpuIndex": self.gpu_index,
            "deviceId": self.device_id,
            "tube": self.tube,
            "state": self.state,
            "simTime": self.sim_time,
            "wallStart": _iso(self.wall_start),
            "samples": list(self.samples),
            "error": "; ".join(e for e in (self.error, self.terminate_error) if e) or None,
        }


def _iso(epoch: float | None) -> str | None:
    return None if epoch is None else datetime.fromtimestamp(epoch, UTC).isoformat(timespec="milliseconds")


def _number(x: Any) -> float | None:
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return None
    x = float(x)
    return x if x == x and x not in (float("inf"), float("-inf")) else None


def apply_poll(rec: WorkerRecord, result: Any, now: float) -> str | None:
    """Fold one poll result into `rec`. Returns an error message if the result is malformed or the
    worker reports failure (the caller then fails the run); otherwise None. Pure apart from `rec`."""
    if not isinstance(result, dict):
        return f"malformed poll result {result!r}"
    state = result.get("state")
    if state not in WORKER_STATES:
        return f"worker reported unknown state {state!r}"
    if result.get("device_id"):
        rec.device_id = str(result["device_id"])
    if result.get("solver_revision"):
        rec.solver_revision = str(result["solver_revision"])
    if state == "failed" or result.get("error"):
        return str(result.get("error") or "worker failed without an error message")
    new = result.get("new_samples_raw") or []
    if not isinstance(new, (list, tuple)):
        return f"malformed new_samples_raw {new!r}"
    ck = result.get("checkpoint")
    if ck is not None and not isinstance(ck, dict):
        return f"malformed checkpoint report {ck!r}"

    t_raw = result.get("sim_time_raw")
    if t_raw is not None:
        t_raw = _number(t_raw)
        if t_raw is None:
            return "worker reported a non-finite simulation time"
        floor = rec.sim_time_raw if rec.sim_time_raw is not None else (rec.resume_from.sim_time_raw if rec.resume_from else None)
        if floor is not None and t_raw < floor:
            what = "checkpoint" if rec.sim_time_raw is None else "previous report"
            return f"simulation clock went backwards ({t_raw} < {floor} from {what}); checkpoint continuation broken"

    ts, qs = [], []
    # Samples strictly advance; the first sample of a resumed worker may sit on the checkpoint time.
    last, strict = rec.last_sample_t_raw, True
    if last is None and rec.resume_from is not None:
        last, strict = rec.resume_from.sim_time_raw, False
    for pair in new:
        if not isinstance(pair, (list, tuple)) or len(pair) != 2:
            return f"malformed flux sample {pair!r}"
        t, q = _number(pair[0]), _number(pair[1])
        if t is None or q is None:
            return f"non-finite flux sample {pair!r}"
        if last is not None and (t <= last if strict else t < last):
            return f"flux sample times must advance ({t} after {last})"
        last, strict = t, True
        ts.append(t)
        qs.append(q)

    ck_obj = None
    if ck:
        ck_t = _number(ck.get("sim_time_raw"))
        if ck_t is None or not ck.get("ref"):
            return f"malformed checkpoint report {ck!r}"
        ck_obj = Checkpoint(rec.tube, ck_t, str(ck["ref"]))

    # validated: apply
    if t_raw is not None:
        rec.sim_time_raw = t_raw
        rec.sim_time = gx_to_archive([t_raw], [0.0], identical_references=True)[0][0]
    if ts:
        t_arch, q_arch = gx_to_archive(ts, qs, identical_references=True)
        rec.samples.extend({"t": a, "Q": b} for a, b in zip(t_arch, q_arch, strict=True))
        rec.last_sample_t_raw = ts[-1]
    if ck_obj is not None:
        rec.checkpoint = ck_obj
    if rec.remote_wall_start is None:
        rec.remote_wall_start = _number(result.get("wall_start"))
    if rec.remote_wall_end is None:
        rec.remote_wall_end = _number(result.get("wall_end"))
    if state in EXECUTING and rec.wall_start is None:
        rec.wall_start = now
    if state == "done" and rec.wall_end is None:
        rec.wall_end = now
    rec.state = state
    return None


class Orchestrator:
    """One live (or rehearsal) session. Thread-safe snapshots; `run()` blocks until the session ends."""

    def __init__(self, backend: WorkerBackend, *, hard_timeout_s: float, saved_run_id: str | None = None,
                 checkpoints: dict[str, Checkpoint] | None = None, kind: str = "live",
                 clock: Callable[[], float] = time.time, monotonic: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], None] = time.sleep,
                 retry_sleep: Callable[[float], None] = time.sleep,
                 terminate_backoff_s: tuple[float, ...] = TERMINATE_BACKOFF_S):
        self.backend = backend
        self.hard_timeout_s = float(hard_timeout_s)
        self.saved_run_id = saved_run_id
        self.kind = kind
        self.clock = clock          # wall clock: displayed wallStart / intervals only
        self.monotonic = monotonic  # hard timeout and runtime: immune to wall-clock jumps
        self._t0: float | None = None
        self._t_end: float | None = None
        self.sleep = sleep
        self.retry_sleep = retry_sleep
        self.terminate_backoff_s = tuple(terminate_backoff_s)
        checkpoints = checkpoints or {}
        self.workers = [WorkerRecord(g, t, resume_from=checkpoints.get(t)) for g, t in TUBES]
        self.mode = "idle"
        self._reason = "Ready: nothing is launched until an explicit, budget-approved launch."
        self._terminate_failure: str | None = None
        self.fallback_label = ""
        self.started_at: float | None = None
        self.ended_at: float | None = None
        self._lock = threading.RLock()
        self._term_lock = threading.Lock()
        self._stop_requested = False  # plain flag, no lock: request_stop() may run inside a signal handler
        self._confirmed = threading.Event()
        self._confirmed.set()  # nothing launched yet

    @property
    def reason(self) -> str:
        with self._lock:
            if self._terminate_failure:
                pending_only = all(r.terminate_pending for r in self.workers if r.launched and not r.terminated)
                return f"{TERMINATE_PENDING if pending_only else TERMINATE_FAILED}: {self._terminate_failure}. {self._reason}"
            return self._reason

    @property
    def termination_confirmed(self) -> bool:
        with self._lock:
            return all(r.terminated for r in self.workers if r.launched)

    # ---- lifecycle -----------------------------------------------------
    def launch(self) -> None:
        with self._lock:
            if self.mode != "idle":
                raise RuntimeError(f"cannot launch from mode {self.mode!r}")
            self.mode, self._reason = "launching", f"Launching GX workers ({self.kind}); hard timeout {self.hard_timeout_s:g} s."
            self.started_at = self.clock()
            self._t0 = self.monotonic()
        for rec in self.workers:
            if self.mode == "fallback" or self._stop_requested:
                break
            try:
                handle = self.backend.launch(rec.tube, rec.gpu_index, rec.resume_from)
            except LaunchInFlight as e:  # the worker may exist: it must be terminated before anything is "confirmed"
                with self._lock:
                    rec.handle, rec.launched = e.handle, True
                    self._confirmed.clear()
                self._fail(rec, e.status)
                break
            except Exception as e:  # noqa: BLE001 - any other launch failure is a worker failure
                self._fail(rec, f"launch failed: {type(e).__name__}: {e}")
                break
            with self._lock:
                rec.handle, rec.launched = handle, True
                self._confirmed.clear()
                if rec.state == "pending":
                    rec.state = "initializing"

    def poll_once(self) -> None:
        for rec in self.workers:
            if not rec.launched or rec.terminated or rec.state in ("done", "failed"):
                continue
            try:
                result = self.backend.poll(rec.handle)
                with self._lock:
                    rec.transient_polls = 0
                    err = apply_poll(rec, result, self.clock())
            except TransientBackendError as e:
                with self._lock:
                    rec.transient_polls += 1
                    if rec.transient_polls <= MAX_TRANSIENT_POLLS:
                        continue  # tolerated; the hard timeout still bounds the session
                err = f"poll failed {rec.transient_polls} times in a row: {type(e).__name__}: {e}"
            except Exception as e:  # noqa: BLE001 - a backend that cannot report (or reports garbage) is a failed worker
                err = f"poll failed: {type(e).__name__}: {e}"
            if err:
                self._fail(rec, err)
                return
        with self._lock:
            if self.mode == "launching" and any(r.state in EXECUTING for r in self.workers):
                self.mode, self._reason = "live", f"Both workers launched; streaming GX output ({self.kind})."

    def request_stop(self) -> None:
        """Cooperative stop: no further spawn, and run() ends (terminating every launched worker) at its next
        check. Only stores a flag — no lock — so it is safe to call from a signal handler (`rehearse` does)."""
        self._stop_requested = True

    def run(self, poll_interval_s: float = 2.0, on_snapshot: Callable[[], None] | None = None) -> None:
        """Launch, poll until both workers are done / one fails / stop / hard timeout; always terminate."""
        end: tuple[str, str] | None = None
        try:
            self.launch()
            if on_snapshot:
                on_snapshot()
            while self.mode in ("launching", "live"):
                if self._stop_requested:
                    end = ("terminated", "Stopped on request; workers terminated.")
                    break
                if self.monotonic() - self._t0 >= self.hard_timeout_s:
                    self._fallback(f"Hard timeout reached: {self.hard_timeout_s:g} s elapsed before both workers finished; "
                                   "workers terminated.", cause="timeout")
                    break
                self.poll_once()
                if on_snapshot:
                    on_snapshot()
                if self.mode == "live" and all(r.state == "done" for r in self.workers):
                    end = ("terminated", "Both workers finished; output retrieved and workers terminated.")
                    break
                if self.mode in ("launching", "live"):
                    self.sleep(poll_interval_s)
        finally:
            if self.terminate_all() and self.mode in ("launching", "live"):
                self._end(*(end or ("terminated", "Session ended abnormally; workers terminated.")))
            if on_snapshot:
                on_snapshot()

    def stop_and_terminate(self) -> bool:
        """Operator stop: terminate everything; True only if every termination is confirmed."""
        self.request_stop()
        ok = self.terminate_all()
        if ok and self.mode in ("launching", "live"):
            self._end("terminated", "Stopped on request; workers terminated.")
        return ok

    def terminate_all(self) -> bool:
        """Terminate each launched worker exactly once on success, retrying failures with backoff.
        Returns True when every launched worker's termination is confirmed."""
        with self._term_lock:
            for rec in self.workers:
                with self._lock:
                    if not rec.launched or rec.terminated or rec.terminate_pending:
                        continue
                last_err, pending = None, None
                for delay in (0.0, *self.terminate_backoff_s):
                    if delay:
                        self.retry_sleep(delay)
                    try:
                        self.backend.terminate(rec.handle)
                        last_err = None
                        break
                    except TerminationPending as e:
                        pending = e
                        break
                    except Exception as e:  # noqa: BLE001
                        last_err = f"{type(e).__name__}: {e}"
                if pending is not None:
                    with self._lock:
                        rec.terminate_pending = True
                        rec.terminate_error = f"termination pending: {pending}"
                    pending.subscribe(lambda ok, err, rec=rec: self._settled(rec, ok, err))
                    continue
                self._settled(rec, last_err is None, last_err and
                              f"terminate unconfirmed after {1 + len(self.terminate_backoff_s)} attempts: {last_err}")
            return self._refresh_confirmation()

    def wait_terminated(self, timeout_s: float) -> bool:
        """Block until every launched worker's termination is confirmed (or timeout)."""
        return self._confirmed.wait(timeout_s)

    def _settled(self, rec: WorkerRecord, ok: bool, err: str | None) -> None:
        with self._lock:
            rec.terminate_pending = False
            if ok:
                rec.terminated, rec.terminate_error = True, None
                if rec.wall_start is not None and rec.wall_end is None:
                    rec.wall_end = self.clock()
            else:
                rec.terminate_error = err or "terminate failed"
        self._refresh_confirmation()

    def _refresh_confirmation(self) -> bool:
        with self._lock:
            failed = [r for r in self.workers if r.launched and not r.terminated]
            self._terminate_failure = "; ".join(f"GPU {r.gpu_index} ({r.tube}) {r.terminate_error}" for r in failed) or None
            if failed:
                self._confirmed.clear()
            else:
                self._confirmed.set()
            return not failed

    # ---- internals -----------------------------------------------------
    def _end(self, mode: str, reason: str) -> None:
        with self._lock:
            if self.mode == "fallback":
                return
            self.mode, self._reason = mode, reason
            self.ended_at = self.clock()
            self._t_end = self.monotonic()

    def _fallback(self, reason: str, cause: str = "worker") -> None:
        """Switch to the labelled fallback (first cause wins) and terminate every worker right here."""
        with self._lock:
            if self.mode != "fallback":
                self.mode, self._reason = "fallback", reason
                what = "Hard timeout reached" if cause == "timeout" else "Worker failed"
                self.fallback_label = (f"{what} — playing saved GX run {self.saved_run_id}" if self.saved_run_id
                                       else f"{what}. {NO_REHEARSAL_LABEL}")
                self.ended_at = self.clock()
                self._t_end = self.monotonic()
        self.terminate_all()

    def _fail(self, rec: WorkerRecord, error: str) -> None:
        with self._lock:
            rec.state, rec.error = "failed", error
            if rec.wall_start is not None and rec.wall_end is None:
                rec.wall_end = self.clock()
        self._fallback(f"GPU {rec.gpu_index} ({rec.tube}) worker failed: {error}. Other worker terminated.")

    # ---- views ---------------------------------------------------------
    def _verification(self, qualified: bool) -> dict:
        if self.kind == "rehearsal":
            return {"outcome": "not-applicable",
                    "details": "Qualification rehearsal phase; its init / continuation checks are recorded with the saved run."}
        if not qualified:
            return {"outcome": "blocked", "details": "UNREHEARSED: no recorded rehearsal has verified initialization and "
                                                     "checkpoint continuation (D-011)."}
        return {"outcome": "not-applicable",
                "details": "Qualified by a recorded rehearsal; compare with archived evidence in Check transport."}

    def intervals(self) -> dict[str, tuple[float | None, float | None]]:
        """Wall-clock intervals on the orchestrator's own clock."""
        with self._lock:
            return {r.tube: (r.wall_start, r.wall_end) for r in self.workers}

    def remote_intervals(self) -> dict[str, tuple[float | None, float | None]]:
        """Intervals as reported by the workers themselves (None where not reported)."""
        with self._lock:
            return {r.tube: (r.remote_wall_start, r.remote_wall_end) for r in self.workers}

    def latest_checkpoints(self) -> dict[str, Checkpoint]:
        with self._lock:
            return {r.tube: r.checkpoint for r in self.workers if r.checkpoint is not None}

    def snapshot(self, budget: dict, *, qualified: bool) -> dict:
        with self._lock:
            workers = [r.to_status() for r in self.workers]
            samples = [s["t"] for r in self.workers for s in r.samples]
            revs = sorted({r.solver_revision for r in self.workers if r.solver_revision})
            end = self._t_end if self._t_end is not None else self.monotonic()
            runtime = f"{end - self._t0:.1f} s wall" if self._t0 is not None else "unknown"
            out = {
                "schemaVersion": 1,
                "mode": self.mode,
                "reason": self.reason,
                "qualified": bool(qualified),
                "budget": dict(budget),
                "workers": workers,
                "fallback": {
                    "active": self.mode == "fallback",
                    "label": self.fallback_label,
                    "savedRunId": self.saved_run_id,
                },
                "provenance": {
                    "kind": "rehearsal" if self.kind == "rehearsal" else "live",
                    "solverRevision": ", ".join(revs) if revs else "GX (revision not yet reported by worker)",
                    "units": UNITS,
                    "coverage": {
                        "description": "Flux samples generated by this session's GX workers (bean and triangular).",
                        "tStart": min(samples) if samples else None,
                        "tEnd": max(samples) if samples else None,
                    },
                    "runtime": runtime,
                    "verification": self._verification(qualified),
                    "sources": [],
                },
            }
            return out
