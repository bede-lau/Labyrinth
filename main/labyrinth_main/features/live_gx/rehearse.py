"""Qualification rehearsal (UNREHEARSED until a human runs it with Modal credentials).

    cd main && python3 -m labyrinth_main.features.live_gx.rehearse --confirm-cost-usd <estimate>

One guarded allocation of REHEARSAL_H plus two setups: phase 1 runs both tubes from initialization
and writes checkpoints; phase 2 resumes both from those checkpoints. Qualification requires both
phases to finish on two distinct devices with overlapping execution, and phase 2's clocks to
continue from the checkpoint (not from 0). The result is written to <state>/qualification.json and
the full run (converted samples, devices, intervals) to <state>/runs/<savedRunId>.json.
Run with no arguments to print the estimate without launching anything.

Exit path. SIGINT (Ctrl-C), SIGTERM and SIGHUP request a COOPERATIVE stop: the handler only sets flags and
never raises. (The phases run on the main thread; an exception raised there while a spawn RPC is in flight
would drop that spawn's handle and exit with a GPU call nobody can cancel.) The backend call in flight ends
within its own bound, nothing further is reserved or spawned, and every started phase is terminated. While
workers are being terminated — and, for the command line, until the process has exited — a further signal
has no effect beyond that stop request: the handler stays installed, so a late signal can neither cut the
termination short nor turn the exit code into "killed by a signal". A phase whose termination is not confirmed
is announced at once ("termination not confirmed yet — check the Modal dashboard now"), BEFORE anything is
waited for, and the process then waits only while a cancel is queued (a late spawn), at most CONFIRM_WAIT_S;
a cancel that failed hard is not slept on. Each phase finally prints "workers terminated" (or "nothing was
launched") or "NOT confirmed terminated — check Modal dashboard" with its reason, and the exit code is 2
whenever the rehearsal did not pass or anything is unsettled. "Terminated" means a cancel of the spawned call
succeeded (modal_backend): a spawn that failed client-side reads "kill switch raised, stop not confirmed" and
ends in exit 2, like a spawn RPC that never returns — the operator must check the Modal dashboard and stop the
app there. A signal that was ignored when the process started (nohup, a shell's background job) stays ignored.
Output never breaks the exit path: a closed pipe or a dead terminal is silenced, not raised.
"""
from __future__ import annotations

import argparse
import json
import signal
import sys
import traceback
import uuid
from collections.abc import Callable
from pathlib import Path

from ..budget.pricing import REHEARSAL_H
from . import budget_guard as guard
from .orchestrator import Orchestrator, WorkerBackend
from .service import WORST_CASE_STOP_S, LedgerLocked, LedgerStore, atomic_write, cost_matches, default_state_dir, say

CONFIRM_WAIT_S = WORST_CASE_STOP_S + 10.0
STOP_SIGNALS = tuple(getattr(signal, name) for name in ("SIGINT", "SIGTERM", "SIGHUP") if hasattr(signal, name))


class StopRequest:
    """A stop flag that a signal handler may set: a plain attribute store, no lock. (threading.Event.set()
    takes a non-reentrant lock, so a second signal arriving inside the handler could deadlock the process.)"""

    def __init__(self) -> None:
        self.requested = False

    def set(self) -> None:
        self.requested = True

    def is_set(self) -> bool:
        return self.requested


def _overlap(p: Orchestrator) -> bool:
    """Overlap on ONE clock: the workers' own reported intervals when all four ends are reported,
    otherwise the orchestrator's local observations — never a mix of the two."""
    remote = p.remote_intervals()
    iv = remote if all(None not in v for v in remote.values()) else p.intervals()
    (a0, a1), (b0, b1) = iv["bean"], iv["triangular"]
    return None not in (a0, a1, b0, b1) and max(a0, b0) < min(a1, b1)


