"""Qualification rehearsal (UNREHEARSED until a human runs it with Modal credentials).

    cd main && python3 -m labyrinth_main.features.live_gx.rehearse --confirm-cost-usd <estimate>

One guarded allocation of REHEARSAL_H plus two setups: phase 1 runs both tubes from initialization
and writes checkpoints; phase 2 resumes both from those checkpoints. Qualification requires both
phases to finish on two distinct devices with overlapping execution, and phase 2's clocks to
continue from the checkpoint (not from 0). The result is written to <state>/qualification.json and
the full run (converted samples, devices, intervals) to <state>/runs/<savedRunId>.json.
Run with no arguments to print the estimate without launching anything.

Exit path (same as the server's): SIGTERM is treated like Ctrl-C; while workers are being terminated
both signals are ignored; every started phase is terminated and the process waits up to
CONFIRM_WAIT_S for each termination to be CONFIRMED (including a late spawn's queued cancel). Each
phase prints "workers terminated" or "NOT confirmed terminated — check Modal dashboard" with its
reason, and the exit code is 2 whenever anything is unsettled. A spawn RPC that never returns
therefore ends in exit 2: the operator must check the Modal dashboard and stop the app there.
"""
from __future__ import annotations

import argparse
import json
import signal
import sys
import uuid
from collections.abc import Callable
from pathlib import Path

from ..budget.pricing import REHEARSAL_H
from . import budget_guard as guard
from .orchestrator import Orchestrator, WorkerBackend
from .service import WORST_CASE_STOP_S, LedgerLocked, LedgerStore, atomic_write, cost_matches, default_state_dir

CONFIRM_WAIT_S = WORST_CASE_STOP_S + 10.0


def _overlap(p: Orchestrator) -> bool:
    """Overlap on ONE clock: the workers' own reported intervals when all four ends are reported,
    otherwise the orchestrator's local observations — never a mix of the two."""
    remote = p.remote_intervals()
    iv = remote if all(None not in v for v in remote.values()) else p.intervals()
    (a0, a1), (b0, b1) = iv["bean"], iv["triangular"]
    return None not in (a0, a1, b0, b1) and max(a0, b0) < min(a1, b1)


def run_rehearsal(backend_factory: Callable[[str, int], WorkerBackend], *, state_dir: Path, confirm_cost_usd,
                  poll_interval_s: float = 2.0, phase_timeout_s: float | None = None,
                  started: list[Orchestrator] | None = None) -> tuple[bool, dict]:
    """`phase_timeout_s` may only SHORTEN the guard's per-phase hard timeout (tests run on a scaled clock).
    Every phase orchestrator is appended to `started` BEFORE it runs, so the caller can terminate it
    (and wait for confirmation) even if this function is interrupted."""
    started = [] if started is None else started
    store = LedgerStore(state_dir / "ledger.json")
    try:
        with store.locked():
            ledger = store.load()
            decision = guard.evaluate(ledger, slot_min=REHEARSAL_H * 60.0, setups=guard.REHEARSAL_SETUPS)
            if not decision.approved:
                return False, {"reason": decision.reason}
            if not cost_matches(confirm_cost_usd, decision.slot_estimate_usd):
                return False, {"reason": f"--confirm-cost-usd must equal the rehearsal estimate ${decision.slot_estimate_usd:.2f}."}
            store.save(ledger.reserve(decision.slot_estimate_usd))
    except LedgerLocked as e:
        return False, {"reason": str(e)}
    run_id = f"rehearsal-{uuid.uuid4().hex[:12]}"
    phase_timeout: float = int(decision.hard_timeout_s * guard.PHASE_FRACTION)
    if phase_timeout_s is not None:
        phase_timeout = min(phase_timeout, phase_timeout_s)

    phases = []
    p1 = Orchestrator(backend_factory(f"{run_id}-init", phase_timeout), hard_timeout_s=phase_timeout, kind="rehearsal")
    started.append(p1)
    p1.run(poll_interval_s)
    phases.append(p1)
    ckpts = p1.latest_checkpoints()
    init_ok = p1.mode == "terminated" and all(w.state == "done" for w in p1.workers) and set(ckpts) == {"bean", "triangular"}
    cont_ok = False
    if init_ok and not p1.termination_confirmed:  # never start phase 2 while phase-1 GPUs may still be billing
        init_ok = p1.wait_terminated(CONFIRM_WAIT_S)
    if init_ok:
        p2 = Orchestrator(backend_factory(f"{run_id}-cont", phase_timeout), hard_timeout_s=phase_timeout, kind="rehearsal",
                          checkpoints=ckpts)
        started.append(p2)
        p2.run(poll_interval_s)
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


