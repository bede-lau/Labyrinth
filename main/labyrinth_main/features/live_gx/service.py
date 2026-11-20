"""Live GX service: status, guarded launch, terminate and shutdown, used by the HTTP server.

State lives outside the repo in LABYRINTH_STATE_DIR (default ~/.labyrinth):
  ledger.json         {"billedUsd", "pendingUsd", "reconciled"} — written by a human after checking
                      Modal's usage page; each approved reservation is added to pendingUsd and marks it
                      unreconciled again (reconcile before EACH allocation). Read-check-reserve runs
                      under an O_EXCL lock file so two processes cannot both pass the guard.
  qualification.json  written by `rehearse` after a rehearsal verified initialization and checkpoint
                      continuation; valid only if the saved run it names exists and passes checks.
  runs/<id>.json      the saved rehearsal run the fallback plays (served at /api/live/runs/<id>).

Without credentials or the `modal` package the mode is `unavailable` and nothing touches the network.

Operator note — hung spawn RPC: if Modal never answers a `Function.spawn`, the worker may or may not
exist. Labyrinth never reports such a session as terminated: status reads "TERMINATION PENDING" (or
"TERMINATE FAILED"), /api/live/terminate answers 502, and on shutdown the server (and the `rehearse` CLI)
waits up to WORST_CASE_STOP_S + 10 s, then exits with code 2 printing "NOT confirmed terminated — check
Modal". In that case open the Modal dashboard, stop any running `labyrinth-gx` function calls, and
record what was billed in ledger.json before the next allocation.
"""
from __future__ import annotations

import json
import math
import os
import re
import tempfile
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path

from ...common.paths import CONTRACTS
from ..budget.pricing import POSTED_USD
from . import budget_guard as guard
from .modal_backend import CALL_TIMEOUT_S, availability
from .orchestrator import NO_REHEARSAL_LABEL, TERMINATE_BACKOFF_S, Orchestrator, WorkerBackend

BackendFactory = Callable[[str, int], WorkerBackend]  # (run_id, hard_timeout_s) -> backend
RUN_ID = re.compile(r"^(rehearsal|live)-[0-9a-f]{12}$")
LOCK_TIMEOUT_S = 5.0
# Worst case for a session thread to notice a stop: one in-flight launch (lookup + spawn, each bounded by
# CALL_TIMEOUT_S; launch() checks for stop before the next spawn) plus terminate retries of both workers.
WORST_CASE_STOP_S = 2 * CALL_TIMEOUT_S + 2 * (sum(TERMINATE_BACKOFF_S) + (1 + len(TERMINATE_BACKOFF_S)) * CALL_TIMEOUT_S)
RUN_KEYS = {"savedRunId", "initVerified", "continuationVerified", "checks", "phases"}


def default_state_dir() -> Path:
    return Path(os.environ.get("LABYRINTH_STATE_DIR") or Path.home() / ".labyrinth")


class LedgerLocked(RuntimeError):
    pass


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


