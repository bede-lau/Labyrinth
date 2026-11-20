"""TEST-ONLY deterministic worker backend. SIMULATION — never produces GX results.

Used by main/tests to exercise the orchestrator, the rehearsal procedure and the server's launch
path without Modal. The server never selects it: there is no environment flag or CLI option that
enables it. Device IDs are prefixed `FAKE-` so a leaked snapshot cannot be mistaken for a GPU.

Each launched worker is a real thread so concurrency (overlapping wall-clock intervals) is real.
Flux values are a fixed formula, not physics.

Restart files are modelled like GX's: written every `ckpt_every` steps, so the checkpoint time is
usually EARLIER than the last flux sample. `restart_store` maps checkpoint ref -> the time actually
stored in that "file"; a resumed worker starts from that time, whatever the checkpoint report claimed.
`misreport_checkpoint_time=True` reports the last sample time instead of the file's time (the bug the
real worker avoids by reading the time from the restart netCDF itself).
`startup_s` models container cold start (state stays `initializing`); `run_for_s` models the worker's own
execution deadline counted from ITS start (GX stopped, last restart kept, state `done`), like modal_app.

The pair runs concurrently by construction, as two GPU containers do: a worker that reaches its last step does
not finish before its sibling has started (at most SIBLING_WAIT_S), and every report carries the worker's own
execution interval. So the rehearsal's overlap check never depends on how a loaded test machine schedules a
few short threads; a test that wants workers that do NOT overlap reports their intervals explicitly.
"""
from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass, field

from .orchestrator import TUBES, Checkpoint

SIBLING_WAIT_S = 2.0  # a worker launched alone (its sibling's launch failed or was stopped) finishes after this


@dataclass
class FakeWorker:
    tube: str
    gpu_index: int
    checkpoint: Checkpoint | None
    steps: int
    dt_raw: float
    step_wall_s: float
    fail_at_step: int | None
    device_id: str
    state: str = "initializing"
    sim_time_raw: float = 0.0
    samples_raw: list[list[float]] = field(default_factory=list)
    cursor: int = 0
    error: str | None = None
    ckpt: dict | None = None
    thread_start: float | None = None
    thread_end: float | None = None
    terminate_calls: int = 0
    stop: threading.Event = field(default_factory=threading.Event)
    lock: threading.Lock = field(default_factory=threading.Lock)
    thread: threading.Thread | None = None


def fake_q_raw(tube: str, t_raw: float) -> float:
    base = 6.34 if tube == "bean" else 6.28
    return base * (1.0 + 0.05 * math.sin(t_raw / 37.0))


class FakeBackend:
    def __init__(self, *, steps: int = 5, dt_raw: float = 10.0, step_wall_s: float = 0.02,
                 fail: dict[str, int] | None = None, fail_launch: set[str] | None = None,
                 ignore_checkpoint: bool = False, ckpt_every: int = 2, misreport_checkpoint_time: bool = False,
                 restart_store: dict[str, float] | None = None, events: list | None = None,
                 startup_s: float = 0.0, run_for_s: float | None = None):
        self.steps, self.dt_raw, self.step_wall_s = steps, dt_raw, step_wall_s
        self.fail = fail or {}
        self.fail_launch = fail_launch or set()
        self.ignore_checkpoint = ignore_checkpoint
        self.ckpt_every = ckpt_every
        self.misreport_checkpoint_time = misreport_checkpoint_time
        self.restart_store = {} if restart_store is None else restart_store
        self.events = [] if events is None else events
        self.startup_s, self.run_for_s = startup_s, run_for_s
        self.workers: list[FakeWorker] = []
        self.launch_calls: list[tuple[str, int, Checkpoint | None]] = []
        self._running = threading.Condition()  # counts workers that started executing; notified on start and stop
        self._started = 0

    def launch(self, tube: str, gpu_index: int, checkpoint: Checkpoint | None) -> FakeWorker:
        self.launch_calls.append((tube, gpu_index, checkpoint))
        self.events.append(("launch", tube))
        if tube in self.fail_launch:
            raise RuntimeError(f"simulated launch failure for {tube}")
        w = FakeWorker(tube, gpu_index, checkpoint, self.steps, self.dt_raw, self.step_wall_s, self.fail.get(tube),
                       device_id=f"FAKE-GPU-{gpu_index}-{tube}-{len(self.workers)}")
        if checkpoint is not None and not self.ignore_checkpoint:
            w.sim_time_raw = self.restart_store.get(checkpoint.ref, checkpoint.sim_time_raw)
        self.workers.append(w)
        w.thread = threading.Thread(target=self._work, args=(w,), daemon=True)
        w.thread.start()
        return w

    def _work(self, w: FakeWorker) -> None:
        if self.startup_s and w.stop.wait(self.startup_s):
            return
        w.thread_start = time.monotonic()  # the fake's own clock: this machine's wall clock can step back (seen: 0.56 s)
        with w.lock:
            w.state = "running"
        with self._running:
            self._started += 1
            self._running.notify_all()
        restart_t = None
        for step in range(1, w.steps + 1):
            if self.run_for_s is not None and time.monotonic() - w.thread_start >= self.run_for_s:
                break  # the worker's own deadline: stop and keep the last complete restart
            if w.stop.wait(w.step_wall_s):
                break
            with w.lock:
                if w.fail_at_step is not None and step >= w.fail_at_step:
                    w.state, w.error = "failed", f"simulated GX crash on {w.tube} at step {step}"
                    break
                w.sim_time_raw += w.dt_raw
                w.samples_raw.append([w.sim_time_raw, fake_q_raw(w.tube, w.sim_time_raw)])
                if self.ckpt_every and step % self.ckpt_every == 0:
                    restart_t = w.sim_time_raw
        if w.state == "running":  # about to finish: not before the sibling has started (the pair overlaps)
            with self._running:
                self._running.wait_for(lambda: self._started >= len(TUBES) or w.stop.is_set(), timeout=SIBLING_WAIT_S)
        with w.lock:
            if w.state == "running" and not w.stop.is_set():
                if restart_t is not None:
                    ref = f"fake-ckpt/{w.device_id}.restart.nc"
                    self.restart_store[ref] = restart_t
                    reported = w.sim_time_raw if self.misreport_checkpoint_time else restart_t
                    w.ckpt = {"ref": ref, "sim_time_raw": reported}
                w.state = "done"
            w.thread_end = time.monotonic()  # under the lock: a report that says "done" always carries its end

    def poll(self, w: FakeWorker) -> dict:
        """Like modal_app's worker, the report carries the worker's own execution interval (wall_start, and
        wall_end once it is done — on the fake's monotonic clock, consistent between the two workers): overlap
        is then judged on the workers' clock, not on when the orchestrator happened to poll (which a loaded
        machine can delay past a short fake run) nor on a wall clock that can step back."""
        self.events.append(("poll", w.tube))
        with w.lock:
            new = [list(p) for p in w.samples_raw[w.cursor:]]
            w.cursor = len(w.samples_raw)
            return {"device_id": w.device_id, "state": w.state, "sim_time_raw": w.sim_time_raw,
                    "new_samples_raw": new, "error": w.error, "checkpoint": w.ckpt if w.state == "done" else None,
                    "wall_start": w.thread_start, "wall_end": w.thread_end if w.state == "done" else None,
                    "solver_revision": "FAKE (test simulation, not GX)"}

    def terminate(self, w: FakeWorker) -> None:
        self.events.append(("terminate", w.tube))
        w.terminate_calls += 1
        w.stop.set()
        with self._running:
            self._running.notify_all()
        if w.thread is not None:
            w.thread.join(timeout=5)
