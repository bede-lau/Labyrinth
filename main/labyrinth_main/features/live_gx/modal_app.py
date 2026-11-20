"""UNREHEARSED — Modal app for the live GX workers (D-011). Never imported by the server, replay or the test
process (tests read it as AST; one executes it in a subprocess against a stub `modal`, never the real package).

Deploy explicitly (registers the functions; launches nothing, costs nothing until called):

    cd main && LABYRINTH_GX_REF=<gx commit sha> modal deploy -m labyrinth_main.features.live_gx.modal_app

Workers run only when `modal_backend.ModalBackend.launch` spawns them after the budget guard has
approved and the operator confirmed the slot cost. There is no local_entrypoint, schedule or web
endpoint here, so `modal run` / `modal serve` cannot start a GPU by accident.

Resources: one A100-40GB per worker; 4 CPU cores and 16 GiB each (request = limit), so the pair is
the 2x A100-40GB + 8 cores + 32 GiB configuration that the PRD's $6.10/h rate prices.
`max_containers=2`, `retries=0`, minimal `scaledown_window`.
Timeouts, priced in stages per call (`budget_guard`):
    startup_timeout = modal_startup_timeout_s()  (the priced SETUP_MIN; image pull + cold start)
    timeout         = modal_timeout_s(kind)      (execution, counted from container start)
    startup + execution == planned_call_s(kind)  == the orchestrator's hard timeout, counted from just before
    the FIRST spawn, while this worker's execution budget counts from ITS container start.
The worker stops GX CHECKPOINT_MARGIN_S before its execution budget ends. The margin is everything that can lie
between the two clocks or after GX is told to stop, each at its bound: the later worker's spawn lag (SPAWN_LAG_S),
the worker's loop period (POLL_S), GX's stop wait (GX_STOP_WAIT_S), the final flux read + checkpoint copy +
Volume commit (FINALIZE_S, an unmeasured allowance) and the orchestrator's polling until it sees `done`
(REPORT_LAG_S). So a worker whose cold start uses the whole startup budget still reports `done` before the
orchestrator gives up (live: GX runs 958 s, more than the PRD's 15-min slot). Time a GPU spends queued before its
container starts is bounded by nothing here; such a session can still end as a hard-timeout fallback, and its
workers are cancelled like any other.
`startup_timeout` is REQUIRED: if this modal version's `App.function` does not visibly accept it, the
deploy fails with RuntimeError (no silent loss of the startup bound).
Kill switch: terminating a run first sets progress["<run_id>/abort"]; every worker checks it at start
and on every loop iteration (every POLL_S seconds) and stops GX cleanly — this also stops a worker whose
spawn failed or timed out client-side but started anyway (the backend hands such a spawn to the
orchestrator as a launched worker, so its termination — and with it the switch — is never skipped).
The worker keeps the original deadline across a rescheduled input (wall_start persisted in the progress
Dict) and refuses to extend it.
GPU 0 = bean, GPU 1 = triangular: the function is spawned once per tube, each in its own container;
the device ID reported is that container's GPU UUID (nvidia-smi).
Checkpoints: GX writes restart files every `nsave` steps; the checkpoint's simulation time is read from
the restart netCDF itself (not from the last flux sample). Only a COMPLETE restart file is saved: the
final file when GX exited normally, otherwise the last snapshot that was readable and unchanged across
two polls (a file being rewritten when GX is stopped is never copied).
"""
from __future__ import annotations

import inspect
import os

import modal

from labyrinth_main.common.paths import WOUT_W7X_KJM
from labyrinth_main.features.live_gx import budget_guard as guard
from labyrinth_main.features.live_gx.gx_input import GX_GIT_URL, RESUME_FILE
from labyrinth_main.features.live_gx.modal_backend import (
    APP_NAME,
    CALL_TIMEOUT_S,
    CHECKPOINT_VOLUME,
    FUNCTION_NAMES,
    LAUNCH_CALLS,
    POLL_CALLS,
    PROGRESS_DICT,
    abort_key,
)
from labyrinth_main.features.live_gx.orchestrator import TUBES
from labyrinth_main.features.live_gx.service import POLL_INTERVAL_S

GX_REF = os.environ.get("LABYRINTH_GX_REF", "")
if modal.is_local() and not GX_REF:
    raise RuntimeError("Set LABYRINTH_GX_REF to the GX commit to build (pin it; it is recorded as the solver revision).")