def run_rehearsal(backend_factory: Callable[[str, int], WorkerBackend], *, state_dir: Path, confirm_cost_usd,
                  poll_interval_s: float = 2.0, phase_timeout_s: float | None = None,
                  started: list[Orchestrator] | None = None, stop: StopRequest | None = None) -> tuple[bool, dict]:
    """`phase_timeout_s` may only SHORTEN the guard's per-phase hard timeout (tests run on a scaled clock).
    Every phase orchestrator is appended to `started` BEFORE it runs, so the caller can terminate it
    (and wait for confirmation) whatever happens in here.
    `stop` is the caller's cooperative stop request (the CLI's signal handlers set it and call
    `request_stop()` on everything in `started`): once it is set nothing is reserved, no phase is started,
    and a phase registered after the request is stopped before its first spawn."""
    started = [] if started is None else started
    stop = StopRequest() if stop is None else stop

    def run_phase(p: Orchestrator) -> Orchestrator:
        started.append(p)
        if stop.is_set():  # the request arrived before this phase was registered: the handler could not see it
            p.request_stop()
        p.run(poll_interval_s)
        return p

    store = LedgerStore(state_dir / "ledger.json")
    reserved = False
    try:
        with store.locked():
            ledger = store.load()
            decision = guard.evaluate(ledger, slot_min=REHEARSAL_H * 60.0, setups=guard.REHEARSAL_SETUPS)
            if not decision.approved:
                return False, {"reason": decision.reason}
            if not cost_matches(confirm_cost_usd, decision.slot_estimate_usd):
                return False, {"reason": f"--confirm-cost-usd must equal the rehearsal estimate ${decision.slot_estimate_usd:.2f} "
                                         "to the cent."}
            if stop.is_set():
                return False, {"reason": "Stopped before launch: nothing reserved, nothing launched."}
            store.save(ledger.reserve(decision.slot_estimate_usd))
            reserved = True
    except LedgerLocked as e:
        return False, {"reason": str(e)}
    except OSError as e:  # the reservation could not be recorded (or its lock released): never launch on it
        kept = "the reservation was written and stays pending" if reserved else "nothing reserved"
        return False, {"reason": f"The ledger could not be updated ({type(e).__name__}: {e}); {kept}, nothing launched."}
    run_id = f"rehearsal-{uuid.uuid4().hex[:12]}"
    phase_timeout: float = int(decision.hard_timeout_s * guard.PHASE_FRACTION)
    if phase_timeout_s is not None:
        phase_timeout = min(phase_timeout, phase_timeout_s)

    phases = []
    p1 = run_phase(Orchestrator(backend_factory(f"{run_id}-init", phase_timeout), hard_timeout_s=phase_timeout, kind="rehearsal"))
    phases.append(p1)
    ckpts = p1.latest_checkpoints()
    init_ok = p1.mode == "terminated" and all(w.state == "done" for w in p1.workers) and set(ckpts) == {"bean", "triangular"}
    cont_ok = False
    if init_ok and not p1.termination_confirmed:  # never start phase 2 while phase-1 GPUs may still be billing
        init_ok = p1.wait_terminated(CONFIRM_WAIT_S)
    if init_ok and not stop.is_set():  # a stop request between the phases: the continuation is never launched
        p2 = run_phase(Orchestrator(backend_factory(f"{run_id}-cont", phase_timeout), hard_timeout_s=phase_timeout,
                                    kind="rehearsal", checkpoints=ckpts))
        phases.append(p2)
        cont_ok = (p2.mode == "terminated" and all(w.state == "done" for w in p2.workers)
                   and all(w.sim_time_raw is not None and w.sim_time_raw > ckpts[w.tube].sim_time_raw for w in p2.workers)
                   and all(w.samples for w in p2.workers))  # orchestrator already rejects samples before the checkpoint
    devices_ok = all(len({w.device_id for w in p.workers if w.device_id}) == 2 for p in phases)
    overlap_ok = all(_overlap(p) for p in phases)
    budget = decision.budget_snapshot()
    record = {
        "savedRunId": run_id,
        "initVerified": bool(init_ok and devices_ok and overlap_ok),
        "continuationVerified": bool(cont_ok and devices_ok and overlap_ok),
        "checks": {"init": init_ok, "continuation": cont_ok, "distinctDevices": devices_ok, "overlap": overlap_ok},
        "phases": [p.snapshot(budget, qualified=False) for p in phases],
    }
    ok = record["initVerified"] and record["continuationVerified"]
    names = ("phase 1 (from initialization)", "phase 2 (continued from phase-1 checkpoints)")
    for name, snap in zip(names, record["phases"], strict=False):
        snap["provenance"]["verification"] = {
            "outcome": "passed" if ok else "failed",
            "details": (f"Qualification rehearsal {run_id}, {name}: " +
                        ", ".join(f"{k} {'ok' if v else 'FAILED'}" for k, v in record["checks"].items()) + "."),
        }
    atomic_write(state_dir / "runs" / f"{run_id}.json", json.dumps(record, indent=2) + "\n")
    if ok:
        atomic_write(state_dir / "qualification.json", json.dumps(
            {k: record[k] for k in ("savedRunId", "initVerified", "continuationVerified", "checks")}, indent=2) + "\n")
    return ok, record


def _say(line: str, *, to_stderr: bool = False) -> None:
    """Print, but never let a dead terminal (hangup, closed pipe) break the exit path (service.say)."""
    say(line, to_stderr=to_stderr)


