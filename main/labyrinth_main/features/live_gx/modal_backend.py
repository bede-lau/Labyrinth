"""Modal worker backend. The ONLY runtime module that imports `modal`, and only inside functions.

UNREHEARSED (D-011). Requires `modal deploy -m labyrinth_main.features.live_gx.modal_app` first;
this module looks the deployed functions up by name and never deploys or builds anything itself.

`credentials_available()` and `modal_installed()` are pure local checks (environment, a file,
importlib metadata) — no network, no `import modal`.

Every Modal client call is bounded by CALL_TIMEOUT_S on this side, so a hung API call cannot keep
the orchestrator from enforcing its hard timeout; a timed-out call raises and fails the worker.
"""
from __future__ import annotations

import importlib.util
import os
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import budget_guard as guard
from .orchestrator import Checkpoint, LaunchInFlight, TerminationPending, TransientBackendError

APP_NAME = "labyrinth-gx"
FUNCTION_NAMES = {"live": "gx_worker_live", "rehearsal": "gx_worker_rehearsal"}
PROGRESS_DICT = "labyrinth-gx-progress"
CHECKPOINT_VOLUME = "labyrinth-gx-checkpoints"
CALL_TIMEOUT_S = 20.0
CANCEL_RETRIES = 4


def credentials_available(env: dict | None = None, home: Path | None = None) -> bool:
    env = os.environ if env is None else env
    if env.get("MODAL_TOKEN_ID") and env.get("MODAL_TOKEN_SECRET"):
        return True
    home = Path.home() if home is None else home
    cfg = Path(env.get("MODAL_CONFIG_PATH") or home / ".modal.toml")
    try:
        text = cfg.read_text(encoding="utf-8")
    except OSError:
        return False
    return "token_id" in text and "token_secret" in text


def modal_installed() -> bool:
    return importlib.util.find_spec("modal") is not None


def availability() -> tuple[bool, str]:
    creds, installed = credentials_available(), modal_installed()
    if creds and installed:
        return True, "Modal credentials found and the modal package is installed."
    missing = []
    if not creds:
        missing.append("no Modal credentials (MODAL_TOKEN_ID/MODAL_TOKEN_SECRET or ~/.modal.toml)")
    if not installed:
        missing.append("the `modal` package is not installed (pip install modal==1.6.4)")
    return False, "Live GX unavailable: " + "; ".join(missing) + ". Replay only."


class CallTimeout(TransientBackendError, RuntimeError):
    """A Modal client call did not return within CALL_TIMEOUT_S (raised locally). Transient for polls;
    a spawn that times out is NOT abandoned (see ModalHandle / LaunchInFlight)."""


def bounded(fn: Callable[[], Any], what: str, timeout_s: float | None = None) -> Any:
    timeout_s = CALL_TIMEOUT_S if timeout_s is None else timeout_s
    box: dict[str, Any] = {}

    def target() -> None:
        try:
            box["value"] = fn()
        except BaseException as e:  # noqa: BLE001 - re-raised in the caller's thread
            box["error"] = e

    t = threading.Thread(target=target, name=f"modal-call:{what}", daemon=True)
    t.start()
    t.join(timeout_s)
    if t.is_alive():
        raise CallTimeout(f"{what} did not return within {timeout_s:.0f} s")
    if "error" in box:
        raise box["error"]
    return box.get("value")


def _is_function_timeout(e: BaseException, modal: Any) -> bool:
    cls = getattr(getattr(modal, "exception", None), "FunctionTimeoutError", None)
    return (isinstance(cls, type) and isinstance(e, cls)) or type(e).__name__ == "FunctionTimeoutError"


def _is_still_running(e: BaseException) -> bool:
    return isinstance(e, TimeoutError) or type(e).__name__ == "TimeoutError"


@dataclass
class ModalHandle:
    """One spawned (or still spawning) worker call. A spawn that outlives CALL_TIMEOUT_S keeps running in
    its thread; its late FunctionCall is never dropped: if a cancel was requested meanwhile it is
    cancelled the moment it arrives, and listeners learn the outcome."""
    key: str
    call: Any = None
    cursor: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)
    spawn_done: threading.Event = field(default_factory=threading.Event)
    spawn_error: BaseException | None = None
    cancel_requested: bool = False
    cancelled: bool = False
    settled: tuple[bool, str | None] | None = None
    listeners: list = field(default_factory=list)


def abort_key(run_id: str) -> str:
    """Run-level kill switch in the progress Dict; every worker of the run checks it (modal_app._aborted)."""
    return f"{run_id}/abort"


def _cancel(call: Any) -> None:
    bounded(lambda: call.cancel(terminate_containers=True), "FunctionCall.cancel")


def _settle(h: ModalHandle, ok: bool, err: str | None) -> None:
    with h.lock:
        h.settled, h.cancelled = (ok, err), h.cancelled or ok
        listeners, h.listeners = h.listeners, []
    for cb in listeners:
        cb(ok, err)


def _subscribe(h: ModalHandle, cb) -> None:
    with h.lock:
        if h.settled is None:
            h.listeners.append(cb)
            return
        ok, err = h.settled
    cb(ok, err)


def _cancel_late(h: ModalHandle) -> None:
    """Runs in the spawn thread when a late FunctionCall arrives after a cancel was requested."""
    last = None
    for attempt in range(CANCEL_RETRIES):
        try:
            _cancel(h.call)
            _settle(h, True, None)
            return
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__}: {e}"
            threading.Event().wait(0.5 * 2 ** attempt)
    _settle(h, False, f"late spawn could not be cancelled: {last}")


