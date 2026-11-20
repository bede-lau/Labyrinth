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

Termination invariant. A launched worker counts as terminated only when `backend.terminate(handle)` RETURNED
(the backend confirmed the stop: for Modal, the cancel of the spawned call succeeded) or a queued cancel
settled as confirmed. A worker is "launched" whenever `backend.launch` returned a handle or raised
`LaunchInFlight`; any other launch exception is the backend's statement that nothing was sent, the only
"nothing was started" this module accepts. Everything else — `TerminationPending`, `TerminationUnconfirmed`
(only the run's kill switch could be raised), a failed attempt — leaves the session unconfirmed: the reason
starts with TERMINATE FAILED or TERMINATION PENDING, the mode never becomes `terminated`, the reason makes no
"terminated" claim, and every later terminate round calls the backend again.

One terminate round per stop. A fallback (worker failure, hard timeout) terminates right where the failure is
seen and nothing is launched after it, so `run()` does not repeat that round on its way out: the time a session
needs to end after a stop request is the step in flight plus ONE round (service.WORST_CASE_STOP_S).

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
# A stop whose only action was raising the run-level kill switch (there is no call to cancel). Never "terminated".
KILL_SWITCH_ONLY = "kill switch raised, stop not confirmed"
STOPPING = "Stop requested; terminating workers — not confirmed yet"
TERMINATE_BACKOFF_S = (0.5, 1.0, 2.0, 4.0)
MAX_TRANSIENT_POLLS = 2   # consecutive transient poll errors tolerated (inside the hard timeout) before failing


class TransientBackendError(Exception):
    """A backend call failed in a way that may succeed on retry (e.g. a client-side call timeout)."""


class LaunchInFlight(Exception):
    """backend.launch did not complete normally but MAY have started a worker: the call is still in flight
    (the backend cancels the late call the moment it returns) or it failed client-side after it was sent.
    `handle` must be terminated like any launched worker; `status` is the worker error shown to the operator
    (`{}` in the template is replaced by the message)."""

    def __init__(self, message: str, handle: Any,
                 status: str = "launch did not complete in time ({}); if the call still arrives it is cancelled at once"):
        super().__init__(message)
        self.handle = handle
        self.status = status.format(message)


class TerminationPending(Exception):
    """backend.terminate cannot confirm yet (e.g. the launch is still in flight) but has queued the cancel.
    `subscribe(cb)` registers cb(confirmed: bool, error: str | None), called exactly once when settled."""

    def __init__(self, message: str, subscribe: Callable[[Callable[[bool, str | None], None]], None]):
        super().__init__(message)
        self.subscribe = subscribe


class TerminationUnconfirmed(Exception):
    """backend.terminate did all it can and still cannot confirm the stop, and trying again at once would not
    change that: there is no call to cancel and only the run-level kill switch was raised (a worker that
    started stops only if it reads the switch). Never reported as terminated and not retried within the
    round; every later terminate round calls the backend again. The message is shown to the operator."""


@dataclass(frozen=True)
class Checkpoint:
    tube: str
    sim_time_raw: float
    ref: str


class WorkerBackend(Protocol):
    def launch(self, tube: str, gpu_index: int, checkpoint: Checkpoint | None) -> Any:
        """-> handle. Raise `LaunchInFlight(handle)` whenever a worker MAY exist although the launch did not
        complete normally; any other exception states that nothing was sent (nothing to terminate)."""
        ...

    def poll(self, handle: Any) -> dict:
        """-> {device_id, state, sim_time_raw, new_samples_raw: [[t, Q], ...], error}
        optional: checkpoint {ref, sim_time_raw}, wall_start, wall_end (epoch s), solver_revision."""
        ...

    def terminate(self, handle: Any) -> None:
        """Return ONLY when the stop is confirmed. Otherwise raise `TerminationPending` (queued; settles
        later), `TerminationUnconfirmed` (nothing more can be done now) or any other exception (the attempt
        failed; retried with backoff). Called again by every later terminate round until it returns."""
        ...


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
    terminate_attempted: bool = False   # a terminate round has already called the backend for this worker
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
                 terminate_backoff_s: tuple[float, ...] | None = None):
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
        self.terminate_backoff_s = tuple(TERMINATE_BACKOFF_S if terminate_backoff_s is None else terminate_backoff_s)
        checkpoints = checkpoints or {}
        self.workers = [WorkerRecord(g, t, resume_from=checkpoints.get(t)) for g, t in TUBES]
        self.mode = "idle"
        self._reason = "Ready: nothing is launched until an explicit, budget-approved launch."
        self._terminated_tail = ""  # the "... terminated" claim of a fallback reason: shown only while it is true
        self._terminate_failure: str | None = None
        self.fallback_label = ""
        self.started_at: float | None = None
        self.ended_at: float | None = None
        self._lock = threading.RLock()
        self._settle = threading.Condition(self._lock)  # notified whenever a termination settles (either way)
        self._term_lock = threading.Lock()
        self._stop_requested = False  # plain flag, no lock: request_stop() may run inside a signal handler
        self.terminate_rounds = 0     # terminate rounds that called the backend (the service runs one per stop)

    def _open(self) -> list[WorkerRecord]:
        """Launched workers whose termination is not confirmed (call with the lock held)."""
        return [r for r in self.workers if r.launched and not r.terminated]

    @property
    def reason(self) -> str:
        with self._lock:
            open_ = self._open()
            # a fallback reason claims "... terminated" only while every launched worker's termination is confirmed
            base = self._reason + (self._terminated_tail if not open_ else "." if self._terminated_tail else "")
            if self._terminate_failure:
                pending_only = all(r.terminate_pending for r in open_ if r.terminate_error)
                return f"{TERMINATE_PENDING if pending_only else TERMINATE_FAILED}: {self._terminate_failure}. {base}"
            if self._stop_requested and open_ and self.mode in ("launching", "live"):
                return f"{STOPPING}. {base}"
            return base

    @property
    def termination_confirmed(self) -> bool:
        with self._lock:
            return not self._open()

    @property
    def termination_pending(self) -> bool:
        """A cancel is queued with the backend and has not settled yet (the only thing worth waiting for)."""
        with self._lock:
            return any(r.terminate_pending for r in self._open())

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
                self._fail(rec, e.status)
                break
            except Exception as e:  # noqa: BLE001 - any other launch failure: the backend sent nothing (see WorkerBackend)
                self._fail(rec, f"launch failed: {type(e).__name__}: {e}")
                break
            with self._lock:
                rec.handle, rec.launched = handle, True
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
                    self._fallback(f"Hard timeout reached: {self.hard_timeout_s:g} s elapsed before both workers finished",
                                   "; workers terminated.", cause="timeout")
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
            # ONE round per stop: workers that a fallback already tried to terminate are not tried again here
            # (the caller's next terminate retries them); every other launched worker gets its round now.
            if self.terminate_all(retry=False) and self.mode in ("launching", "live"):
                self._end(*(end or ("terminated", "Session ended abnormally; workers terminated.")))
            if on_snapshot:
                on_snapshot()

    def stop_and_terminate(self) -> bool:
        """Operator stop: one terminate round for everything unconfirmed; True only if every termination is
        confirmed."""
        self.request_stop()
        self.terminate_all()
        return self.confirm_stop()

    def confirm_stop(self) -> bool:
        """True once every launched worker's termination is confirmed; a session that was still launching or
        live is then (and only then) marked terminated. Calls no backend."""
        with self._lock:
            ok = not self._open()
            if ok and self.mode in ("launching", "live"):
                self._end("terminated", "Stopped on request; workers terminated.")
            return ok

    def terminate_all(self, *, retry: bool = True) -> bool:
        """One terminate round: call backend.terminate for every launched worker whose termination is not
        confirmed (also one whose cancel is queued: the backend raises the kill switch again), retrying a
        failed attempt with backoff. `retry=False` skips the workers an earlier round already tried.
        Returns True when every launched worker's termination is confirmed."""
        with self._term_lock:
            called = False
            for rec in self.workers:
                with self._lock:
                    if not rec.launched or rec.terminated or (rec.terminate_attempted and not retry):
                        continue
                    was_pending = rec.terminate_pending
                called, attempts = True, 1 + len(self.terminate_backoff_s)
                last_err, pending, final = None, None, False
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
                    except TerminationUnconfirmed as e:  # nothing more can be done now: do not hammer the backend
                        last_err, final = str(e) or "stop not confirmed", True
                        break
                    except Exception as e:  # noqa: BLE001
                        last_err = f"{type(e).__name__}: {e}"
                with self._lock:
                    rec.terminate_attempted = True
                if pending is not None:
                    with self._lock:
                        # a worker that was already pending keeps its first subscription: if that one settled while
                        # the backend was being called, its verdict stands
                        if not was_pending or rec.terminate_pending:
                            rec.terminate_pending, rec.terminate_error = True, f"termination pending: {pending}"
                    if not was_pending:
                        pending.subscribe(lambda ok, err, rec=rec: self._settled(rec, ok, err))
                    continue
                self._settled(rec, last_err is None,
                              last_err if final or last_err is None else f"terminate unconfirmed after {attempts} attempts: {last_err}")
            if called:
                self.terminate_rounds += 1
            return self._refresh_confirmation()

    def wait_terminated(self, timeout_s: float) -> bool:
        """Block while a queued cancel is pending, at most `timeout_s`, and return whether every launched
        worker's termination is confirmed. Returns at once when nothing is pending: a termination that failed
        is not going to confirm itself by being waited for."""
        deadline = time.monotonic() + max(0.0, timeout_s)
        with self._settle:
            while any(r.terminate_pending for r in self._open()):
                left = deadline - time.monotonic()
                if left <= 0:
                    break
                self._settle.wait(left)
            return not self._open()

    def _settled(self, rec: WorkerRecord, ok: bool, err: str | None) -> None:
        with self._lock:
            rec.terminate_pending = False
            if ok:
                rec.terminated, rec.terminate_error = True, None
                if rec.wall_start is not None and rec.wall_end is None:
                    rec.wall_end = self.clock()
            elif not rec.terminated:  # a confirmed stop is never taken back by a late verdict
                rec.terminate_error = err or "terminate failed"
        self._refresh_confirmation()

    def _refresh_confirmation(self) -> bool:
        with self._settle:
            failed = self._open()
            self._terminate_failure = "; ".join(f"GPU {r.gpu_index} ({r.tube}) {r.terminate_error}"
                                                for r in failed if r.terminate_error) or None
            self._settle.notify_all()
            return not failed

    # ---- internals -----------------------------------------------------
    def _end(self, mode: str, reason: str) -> None:
        with self._lock:
            if self.mode == "fallback":
                return
            self.mode, self._reason, self._terminated_tail = mode, reason, ""
            self.ended_at = self.clock()
            self._t_end = self.monotonic()

    def _fallback(self, reason: str, terminated_tail: str, cause: str = "worker") -> None:
        """Switch to the labelled fallback (first cause wins) and terminate every worker right here.
        `terminated_tail` completes the reason with its "... terminated" claim, shown only while it is true."""
        with self._lock:
            if self.mode != "fallback":
                self.mode, self._reason, self._terminated_tail = "fallback", reason, terminated_tail
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
        self._fallback(f"GPU {rec.gpu_index} ({rec.tube}) worker failed: {error}", ". Other worker terminated.")

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