class LedgerStore:
    def __init__(self, path: Path):
        self.path = path
        self.lock_path = path.with_name(path.name + ".lock")

    def load(self) -> guard.Ledger:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            return guard.Ledger(billed=raw["billedUsd"], pending=raw["pendingUsd"], reconciled=raw["reconciled"] is True)
        except FileNotFoundError:
            # Nothing recorded: the PRD's provisionally posted $8.10 is pending and unreconciled.
            return guard.Ledger(billed=0.0, pending=POSTED_USD, reconciled=False)
        except (OSError, ValueError, KeyError, TypeError):
            return guard.Ledger(billed=float("nan"), pending=float("nan"), reconciled=False)

    def save(self, ledger: guard.Ledger) -> None:
        atomic_write(self.path, json.dumps({"billedUsd": ledger.billed, "pendingUsd": ledger.pending,
                                            "reconciled": ledger.reconciled}, indent=2) + "\n")

    @contextmanager
    def locked(self, timeout_s: float = LOCK_TIMEOUT_S) -> Iterator[None]:
        """Cross-process exclusive section (O_CREAT|O_EXCL lock file). A stale lock is never broken
        automatically: refusing to spend is the safe failure."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        deadline = time.monotonic() + timeout_s
        while True:
            try:
                fd = os.open(self.lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                break
            except FileExistsError:
                if time.monotonic() >= deadline:
                    raise LedgerLocked(f"ledger is locked by another process ({self.lock_path}); "
                                       "remove the lock file only if no other Labyrinth process is running") from None
                time.sleep(0.05)
        try:
            os.write(fd, f"{os.getpid()}\n".encode())
            os.close(fd)
            yield
        finally:
            self.lock_path.unlink(missing_ok=True)


@lru_cache(maxsize=1)
def _run_validator():
    from jsonschema import Draft202012Validator
    from referencing import Registry, Resource

    resources = []
    for p in CONTRACTS.glob("*.schema.json"):
        schema = json.loads(p.read_text(encoding="utf-8"))
        res = Resource.from_contents(schema)
        resources += [(p.name, res), (schema["$id"], res)]
    schema = json.loads((CONTRACTS / "live-run.schema.json").read_text(encoding="utf-8"))
    return Draft202012Validator(schema, registry=Registry().with_resources(resources))


def load_saved_run(state_dir: Path, run_id) -> dict | None:
    """A qualifying saved rehearsal run, or None. Requires: a well-formed id naming an existing file; the
    whole record valid against contracts/live-run.schema.json; exactly the contract's keys (nothing
    extra); every check true; exactly two phases (initialization + continuation)."""
    if not isinstance(run_id, str) or not RUN_ID.match(run_id):
        return None
    try:
        rec = json.loads((state_dir / "runs" / f"{run_id}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if next(_run_validator().iter_errors(rec), None) is not None:
        return None
    if not (set(rec) == RUN_KEYS and rec["savedRunId"] == run_id and rec["initVerified"] is True
            and rec["continuationVerified"] is True and all(v is True for v in rec["checks"].values())
            and len(rec["phases"]) == 2):
        return None
    return rec


def load_qualification(state_dir: Path) -> dict | None:
    try:
        q = json.loads((state_dir / "qualification.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    ok = isinstance(q, dict) and q.get("initVerified") is True and q.get("continuationVerified") is True \
        and load_saved_run(state_dir, q.get("savedRunId")) is not None
    return q if ok else None


def cost_matches(confirm, estimate: float) -> bool:
    if isinstance(confirm, bool) or not isinstance(confirm, (int, float)) or not math.isfinite(confirm):
        return False
    return round(confirm * 100) == round(estimate * 100)


def _default_backend_factory(run_id: str, hard_timeout_s: int) -> WorkerBackend:
    from .modal_backend import ModalBackend

    return ModalBackend(run_id=run_id, hard_timeout_s=hard_timeout_s, kind="live")


class LiveService:
    def __init__(self, *, state_dir: Path | None = None, availability_check: Callable[[], tuple[bool, str]] = availability,
                 backend_factory: BackendFactory = _default_backend_factory, poll_interval_s: float = 2.0,
                 join_timeout_s: float = WORST_CASE_STOP_S + 10.0, confirm_wait_s: float = 5.0):
        self.state_dir = state_dir or default_state_dir()
        self.ledger = LedgerStore(self.state_dir / "ledger.json")
        self.availability_check = availability_check
        self.backend_factory = backend_factory
        self.poll_interval_s = poll_interval_s
        self.join_timeout_s = join_timeout_s
        self.confirm_wait_s = confirm_wait_s
        self._closed = False
        self._lock = threading.Lock()
        self._run: Orchestrator | None = None
        self._thread: threading.Thread | None = None

    def decision(self) -> guard.GuardDecision:
        return guard.evaluate(self.ledger.load())

    def saved_run(self, run_id) -> dict | None:
        return load_saved_run(self.state_dir, run_id)

    def _gate(self) -> tuple[str, str, dict | None]:
        """-> (mode, reason, qualification) for when no session is running."""
        ok, why = self.availability_check()
        qual = load_qualification(self.state_dir)
        if not ok:
            return "unavailable", why + " Live GX is UNREHEARSED (D-011).", qual
        if qual is None:
            return "unavailable", ("Not qualified: no recorded GX rehearsal has verified initialization and checkpoint "
                                   "continuation. Run `python3 -m labyrinth_main.features.live_gx.rehearse`."), None
        return "idle", "Qualified. Launch requires explicit confirmation of the slot cost.", qual

    def _busy(self) -> bool:
        """A session counts as running while its thread lives, its mode is active, or any worker's
        termination is unconfirmed (GPUs may still be billing)."""
        run, thread = self._run, self._thread
        return run is not None and ((thread is not None and thread.is_alive()) or run.mode in ("launching", "live")
                                    or not run.termination_confirmed)

    def status(self) -> dict:
        decision = self.decision()
        qual = load_qualification(self.state_dir)
        with self._lock:
            run, busy = self._run, self._busy()
        if run is not None and (busy or run.mode == "fallback"):
            return run.snapshot(decision.budget_snapshot(), qualified=qual is not None)
        mode, reason, qual = self._gate()
        if run is not None:  # a finished, cleanly terminated session: back to the gate (idle when allowed)
            reason = f"Last session ended: {run.reason} " + reason
        if mode == "idle" and not decision.approved:
            reason += " " + decision.reason
        saved = qual["savedRunId"] if qual else None
        if mode == "unavailable":
            label = f"Live GX unavailable — playing saved GX run {saved}" if saved else NO_REHEARSAL_LABEL
            fallback = {"active": True, "label": label, "savedRunId": saved}
        else:
            fallback = {"active": False, "label": "", "savedRunId": saved}
        return {
            "schemaVersion": 1,
            "mode": mode,
            "reason": reason,
            "qualified": qual is not None,
            "budget": decision.budget_snapshot(),
            "workers": [],
            "fallback": fallback,
        }

    def launch(self, confirm_cost_usd) -> tuple[bool, str]:
        """-> (accepted, reason). Never launches unless available, qualified, guard-approved and cost-confirmed."""
        with self._lock:
            if self._closed:
                return False, "The server is shutting down; no new sessions."
            if self._busy():
                return False, "A session is still running (or its termination is unconfirmed)."
            mode, reason, qual = self._gate()
            if mode != "idle":
                return False, reason
            try:
                with self.ledger.locked():
                    ledger = self.ledger.load()
                    decision = guard.evaluate(ledger)
                    if not decision.approved:
                        return False, decision.reason
                    if not cost_matches(confirm_cost_usd, decision.slot_estimate_usd):
                        return False, (f"confirmCostUsd must equal the current slot estimate ${decision.slot_estimate_usd:.2f} "
                                       f"(got {confirm_cost_usd!r}).")
                    self.ledger.save(ledger.reserve(decision.slot_estimate_usd))
            except LedgerLocked as e:
                return False, str(e)
            run_id = f"live-{uuid.uuid4().hex[:12]}"
            backend = self.backend_factory(run_id, decision.hard_timeout_s)
            self._run = Orchestrator(backend, hard_timeout_s=decision.hard_timeout_s, saved_run_id=qual["savedRunId"])
            self._thread = threading.Thread(target=self._run.run, kwargs={"poll_interval_s": self.poll_interval_s},
                                            name=run_id, daemon=True)
            self._thread.start()
            return True, f"Launched {run_id}; ${decision.slot_estimate_usd:.2f} reserved as pending."

    def terminate(self, *, confirm_wait_s: float | None = None) -> tuple[bool, str]:
        """Stop and terminate. -> (confirmed, message). Safe to call repeatedly (retries unconfirmed
        terminations). Waits for the session thread up to the worst-case stop time and for queued cancels
        (e.g. a late spawn) up to `confirm_wait_s`; anything still unsettled is reported unconfirmed."""
        with self._lock:
            run, thread = self._run, self._thread
        if run is None:
            return True, "Nothing running."
        run.request_stop()
        if thread is not None:
            thread.join(timeout=self.join_timeout_s)
        confirmed = run.stop_and_terminate()
        if not confirmed and run.wait_terminated(self.confirm_wait_s if confirm_wait_s is None else confirm_wait_s):
            confirmed = run.stop_and_terminate()
        if thread is not None and thread.is_alive():
            return False, (f"Session thread still running after {self.join_timeout_s:.0f} s; termination unconfirmed. "
                           + run.reason)
        return (True, "Workers terminated.") if confirmed else (False, run.reason)

    def shutdown(self) -> bool:
        """Process exit path (SIGINT/SIGTERM/server shutdown): refuse new launches, never leave GPU workers
        running, and wait up to the worst-case stop time for queued cancels to be confirmed."""
        with self._lock:
            self._closed = True
        return self.terminate(confirm_wait_s=self.join_timeout_s)[0]