GPU = "A100-40GB"
CPU_PER_WORKER = (4.0, 4.0)                # (request, limit) cores
MEMORY_MIB_PER_WORKER = (16384, 16384)     # (request, limit) MiB
SCALEDOWN_S = 2
LIVE_TIMEOUT_S = guard.modal_timeout_s("live")
REHEARSAL_PHASE_TIMEOUT_S = guard.modal_timeout_s("rehearsal")
STARTUP_TIMEOUT_S = guard.modal_startup_timeout_s()
POLL_S = 10                               # worker loop period: flux read, restart snapshot, kill-switch check
GX_STOP_WAIT_S = 30                       # SIGTERM to GX, then this long before SIGKILL
FINALIZE_S = 60                           # final flux read, checkpoint copy + Volume commit (allowance, unmeasured)
# the later worker's spawn is sent after the first one's lookup + spawn and its own lookup (each <= CALL_TIMEOUT_S)
SPAWN_LAG_S = (len(TUBES) * LAUNCH_CALLS - 1) * CALL_TIMEOUT_S
# a worker that just finished is seen by the orchestrator's next poll round (its sleep + every worker's poll calls)
REPORT_LAG_S = POLL_INTERVAL_S + len(TUBES) * POLL_CALLS * CALL_TIMEOUT_S
CHECKPOINT_MARGIN_S = SPAWN_LAG_S + POLL_S + GX_STOP_WAIT_S + FINALIZE_S + REPORT_LAG_S  # 242 s
WORK_ROOT = "/work"                       # container-local scratch, one sub-directory per call
CKPT_MOUNT = "/ckpt"                      # where the checkpoint Volume is mounted
GX_REVISION_FILE = "/opt/gx/REVISION"     # written by the image build: the GX commit actually built
CUDA_IMAGE = "nvidia/cuda:12.4.1-devel-ubuntu22.04"

image = (
    modal.Image.from_registry(CUDA_IMAGE, add_python="3.11")
    .apt_install("git", "build-essential", "cmake", "libnetcdf-dev", "libhdf5-dev", "libgsl-dev",
                 "libopenmpi-dev", "openmpi-bin", "libcutensor-dev", "libnccl-dev")
    .pip_install("numpy==2.5.3", "netCDF4==1.7.5.1.post1", "h5py==3.16.0")
    .env({"LABYRINTH_GX_REF": GX_REF})
    .run_commands(
        f"git clone {GX_GIT_URL} /opt/gx && cd /opt/gx && git checkout {GX_REF}",
        "cd /opt/gx && make -j8 GK_SYSTEM=linux_generic && install -m 755 gx /usr/local/bin/gx",
        f"cd /opt/gx && git rev-parse HEAD > {GX_REVISION_FILE}",
    )
    .add_local_file(str(WOUT_W7X_KJM), "/inputs/wout_w7x_kjm.nc")
    .add_local_python_source("labyrinth_main")
)

app = modal.App(APP_NAME)
checkpoints = modal.Volume.from_name(CHECKPOINT_VOLUME, create_if_missing=True)
progress = modal.Dict.from_name(PROGRESS_DICT, create_if_missing=True)
assert set(FUNCTION_NAMES.values()) == {"gx_worker_live", "gx_worker_rehearsal"}  # names modal_backend looks up
try:
    _function_params = inspect.signature(app.function).parameters
except (TypeError, ValueError):
    _function_params = {}
# Accepted means a parameter that a KEYWORD argument binds to: a positional-only parameter of that name (next to
# **kwargs) would let `startup_timeout=` vanish into the catch-all, exactly like a signature without it.
_startup_param = _function_params.get("startup_timeout")
if modal.is_local() and (_startup_param is None or _startup_param.kind not in (inspect.Parameter.POSITIONAL_OR_KEYWORD,
                                                                              inspect.Parameter.KEYWORD_ONLY)):
    raise RuntimeError("this modal version's App.function does not (visibly) accept startup_timeout; refusing to "
                       "deploy without the priced startup bound. Pin a modal version that supports it.")


def _aborted(progress_key: str) -> bool:
    """True once the run's kill switch is set (modal_backend.abort_key). A failed lookup is not an abort."""
    try:
        return progress.get(abort_key(progress_key.rsplit("/", 1)[0]), False) is True
    except Exception:  # noqa: BLE001
        return False