class ModalBackend:
    """WorkerBackend over a deployed Modal function (`live` or `rehearsal`). One spawned call per tube."""

    def __init__(self, *, run_id: str, hard_timeout_s: int, kind: str = "live"):
        self.run_id = run_id
        self.hard_timeout_s = int(hard_timeout_s)
        self.kind = kind
        self.function_name = FUNCTION_NAMES[kind]

    def launch(self, tube: str, gpu_index: int, checkpoint: Checkpoint | None) -> ModalHandle:
        planned = guard.planned_call_s(self.kind)
        if self.hard_timeout_s < planned:
            raise RuntimeError(f"refusing to launch: guard hard timeout {self.hard_timeout_s} s is shorter than the "
                               f"Modal-enforced startup + execution bound {planned} s of {self.function_name}")
        import modal

        from .gx_input import RESUME_FILE, build_inputs

        input_toml = build_inputs(restart_from={tube: RESUME_FILE} if checkpoint else None)[tube]
        h = ModalHandle(key=f"{self.run_id}/{tube}")
        fn = bounded(lambda: modal.Function.from_name(APP_NAME, self.function_name), "Function.from_name")
        kwargs = {"tube": tube, "gpu_index": gpu_index, "progress_key": h.key, "input_toml": input_toml,
                  "checkpoint_ref": checkpoint.ref if checkpoint else None,
                  "hard_timeout_s": guard.modal_timeout_s(self.kind)}  # the worker's execution budget

        def spawn() -> None:
            try:
                call = fn.spawn(**kwargs)
            except BaseException as e:  # noqa: BLE001
                with h.lock:
                    h.spawn_error, cancel_now = e, h.cancel_requested
                    h.spawn_done.set()
                if cancel_now:
                    _settle(h, True, None)  # spawn failed: nothing was started
                return
            with h.lock:
                h.call, cancel_now = call, h.cancel_requested
                h.spawn_done.set()
            if cancel_now:
                _cancel_late(h)

        threading.Thread(target=spawn, name=f"modal-spawn:{h.key}", daemon=True).start()
        if not h.spawn_done.wait(CALL_TIMEOUT_S):
            raise LaunchInFlight(f"Function.spawn did not return within {CALL_TIMEOUT_S:.0f} s", h)
        if h.spawn_error is not None:
            raise h.spawn_error
        return h

    def poll(self, h: ModalHandle) -> dict:
        import modal

        # 1) Call status FIRST: if the call has finished, its return value is the authoritative final
        #    state (samples + checkpoint), so a stale progress Dict can never hide the last samples.
        final, state, error = None, None, None
        try:
            final = bounded(lambda: h.call.get(timeout=0), "FunctionCall.get")
        except CallTimeout:
            raise
        except Exception as e:  # noqa: BLE001
            if _is_function_timeout(e, modal):
                state, error = "failed", f"Modal-enforced hard timeout reached ({type(e).__name__}); container stopped"
            elif not _is_still_running(e):
                state, error = "failed", f"{type(e).__name__}: {e}"
        # 2) Only then read progress (for a running call, or a failed one's last report).
        if isinstance(final, dict) and final.get("state"):
            progress = final
        else:
            progress = bounded(lambda: modal.Dict.from_name(PROGRESS_DICT, create_if_missing=True).get(h.key, None),
                               "Dict.get") or {}
        if state is None:
            state = progress.get("state", "initializing")
            error = progress.get("error")
            if final is not None and state not in ("done", "failed"):
                state, error = "failed", "worker returned without a final state"
        samples = progress.get("samples_raw", [])
        new, h.cursor = samples[h.cursor:], len(samples)
        return {"device_id": progress.get("device_id", ""), "state": state, "sim_time_raw": progress.get("sim_time_raw"),
                "new_samples_raw": new, "error": error, "checkpoint": progress.get("checkpoint"),
                "wall_start": progress.get("wall_start"), "wall_end": progress.get("wall_end"),
                "solver_revision": progress.get("solver_revision")}

    def _set_abort(self) -> str | None:
        """Raise the run's kill switch so a worker that started anyway (e.g. a spawn that 'failed' or
        timed out client-side) stops itself. Best effort: returns an error text instead of raising."""
        import modal

        try:
            bounded(lambda: modal.Dict.from_name(PROGRESS_DICT, create_if_missing=True).__setitem__(abort_key(self.run_id), True),
                    "Dict.put(abort)")
            return None
        except Exception as e:  # noqa: BLE001
            return f"{type(e).__name__}: {e}"

    def terminate(self, h: ModalHandle) -> None:
        abort_error = self._set_abort()  # first, whatever the state of the call
        with h.lock:
            if h.cancelled:
                return
            if not h.spawn_done.is_set():
                h.cancel_requested = True
                raise TerminationPending("spawn still in flight; it is cancelled the moment it returns",
                                         lambda cb: _subscribe(h, cb))
            call = h.call
        if call is None:  # spawn ended with an error client-side; the kill switch covers a worker that started anyway
            if abort_error:
                raise RuntimeError(f"spawn errored and the run kill switch could not be set: {abort_error}")
            return
        _cancel(call)
        with h.lock:
            h.cancelled = True