def terminate_phases(started: list[Orchestrator], confirm_wait_s: float) -> bool:
    """Make sure every started phase is terminated; print one loud line per phase.

    A phase that ran has already had its terminate round (Orchestrator.run), which is not repeated here: only
    a worker no round has tried yet is terminated now. If a phase is then unconfirmed, that is said BEFORE any
    waiting, and the wait lasts only while a cancel is queued; a queued cancel that settled as failed gets one
    more round (there is a call to cancel now)."""
    confirmed_all = True
    for i, p in enumerate(started, 1):
        p.request_stop()
        p.terminate_all(retry=False)
        ok = p.confirm_stop()
        if not ok and p.termination_pending:
            for to_stderr in (False, True):
                _say(f"phase {i}: termination not confirmed yet — check the Modal dashboard now; waiting up to "
                     f"{confirm_wait_s:.0f} s for the queued cancel. {p.reason}", to_stderr=to_stderr)
            p.wait_terminated(confirm_wait_s)
            if not p.termination_pending:
                ok = p.stop_and_terminate()
        confirmed_all &= ok
        verdict = ("workers terminated" if p.launched_any else "nothing was launched") if ok else \
            "NOT confirmed terminated — check Modal dashboard"
        line = f"phase {i}: {verdict}. {p.reason}"
        _say(line)
        if not ok:
            _say(line, to_stderr=True)
    return confirmed_all


def main(argv: list[str] | None = None, *, availability_check: Callable[[], tuple[bool, str]] | None = None,
         backend_factory: Callable[[str, int], WorkerBackend] | None = None, poll_interval_s: float = 2.0,
         restore_signals: bool = True) -> int:
    """The keyword hooks are for tests only; the command line cannot set them. The command line passes
    `restore_signals=False`: its stop handlers then stay installed until the process has exited, so that a
    signal arriving after the last line was printed cannot replace exit code 0 / 2 by "killed by a signal".
    A caller that goes on running (a test) gets its previous handlers back."""
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--confirm-cost-usd", type=float, default=None)
    args = ap.parse_args(argv)
    state_dir = default_state_dir()
    decision = guard.evaluate(LedgerStore(state_dir / "ledger.json").load(), slot_min=REHEARSAL_H * 60.0,
                              setups=guard.REHEARSAL_SETUPS)
    _say(f"Rehearsal estimate ${decision.slot_estimate_usd:.2f}, hard timeout {decision.hard_timeout_s} s. {decision.reason}")
    if args.confirm_cost_usd is None:
        _say("Nothing launched. Re-run with --confirm-cost-usd to launch.")
        return 0
    from .modal_backend import ModalBackend, availability

    ok, why = (availability_check or availability)()
    if not ok:
        _say(why, to_stderr=True)
        return 2
    factory = backend_factory or (lambda rid, t: ModalBackend(run_id=rid, hard_timeout_s=t, kind="rehearsal"))
    started: list[Orchestrator] = []
    stop = StopRequest()

    def on_signal(signum, frame):  # flags only: lock-free, idempotent, never raises (see the module docstring)
        stop.set()
        for p in list(started):
            p.request_stop()

    passed, record, crash = False, None, None
    previous = {s: signal.getsignal(s) for s in STOP_SIGNALS}
    for s, old in previous.items():
        if old is not signal.SIG_IGN:  # ignored at start-up (nohup, background job): stays ignored
            signal.signal(s, on_signal)
    # The handler stays installed while the workers are terminated: it only sets flags, so a further signal can
    # neither interrupt the termination nor (unlike switching to SIG_IGN here) race with a signal already pending.
    try:
        try:
            passed, record = run_rehearsal(factory, state_dir=state_dir, confirm_cost_usd=args.confirm_cost_usd,
                                           poll_interval_s=poll_interval_s, started=started, stop=stop)
        except Exception:  # noqa: BLE001 - reported below, after the workers have been terminated
            crash = traceback.format_exc()
        finally:
            confirmed = terminate_phases(started, CONFIRM_WAIT_S)
        if crash is not None:
            _say(f"Rehearsal crashed:\n{crash}", to_stderr=True)
        if record is not None:
            _say(json.dumps({k: v for k, v in record.items() if k != "phases"}, indent=2))
        if stop.is_set() and not passed:
            _say("Rehearsal interrupted; nothing qualified.")
        qualified = passed and confirmed and crash is None
        stopped = "workers terminated." if any(p.launched_any for p in started) else "nothing was launched."
        _say("Rehearsal " + ("PASSED" if qualified else "did NOT pass")
             + (f"; {stopped}" if confirmed else "; workers NOT confirmed terminated — check Modal dashboard."))
        return 0 if qualified else 2
    finally:
        if restore_signals:
            for s, old in previous.items():
                if old is not None:
                    signal.signal(s, old)


if __name__ == "__main__":
    sys.exit(main(restore_signals=False))