def _read_flux(out_nc: str) -> tuple[list[list[float]], str | None]:
    """-> (samples, problem). `samples` is the complete PREFIX of (t, Q_ion) rows in raw GX units: it stops
    at the first non-finite or masked row, so indices never shift between reads (the backend's cursor
    relies on that). A non-finite row that is NOT the last one is a solver problem, returned as text.
    GX may be mid-write: every read is guarded and a failed read returns ([], None) (the next poll retries)."""
    try:
        import netCDF4
        import numpy as np

        d = netCDF4.Dataset(out_nc)
    except Exception:  # noqa: BLE001 - missing / partially written file
        return [], None
    try:
        for grp, qvar in (("Diagnostics", "HeatFlux_st"), ("", "qflux"), ("Fluxes", "qflux")):
            try:
                g = d[grp] if grp else d
                if qvar not in g.variables:
                    continue
                q = np.ma.filled(np.ma.asarray(g[qvar][:], dtype=float), np.nan)
                t = np.ma.filled(np.ma.asarray((d["Grids"] if "Grids" in d.groups else d)["time"][:], dtype=float), np.nan)
            except Exception:  # noqa: BLE001
                continue
            q = q[:, 0] if q.ndim == 2 else q
            n = min(t.size, q.size)
            good = np.isfinite(t[:n]) & np.isfinite(q[:n])
            k = int(np.argmin(good)) if not good.all() else n
            problem = None
            if k < n - 1:
                problem = f"non-finite heat flux at GX t = {t[k]!r} (row {k} of {n})"
            return [[float(a), float(b)] for a, b in zip(t[:k], q[:k], strict=True)], problem
        return [], None
    finally:
        try:
            d.close()
        except Exception:  # noqa: BLE001
            pass


def _restart_time(path: str) -> float | None:
    """Simulation time stored in a GX restart file (raw units), or None if it cannot be read."""
    try:
        import netCDF4
        import numpy as np

        with netCDF4.Dataset(path) as d:
            for name in ("time", "t", "Time"):
                if name in d.variables:
                    v = np.asarray(d[name][:], dtype=float).ravel()
                    if v.size and np.isfinite(v[-1]):
                        return float(v[-1])
            for name in ("time", "t"):
                if name in d.ncattrs():
                    return float(d.getncattr(name))
    except Exception:  # noqa: BLE001
        return None
    return None