def _interrupt(signum, frame):  # SIGTERM -> same clean path as Ctrl-C
    raise KeyboardInterrupt(f"signal {signum}")


def terminate_phases(started: list[Orchestrator], confirm_wait_s: float) -> bool:
    """Terminate every started phase and wait for confirmation; print one loud line per phase."""
    confirmed_all = True
    for i, p in enumerate(started, 1):
        ok = p.stop_and_terminate() or p.wait_terminated(confirm_wait_s)
        if ok:
            ok = p.stop_and_terminate()
        confirmed_all &= ok
        verdict = "workers terminated" if ok else "NOT confirmed terminated — check Modal dashboard"
        line = f"phase {i}: {verdict}. {p.reason}"
        print(line, flush=True)
        if not ok:
            print(line, flush=True, file=sys.stderr)
    return confirmed_all


def main(argv: list[str] | None = None, *, availability_check: Callable[[], tuple[bool, str]] | None = None,
         backend_factory: Callable[[str, int], WorkerBackend] | None = None) -> int:
    """The keyword hooks are for tests only; the command line cannot set them."""
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--confirm-cost-usd", type=float, default=None)
    args = ap.parse_args(argv)
    state_dir = default_state_dir()
    decision = guard.evaluate(LedgerStore(state_dir / "ledger.json").load(), slot_min=REHEARSAL_H * 60.0,
                              setups=guard.REHEARSAL_SETUPS)
    print(f"Rehearsal estimate ${decision.slot_estimate_usd:.2f}, hard timeout {decision.hard_timeout_s} s. {decision.reason}",
          flush=True)
    if args.confirm_cost_usd is None:
        print("Nothing launched. Re-run with --confirm-cost-usd to launch.")
        return 0
    from .modal_backend import ModalBackend, availability

    ok, why = (availability_check or availability)()
    if not ok:
        print(why, file=sys.stderr)
        return 2
    factory = backend_factory or (lambda rid, t: ModalBackend(run_id=rid, hard_timeout_s=t, kind="rehearsal"))
    started: list[Orchestrator] = []
    passed, record, interrupted = False, None, False
    previous_term = signal.signal(signal.SIGTERM, _interrupt)
    try:
        passed, record = run_rehearsal(factory, state_dir=state_dir, confirm_cost_usd=args.confirm_cost_usd, started=started)
    except KeyboardInterrupt:
        interrupted = True
    finally:
        previous_int = signal.signal(signal.SIGINT, signal.SIG_IGN)  # nothing may interrupt the termination
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        try:
            confirmed = terminate_phases(started, CONFIRM_WAIT_S)
        finally:
            signal.signal(signal.SIGINT, previous_int)
            signal.signal(signal.SIGTERM, previous_term)
    if record is not None:
        print(json.dumps({k: v for k, v in record.items() if k != "phases"}, indent=2), flush=True)
    if interrupted:
        print("Rehearsal interrupted; nothing qualified.", flush=True)
    print("Rehearsal " + ("PASSED" if passed and confirmed and not interrupted else "did NOT pass")
          + ("; workers terminated." if confirmed else "; workers NOT confirmed terminated — check Modal dashboard."),
          flush=True)
    return 0 if passed and confirmed and not interrupted else 2


if __name__ == "__main__":
    sys.exit(main())