def _worker(*, tube: str, gpu_index: int, progress_key: str, input_toml: str, checkpoint_ref: str | None,
            hard_timeout_s: int) -> dict:
    import shutil
    import subprocess
    import time
    from pathlib import Path

    prior = progress.get(progress_key, None) or {}
    wall_start = prior.get("wall_start") or time.time()   # a rescheduled input keeps the ORIGINAL deadline
    deadline = wall_start + hard_timeout_s - CHECKPOINT_MARGIN_S
    work = Path(WORK_ROOT) / progress_key.replace("/", "_")
    work.mkdir(parents=True, exist_ok=True)
    device_id = subprocess.run(["nvidia-smi", "--query-gpu=uuid", "--format=csv,noheader"], capture_output=True,
                               text=True, check=True).stdout.strip().splitlines()[0]
    revision = Path(GX_REVISION_FILE).read_text().strip()
    state = {"device_id": device_id, "state": "initializing", "sim_time_raw": None, "samples_raw": [], "error": None,
             "checkpoint": None, "wall_start": wall_start, "wall_end": None, "solver_revision": f"GX {revision}",
             "gpu_index": gpu_index, "tube": tube}
    if prior:
        state["error"] = "input was rescheduled; refusing to extend the original deadline"
    if time.time() >= deadline or prior:
        state.update(state="failed", wall_end=time.time(), error=state["error"] or "deadline already passed")
        progress[progress_key] = state
        raise RuntimeError(state["error"])
    if _aborted(progress_key):  # the run was terminated before this container started: exit cleanly
        state.update(state="failed", wall_end=time.time(), error="aborted by the run's kill switch before start")
        progress[progress_key] = state
        return dict(state)
    progress[progress_key] = state
    if checkpoint_ref:
        checkpoints.reload()
        shutil.copy(f"{CKPT_MOUNT}/{checkpoint_ref}", work / RESUME_FILE)
    (work / f"{tube}.in").write_text(input_toml)
    proc = subprocess.Popen(["gx", f"{tube}.in"], cwd=work)
    restart, good = work / f"{tube}.restart.nc", work / f"{tube}.restart.good.nc"
    seen, good_t, problem, aborted = None, None, None, False
    try:
        while proc.poll() is None and time.time() < deadline and problem is None:
            if _aborted(progress_key):
                aborted = True
                break
            time.sleep(POLL_S)
            samples, problem = _read_flux(str(work / f"{tube}.out.nc"))
            if samples:
                state.update(state="running", samples_raw=samples, sim_time_raw=samples[-1][0])
                progress[progress_key] = state
            # snapshot a restart file only once it is readable and unchanged since the previous poll
            try:
                stamp = (restart.stat().st_mtime_ns, restart.stat().st_size)
            except OSError:
                stamp = None
            if stamp is not None and stamp == seen and (t_ck := _restart_time(str(restart))) is not None and t_ck != good_t:
                shutil.copy(restart, good)
                good_t = t_ck
            seen = stamp
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=GX_STOP_WAIT_S)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
    samples, last_problem = _read_flux(str(work / f"{tube}.out.nc"))
    problem = problem or last_problem
    notes = []
    # complete restart only: the final file if GX exited normally, else the last stable snapshot
    source, t_ck = (restart, _restart_time(str(restart))) if proc.returncode == 0 and restart.exists() else (good, good_t)
    if source.exists() and t_ck is not None:
        ref = f"{progress_key}/{tube}.restart.nc"
        Path(f"{CKPT_MOUNT}/{ref}").parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(source, f"{CKPT_MOUNT}/{ref}")
        checkpoints.commit()
        state["checkpoint"] = {"ref": ref, "sim_time_raw": t_ck}
    else:
        notes.append("no complete restart file; no checkpoint recorded")
    ok = proc.returncode in (0, -15) and bool(samples) and problem is None
    state.update(samples_raw=samples, sim_time_raw=samples[-1][0] if samples else None, wall_end=time.time(),
                 state="done" if ok else "failed",
                 error=None if ok else (problem or f"GX exited with code {proc.returncode} and {len(samples)} flux samples"))
    if notes:
        state["notes"] = notes
    progress[progress_key] = state
    if aborted:  # stopped on the operator's terminate: a clean exit, not a crash
        state.update(state="failed", error="aborted by the run's kill switch")
        progress[progress_key] = state
        return dict(state)
    if not ok:
        raise RuntimeError(state["error"])
    return dict(state)   # authoritative final state: ModalBackend.poll prefers it over the Dict


@app.function(image=image, gpu=GPU, cpu=CPU_PER_WORKER, memory=MEMORY_MIB_PER_WORKER, timeout=LIVE_TIMEOUT_S,
              retries=0, max_containers=2, scaledown_window=SCALEDOWN_S, volumes={CKPT_MOUNT: checkpoints},
              startup_timeout=STARTUP_TIMEOUT_S)
def gx_worker_live(*, tube: str, gpu_index: int, progress_key: str, input_toml: str, checkpoint_ref: str | None,
                   hard_timeout_s: int) -> dict:
    return _worker(tube=tube, gpu_index=gpu_index, progress_key=progress_key, input_toml=input_toml,
                   checkpoint_ref=checkpoint_ref, hard_timeout_s=min(hard_timeout_s, LIVE_TIMEOUT_S))


@app.function(image=image, gpu=GPU, cpu=CPU_PER_WORKER, memory=MEMORY_MIB_PER_WORKER, timeout=REHEARSAL_PHASE_TIMEOUT_S,
              retries=0, max_containers=2, scaledown_window=SCALEDOWN_S, volumes={CKPT_MOUNT: checkpoints},
              startup_timeout=STARTUP_TIMEOUT_S)
def gx_worker_rehearsal(*, tube: str, gpu_index: int, progress_key: str, input_toml: str, checkpoint_ref: str | None,
                        hard_timeout_s: int) -> dict:
    return _worker(tube=tube, gpu_index=gpu_index, progress_key=progress_key, input_toml=input_toml,
                   checkpoint_ref=checkpoint_ref, hard_timeout_s=min(hard_timeout_s, REHEARSAL_PHASE_TIMEOUT_S))
