"""Task 06 · Advance plasma (live GX). Tests grouped per expected outcome L1–L8 (names start with the id).

Everything here runs offline with the test-only fake backend; the real `modal` is never imported or needed (a
local stub stands in for its API where ModalBackend is exercised). `modal_app.py` is never imported by this
process: it is parsed as AST (single helpers are compiled out of it), and one test executes it in a subprocess
against a stub `modal` module. The rehearse CLI's signal handling is tested in subprocesses (POSIX only).
"""
from __future__ import annotations

import ast
import inspect
import json
import math
import os
import signal
import socket
import subprocess
import sys
import threading
import time
import tomllib
import types
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from labyrinth_main.common.paths import CONTRACTS, REPO_ROOT
from labyrinth_main.features.budget import pricing
from labyrinth_main.features.live_gx import budget_guard as guard
from labyrinth_main.features.live_gx import gx_input, modal_backend, rehearse, service
from labyrinth_main.features.live_gx.fake_backend import FakeBackend
from labyrinth_main.features.live_gx.orchestrator import (
    NO_REHEARSAL_LABEL,
    TERMINATE_BACKOFF_S,
    TERMINATE_FAILED,
    TERMINATE_PENDING,
    Checkpoint,
    LaunchInFlight,
    Orchestrator,
    TerminationPending,
    TransientBackendError,
)
from labyrinth_main.features.transport.units import HEAT_FLUX_DIVISOR, TIME_MULTIPLIER

LIVE_GX = REPO_ROOT / "main" / "labyrinth_main" / "features" / "live_gx"
SQRT2 = math.sqrt(2.0)
FAILED_LABEL = f"Worker failed. {NO_REHEARSAL_LABEL}"
TIMEOUT_LABEL = f"Hard timeout reached. {NO_REHEARSAL_LABEL}"


# ---------------------------------------------------------------- helpers
@pytest.fixture(scope="module")
def validator():
    resources = []
    for p in CONTRACTS.glob("*.schema.json"):
        schema = json.loads(p.read_text())
        res = Resource.from_contents(schema)
        resources += [(p.name, res), (schema["$id"], res)]
    schema = json.loads((CONTRACTS / "live-status.schema.json").read_text())
    return Draft202012Validator(schema, registry=Registry().with_resources(resources))


def assert_valid(validator, snap):
    errors = [f"{e.json_path}: {e.message}" for e in validator.iter_errors(snap)]
    assert not errors, errors


BUDGET = guard.evaluate(guard.Ledger(0.0, 0.0, True)).budget_snapshot()


def run_session(backend, *, checkpoints=None, saved_run_id=None, hard_timeout_s=60, **kw):
    kw.setdefault("retry_sleep", lambda s: None)
    orch = Orchestrator(backend, hard_timeout_s=hard_timeout_s, checkpoints=checkpoints, saved_run_id=saved_run_id, **kw)
    snaps = []
    orch.run(poll_interval_s=0.005, on_snapshot=lambda: snaps.append(orch.snapshot(BUDGET, qualified=False)))
    return orch, snaps


def available():
    return True, "test: availability forced (fake backend)"


def write_ledger(state_dir: Path, billed=8.10, pending=0.0, reconciled=True):
    service.LedgerStore(state_dir / "ledger.json").save(guard.Ledger(billed, pending, reconciled))


def rehearsal_factory(backends: list, restart_store: dict | None = None, **kw):
    store = {} if restart_store is None else restart_store

    def factory(run_id, timeout):
        backends.append(FakeBackend(steps=3, dt_raw=10.0, restart_store=store, **kw))
        return backends[-1]
    return factory


def qualify(state_dir: Path) -> str:
    """Produce a genuine qualification + saved run with the fake rehearsal, then reconcile the ledger."""
    write_ledger(state_dir)
    ok, rec = rehearse.run_rehearsal(rehearsal_factory([]), state_dir=state_dir,
                                     confirm_cost_usd=guard.rehearsal_estimate_usd(), poll_interval_s=0.005)
    assert ok, rec
    write_ledger(state_dir)
    return rec["savedRunId"]


# ---------------------------------------------------------------- L1 budget guard
def test_L1_slot_estimate_formula_uses_pricing_constants():
    assert guard.LIVE_RATE_USD_PER_H is pricing.LIVE_RATE_USD_PER_H and guard.CEILING_USD is pricing.CEILING_USD
    minutes = pricing.LIVE_SLOT_MIN + guard.SETUP_MIN + guard.IDLE_MARGIN_MIN
    expected = math.ceil(round((pricing.LIVE_RATE_USD_PER_H * minutes / 60 + guard.STORAGE_EGRESS_USD) * 100, 6)) / 100
    assert guard.slot_estimate_usd() == expected == 2.65
    # PRD "$1.53 for 15 minutes" is the GPU-time term alone; the guard adds setup, idle and storage on top.
    assert guard.ceil_cents(pricing.LIVE_RATE_USD_PER_H * pricing.LIVE_SLOT_MIN / 60) == 1.53  # 1.525 -> 1.53
    assert guard.slot_estimate_usd() > 1.53
    assert guard.rehearsal_estimate_usd() == math.ceil(round((6.10 * 75 / 60 + 0.10) * 100, 6)) / 100


def test_L1_refuses_when_billed_plus_pending_plus_estimate_exceeds_ceiling():
    est = guard.slot_estimate_usd()
    at_limit = guard.evaluate(guard.Ledger(billed=40.0 - est - 1.0, pending=1.0, reconciled=True))
    assert at_limit.approved, at_limit.reason
    over = guard.evaluate(guard.Ledger(billed=40.0 - est - 1.0, pending=1.01, reconciled=True))
    assert not over.approved and "exceeds" in over.reason and "pending" in over.reason
    assert not guard.evaluate(guard.Ledger(billed=20.0, pending=19.0, reconciled=True)).approved  # pending counts
    # $40.004 is over the ceiling: the comparison is not rounded to cents
    assert not guard.evaluate(guard.Ledger(billed=40.004 - est, pending=0.0, reconciled=True)).approved
    snap = over.budget_snapshot()
    assert snap["slotFits"] is False and snap["slotEstimateUsd"] == est and snap["ceilingUsd"] == 40.0


def test_L1_refuses_unreconciled_or_invalid_ledger():
    d = guard.evaluate(guard.Ledger(billed=0.0, pending=0.0, reconciled=False))
    assert not d.approved and "not reconciled" in d.reason
    for bad in (float("nan"), -1.0, float("inf")):
        assert not guard.evaluate(guard.Ledger(billed=bad, pending=0.0, reconciled=True)).approved
    reserved = guard.Ledger(8.10, 0.0, True).reserve(2.65)
    assert reserved == guard.Ledger(8.10, 2.65, False)  # every reservation forces a new reconciliation


def test_L1_hard_timeout_is_planned_duration_capped_by_remaining_budget():
    d = guard.evaluate(guard.Ledger(8.10, 0.0, True))
    assert d.approved and d.hard_timeout_s == int((15 + 5 + 5) * 60)
    tight = guard.evaluate(guard.Ledger(39.0, 0.0, True))
    assert not tight.approved
    assert tight.hard_timeout_s == int((1.0 - guard.STORAGE_EGRESS_USD) / 6.10 * 3600)
    assert guard.evaluate(guard.Ledger(45.0, 0.0, True)).hard_timeout_s == 0


def test_L1_ledger_reservation_is_locked_across_processes(tmp_path):
    store = service.LedgerStore(tmp_path / "ledger.json")
    with store.locked():
        with pytest.raises(service.LedgerLocked):
            with service.LedgerStore(tmp_path / "ledger.json").locked(timeout_s=0.1):
                pass
    with store.locked(timeout_s=0.1):  # released
        store.save(guard.Ledger(1.0, 2.0, True))
    assert store.load() == guard.Ledger(1.0, 2.0, True)
    assert sorted(p.name for p in tmp_path.iterdir()) == ["ledger.json"]  # no stray temp or lock files


# ---------------------------------------------------------------- L2 concurrency, devices, clocks, units
def test_L2_two_workers_run_concurrently_with_devices_clocks_and_archive_units():
    backend = FakeBackend(steps=6, dt_raw=10.0, step_wall_s=0.03)
    orch, snaps = run_session(backend)
    assert [(t, g) for t, g, _ in backend.launch_calls] == [("bean", 0), ("triangular", 1)]
    final = snaps[-1]
    assert final["mode"] == "terminated"
    assert [(w["gpuIndex"], w["tube"]) for w in final["workers"]] == [(0, "bean"), (1, "triangular")]
    ids = [w["deviceId"] for w in final["workers"]]
    assert all(ids) and len(set(ids)) == 2
    # overlapping solver execution, as recorded by the orchestrator and by the worker threads themselves
    iv = orch.intervals()
    assert max(iv["bean"][0], iv["triangular"][0]) < min(iv["bean"][1], iv["triangular"][1])
    b, t = backend.workers
    assert max(b.thread_start, t.thread_start) < min(b.thread_end, t.thread_end)
    assert all(w["wallStart"] for w in final["workers"])
    # simulation clocks advance monotonically
    for i in (0, 1):
        clock = [s["workers"][i]["simTime"] for s in snaps if s["workers"][i]["simTime"] is not None]
        assert clock == sorted(clock) and clock[-1] > clock[0]
        assert clock[-1] == pytest.approx(60.0 * SQRT2)
    # new samples converted to archive units (t x sqrt2, Q / 2 sqrt2)
    for w, fw in zip(final["workers"], backend.workers, strict=True):
        assert len(w["samples"]) == 6
        for s, (traw, qraw) in zip(w["samples"], fw.samples_raw, strict=True):
            assert s["t"] == pytest.approx(traw * TIME_MULTIPLIER) and s["Q"] == pytest.approx(qraw / HEAT_FLUX_DIVISOR)


# ---------------------------------------------------------------- L3 failure -> fallback
def test_L3_worker_failure_falls_back_and_failure_path_terminates_other_worker():
    events = []
    backend = FakeBackend(steps=50, step_wall_s=0.02, fail={"triangular": 3}, events=events)
    orch = Orchestrator(backend, hard_timeout_s=60, retry_sleep=lambda s: None)
    snaps = []

    def on_snapshot():
        snap = orch.snapshot(BUDGET, qualified=False)
        snaps.append(snap)
        events.append(("snapshot", snap["mode"]))

    orch.run(poll_interval_s=0.005, on_snapshot=on_snapshot)
    final = snaps[-1]
    assert final["mode"] == "fallback"
    assert final["fallback"] == {"active": True, "label": FAILED_LABEL, "savedRunId": None}
    tri = final["workers"][1]
    assert tri["state"] == "failed" and "simulated GX crash on triangular" in tri["error"]
    assert "GPU 1 (triangular) worker failed" in final["reason"]
    bean = backend.workers[0]
    assert bean.terminate_calls == 1 and not bean.thread.is_alive() and bean.state != "done"
    # the failure handler itself terminated the other worker: before the first fallback snapshot,
    # i.e. before run()'s own finally could have done it
    first_fallback = events.index(("snapshot", "fallback"))
    assert ("terminate", "bean") in events[:first_fallback]


def test_L3_fallback_names_saved_run_and_covers_launch_and_poll_failures():
    _, snaps = run_session(FakeBackend(fail={"bean": 2}), saved_run_id="rehearsal-abc")
    assert snaps[-1]["fallback"] == {"active": True, "label": "Worker failed — playing saved GX run rehearsal-abc",
                                     "savedRunId": "rehearsal-abc"}
    backend = FakeBackend(fail_launch={"triangular"})
    _, snaps = run_session(backend)
    assert snaps[-1]["mode"] == "fallback" and "launch failed" in snaps[-1]["workers"][1]["error"]
    assert backend.workers[0].terminate_calls == 1

    class PollBoom(FakeBackend):
        def poll(self, w):
            raise ConnectionError("lost contact")

    backend = PollBoom()
    _, snaps = run_session(backend)
    assert snaps[-1]["mode"] == "fallback" and "lost contact" in snaps[-1]["workers"][0]["error"]
    assert [w.terminate_calls for w in backend.workers] == [1, 1]


@pytest.mark.parametrize("bad", [None, "garbage", ["state", "running"],
                                 {"state": "running", "new_samples_raw": 5},
                                 {"state": "running", "checkpoint": "ckpt"},
                                 {"state": "running", "error": "CUDA error: out of memory"}])
def test_L3_malformed_or_erroring_poll_result_falls_back_with_label(bad):
    class Bad(FakeBackend):
        def poll(self, w):
            super().poll(w)
            return bad

    backend = Bad(steps=50)
    _, snaps = run_session(backend)
    final = snaps[-1]
    assert final["mode"] == "fallback" and final["fallback"]["active"] is True and final["fallback"]["label"] == FAILED_LABEL
    assert final["workers"][0]["state"] == "failed" and final["workers"][0]["error"]
    assert [w.terminate_calls for w in backend.workers] == [1, 1]


def test_L3_hard_timeout_before_both_workers_finish_is_a_labelled_fallback():
    backend = FakeBackend(steps=1000, step_wall_s=0.01)
    _, snaps = run_session(backend, hard_timeout_s=0)
    final = snaps[-1]
    assert final["mode"] == "fallback" and final["reason"].startswith("Hard timeout reached")
    assert final["fallback"]["label"] == TIMEOUT_LABEL and "Worker failed" not in final["reason"]
    assert [w.terminate_calls for w in backend.workers] == [1, 1]


def test_L3_transient_poll_errors_are_tolerated_then_fail():
    class Flaky(FakeBackend):
        def __init__(self, bursts, **kw):
            super().__init__(**kw)
            self.bursts = dict(bursts)  # tube -> number of consecutive transient errors to raise

        def poll(self, w):
            if self.bursts.get(w.tube, 0) > 0:
                self.bursts[w.tube] -= 1
                raise TransientBackendError("client call timed out")
            return super().poll(w)

    _, snaps = run_session(Flaky({"bean": 2, "triangular": 1}, steps=4))
    assert snaps[-1]["mode"] == "terminated", snaps[-1]["reason"]
    _, snaps = run_session(Flaky({"bean": 3}, steps=50))
    assert snaps[-1]["mode"] == "fallback" and "3 times in a row" in snaps[-1]["workers"][0]["error"]


def test_L3_cold_start_longer_than_checkpoint_margin_still_ends_cleanly(tmp_path):
    """Scaled clock: startup budget 0.4, execution budget 0.6, checkpoint margin 0.15 (orchestrator hard
    timeout = startup + execution = 1.0, counted from launch; worker deadline counted from ITS start)."""
    startup_cap, execution, margin = 0.4, 0.6, 0.15
    write_ledger(tmp_path)
    store: dict = {}

    def factory(rid, t):
        return FakeBackend(steps=10**6, step_wall_s=0.02, startup_s=0.3, run_for_s=execution - margin, restart_store=store)

    ok, rec = rehearse.run_rehearsal(factory, state_dir=tmp_path, confirm_cost_usd=guard.rehearsal_estimate_usd(),
                                     poll_interval_s=0.01, phase_timeout_s=startup_cap + execution)
    assert 0.3 > margin and ok, rec.get("checks") or rec
    assert all(p["mode"] == "terminated" for p in rec["phases"])
    # a cold start beyond the priced startup budget ends as a hard-timeout fallback, worded as such
    _, snaps = run_session(FakeBackend(steps=10**6, step_wall_s=0.02, startup_s=0.7, run_for_s=execution - margin),
                           hard_timeout_s=startup_cap + execution)
    assert snaps[-1]["mode"] == "fallback" and snaps[-1]["fallback"]["label"] == TIMEOUT_LABEL


# ---------------------------------------------------------------- L4 unavailable, zero network
@pytest.fixture
def no_network(monkeypatch):
    calls = []

    def refuse(*a, **k):
        calls.append(a)
        raise AssertionError(f"network call attempted: {a!r}")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket.socket, "connect_ex", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket, "getaddrinfo", refuse)
    return calls


def test_L4_no_credentials_or_no_modal_means_unavailable_with_zero_network(monkeypatch, tmp_path, no_network):
    monkeypatch.delenv("MODAL_TOKEN_ID", raising=False)
    monkeypatch.delenv("MODAL_TOKEN_SECRET", raising=False)
    monkeypatch.delenv("MODAL_CONFIG_PATH", raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    assert modal_backend.credentials_available() is False
    svc = service.LiveService(state_dir=tmp_path / "state")
    st = svc.status()
    assert st["mode"] == "unavailable" and "no Modal credentials" in st["reason"] and "UNREHEARSED" in st["reason"]
    assert st["fallback"] == {"active": True, "label": NO_REHEARSAL_LABEL, "savedRunId": None}
    assert st["workers"] == [] and st["qualified"] is False
    accepted, reason = svc.launch(st["budget"]["slotEstimateUsd"])
    assert not accepted and "unavailable" in reason
    # credentials present but `modal` missing is still unavailable
    monkeypatch.setattr(modal_backend, "credentials_available", lambda: True)
    monkeypatch.setattr(modal_backend, "modal_installed", lambda: False)
    st = svc.status()
    assert st["mode"] == "unavailable" and "not installed" in st["reason"]
    assert no_network == [] and "modal" not in sys.modules
    assert not (tmp_path / "state" / "ledger.json").exists()  # nothing reserved


def test_L4_credentials_check_is_local(tmp_path):
    assert modal_backend.credentials_available({"MODAL_TOKEN_ID": "a", "MODAL_TOKEN_SECRET": "b"}, tmp_path)
    assert not modal_backend.credentials_available({"MODAL_TOKEN_ID": "a"}, tmp_path)
    (tmp_path / ".modal.toml").write_text('[default]\ntoken_id = "x"\ntoken_secret = "y"\n')
    assert modal_backend.credentials_available({}, tmp_path)


# ---------------------------------------------------------------- L5 checkpoint continuation
def test_L5_checkpoint_continuation_resumes_sim_time_not_zero():
    ckpts = {t: Checkpoint(t, 100.0, f"ckpt/{t}") for t in ("bean", "triangular")}
    backend = FakeBackend(steps=4, dt_raw=10.0)
    _, snaps = run_session(backend, checkpoints=ckpts)
    assert [c for _, _, c in backend.launch_calls] == [ckpts["bean"], ckpts["triangular"]]
    assert snaps[-1]["mode"] == "terminated"
    for i in (0, 1):
        clock = [s["workers"][i]["simTime"] for s in snaps if s["workers"][i]["simTime"] is not None]
        assert clock[0] >= 100.0 * SQRT2 and clock[-1] == pytest.approx(140.0 * SQRT2)
        assert all(s["t"] > 100.0 * SQRT2 for s in snaps[-1]["workers"][i]["samples"])


def test_L5_worker_restarting_from_zero_is_a_failure():
    ckpts = {t: Checkpoint(t, 100.0, f"ckpt/{t}") for t in ("bean", "triangular")}
    _, snaps = run_session(FakeBackend(ignore_checkpoint=True), checkpoints=ckpts)
    assert snaps[-1]["mode"] == "fallback"
    assert "checkpoint continuation broken" in snaps[-1]["workers"][0]["error"]


def test_L5_rehearsal_verifies_init_then_continuation_from_restart_file_time(tmp_path, no_network):
    write_ledger(tmp_path, billed=8.10)
    est = guard.rehearsal_estimate_usd()
    backends: list = []
    factory = rehearsal_factory(backends)
    ok, rec = rehearse.run_rehearsal(factory, state_dir=tmp_path, confirm_cost_usd=est + 0.01, poll_interval_s=0.005)
    assert not ok and "must equal" in rec["reason"] and backends == []
    ok, rec = rehearse.run_rehearsal(factory, state_dir=tmp_path, confirm_cost_usd=est, poll_interval_s=0.005)
    assert ok, rec["checks"]
    assert rec["checks"] == {"init": True, "continuation": True, "distinctDevices": True, "overlap": True}
    # the restart file is written every 2 steps: its time (20) precedes the last flux sample (30)
    assert all(w.samples_raw[-1][0] == 30.0 for w in backends[0].workers)
    assert all(c is not None and c.sim_time_raw == 20.0 for _, _, c in backends[1].launch_calls)
    assert rec["phases"][1]["workers"][0]["simTime"] == pytest.approx(50.0 * SQRT2)
    q = service.load_qualification(tmp_path)
    assert q["savedRunId"] == rec["savedRunId"] and service.load_saved_run(tmp_path, rec["savedRunId"]) is not None
    for phase in rec["phases"]:  # rehearsal-specific provenance, not the unqualified-live "UNREHEARSED ... blocked"
        v = phase["provenance"]["verification"]
        assert phase["provenance"]["kind"] == "rehearsal" and v["outcome"] == "passed"
        assert "UNREHEARSED" not in v["details"] and rec["savedRunId"] in v["details"]
    assert service.LedgerStore(tmp_path / "ledger.json").load() == guard.Ledger(8.10, est, False)
    svc = service.LiveService(state_dir=tmp_path, availability_check=available)
    assert svc.status()["qualified"] is True


def test_L5_checkpoint_time_misreported_as_last_sample_fails_continuation(tmp_path):
    write_ledger(tmp_path)
    ok, rec = rehearse.run_rehearsal(rehearsal_factory([], misreport_checkpoint_time=True), state_dir=tmp_path,
                                     confirm_cost_usd=guard.rehearsal_estimate_usd(), poll_interval_s=0.005)
    assert not ok and rec["checks"]["init"] is True and rec["checks"]["continuation"] is False
    assert "checkpoint continuation broken" in json.dumps(rec["phases"][1])
    assert service.load_qualification(tmp_path) is None
    assert all(p["provenance"]["verification"]["outcome"] == "failed" for p in rec["phases"])


def test_L5_saved_run_must_match_contract_exactly(tmp_path):
    run_id = qualify(tmp_path)
    path = tmp_path / "runs" / f"{run_id}.json"
    good = json.loads(path.read_text())
    assert service.load_saved_run(tmp_path, run_id) == good
    bad_variants = [
        {**good, "extra": 1},
        {**good, "phases": good["phases"] * 2},                       # 4 phases
        {**good, "phases": good["phases"][:1]},                       # continuation missing
        {**good, "checks": {**good["checks"], "overlap": False}},     # a failed check
        {**good, "continuationVerified": False},
        {**good, "savedRunId": "rehearsal-000000000000"},
        {**good, "phases": [{**good["phases"][0], "mode": "bogus"}, good["phases"][1]]},
    ]
    for bad in bad_variants:
        path.write_text(json.dumps(bad))
        assert service.load_saved_run(tmp_path, run_id) is None, set(bad) ^ set(good)
        assert service.load_qualification(tmp_path) is None


# ---------------------------------------------------------------- L6 always terminate
def test_L6_workers_terminated_after_retrieval_on_success():
    backend = FakeBackend(steps=3)
    orch, _ = run_session(backend)
    assert orch.mode == "terminated" and [w.terminate_calls for w in backend.workers] == [1, 1]


def test_L6_workers_terminated_on_exception():
    backend = FakeBackend(steps=1000, step_wall_s=0.01)

    def boom(_):
        raise RuntimeError("operator interrupt")

    orch = Orchestrator(backend, hard_timeout_s=60, sleep=boom)
    with pytest.raises(RuntimeError, match="operator interrupt"):
        orch.run(poll_interval_s=0.01)
    assert [w.terminate_calls for w in backend.workers] == [1, 1]
    assert all(not w.thread.is_alive() for w in backend.workers) and orch.mode == "terminated"


def test_L6_failed_terminate_is_retried_and_reported_never_shown_terminated():
    class Stuck(FakeBackend):
        def __init__(self, failures, **kw):
            super().__init__(**kw)
            self.failures, self.attempts = failures, 0

        def terminate(self, w):
            self.attempts += 1
            if w.tube == "bean" and self.failures > 0:
                self.failures -= 1
                raise ConnectionError("Modal API unreachable")
            super().terminate(w)

    sleeps = []
    backend = Stuck(failures=99, steps=3)
    orch, snaps = run_session(backend, retry_sleep=sleeps.append)
    final = snaps[-1]
    assert final["mode"] != "terminated" and final["reason"].startswith(TERMINATE_FAILED)
    assert "GPU 0 (bean)" in final["reason"] and "terminate unconfirmed" in final["workers"][0]["error"]
    assert sleeps == list(orch.terminate_backoff_s) and not orch.termination_confirmed
    # a later retry that succeeds confirms termination
    backend.failures = 0
    assert orch.stop_and_terminate() is True
    assert orch.termination_confirmed and not orch.reason.startswith(TERMINATE_FAILED)
    # transient failure: retried within the same call
    backend = Stuck(failures=2, steps=3)
    orch, snaps = run_session(backend)
    assert snaps[-1]["mode"] == "terminated" and orch.termination_confirmed


def test_L6_service_shutdown_terminates_running_workers(tmp_path):
    qualify(tmp_path)
    backends = []

    def factory(rid, t):
        backends.append(FakeBackend(steps=100000, step_wall_s=0.01))
        return backends[-1]

    svc = service.LiveService(state_dir=tmp_path, availability_check=available, backend_factory=factory, poll_interval_s=0.01)
    assert svc.launch(guard.slot_estimate_usd())[0]
    deadline = time.time() + 5
    while svc.status()["mode"] != "live" and time.time() < deadline:
        time.sleep(0.01)
    assert svc.shutdown() is True
    assert [w.terminate_calls for w in backends[0].workers] == [1, 1]
    write_ledger(tmp_path)
    accepted, reason = svc.launch(guard.slot_estimate_usd())
    assert not accepted and "shutting down" in reason


def test_L6_launch_during_shutdown_is_refused(tmp_path):
    qualify(tmp_path)

    class SlowTerminate(FakeBackend):
        def terminate(self, w):
            time.sleep(0.3)
            super().terminate(w)

    backends = []
    svc = service.LiveService(state_dir=tmp_path, availability_check=available, poll_interval_s=0.01,
                              backend_factory=lambda rid, t: backends.append(SlowTerminate(steps=10**6)) or backends[-1])
    assert svc.launch(guard.slot_estimate_usd())[0]
    write_ledger(tmp_path)  # even with a freshly reconciled ledger
    stopper = threading.Thread(target=svc.shutdown)
    stopper.start()
    time.sleep(0.1)
    accepted, reason = svc.launch(guard.slot_estimate_usd())
    stopper.join(timeout=10)
    assert not accepted and "shutting down" in reason and len(backends) == 1


# ---------------------------------------------------------------- L7 schema
def test_L7_every_status_snapshot_validates(validator, tmp_path, monkeypatch):
    snaps = []
    for kw in ({}, {"checkpoints": {t: Checkpoint(t, 5.0, "c") for t in ("bean", "triangular")}}):
        snaps += run_session(FakeBackend(steps=3), **kw)[1]
    snaps += run_session(FakeBackend(steps=20, fail={"bean": 2}), saved_run_id="rehearsal-0123456789ab")[1]
    monkeypatch.delenv("MODAL_TOKEN_ID", raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    snaps.append(service.LiveService(state_dir=tmp_path / "none").status())  # unavailable
    state = tmp_path / "q"
    state.mkdir()
    saved = qualify(state)
    snaps += service.load_saved_run(state, saved)["phases"]
    svc = service.LiveService(state_dir=state, availability_check=available, poll_interval_s=0.005,
                              backend_factory=lambda rid, t: FakeBackend(steps=10, step_wall_s=0.02))
    snaps.append(svc.status())  # idle
    accepted, reason = svc.launch(svc.status()["budget"]["slotEstimateUsd"])
    assert accepted, reason
    snaps.append(svc.status())
    svc._thread.join(timeout=10)
    after = svc.status()
    assert after["mode"] == "idle" and after["reason"].startswith("Last session ended")  # relaunch possible once reconciled
    snaps.append(after)
    for s in snaps:
        assert_valid(validator, s)
    assert {s["mode"] for s in snaps} >= {"unavailable", "idle", "launching", "live", "fallback", "terminated"}


# ---------------------------------------------------------------- L8 modal app + GX inputs + backend
def _assigns(tree) -> dict[str, ast.expr]:
    return {t.id: n.value for n in tree.body if isinstance(n, ast.Assign) for t in n.targets if isinstance(t, ast.Name)}


def test_L8_modal_app_defines_guarded_gx_workers_and_is_never_imported():
    src = (LIVE_GX / "modal_app.py").read_text()
    tree = ast.parse(src)
    assert ast.get_docstring(tree).startswith("UNREHEARSED")
    assigns = _assigns(tree)
    lit = {k: ast.literal_eval(v) for k, v in assigns.items() if k in ("GPU", "CPU_PER_WORKER", "MEMORY_MIB_PER_WORKER", "SCALEDOWN_S")}
    assert lit["GPU"] == "A100-40GB"
    assert lit["CPU_PER_WORKER"] == (4.0, 4.0) and lit["MEMORY_MIB_PER_WORKER"] == (16384, 16384)  # request = limit
    assert 2 * lit["CPU_PER_WORKER"][1] == 8 and 2 * lit["MEMORY_MIB_PER_WORKER"][1] == 32 * 1024  # the PRD-priced pair
    assert ast.unparse(assigns["LIVE_TIMEOUT_S"]) == "guard.modal_timeout_s('live')"
    assert ast.unparse(assigns["REHEARSAL_PHASE_TIMEOUT_S"]) == "guard.modal_timeout_s('rehearsal')"
    assert ast.unparse(assigns["STARTUP_TIMEOUT_S"]) == "guard.modal_startup_timeout_s()"
    # no silent degradation: a deploy whose modal cannot take startup_timeout must raise
    guards = [n for n in tree.body if isinstance(n, ast.If) and "'startup_timeout' not in _function_params" in ast.unparse(n.test)]
    assert len(guards) == 1 and "modal.is_local()" in ast.unparse(guards[0].test)
    assert isinstance(guards[0].body[0], ast.Raise) and ast.unparse(guards[0].body[0].exc.func) == "RuntimeError"
    assert "STARTUP" not in assigns and "safe" not in (ast.get_docstring(tree) or "").lower()
    fns = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef) and n.decorator_list}
    assert set(fns) == set(modal_backend.FUNCTION_NAMES.values()) == {"gx_worker_live", "gx_worker_rehearsal"}
    for name, timeout_name in (("gx_worker_live", "LIVE_TIMEOUT_S"), ("gx_worker_rehearsal", "REHEARSAL_PHASE_TIMEOUT_S")):
        deco = fns[name].decorator_list[0]
        assert ast.unparse(deco.func) == "app.function"
        kw = {k.arg: ast.unparse(k.value) for k in deco.keywords}
        assert None not in kw and kw["startup_timeout"] == "STARTUP_TIMEOUT_S"
        assert kw["gpu"] == "GPU" and kw["timeout"] == timeout_name and kw["retries"] == "0" and kw["max_containers"] == "2"
        assert kw["cpu"] == "CPU_PER_WORKER" and kw["memory"] == "MEMORY_MIB_PER_WORKER" and kw["scaledown_window"] == "SCALEDOWN_S"
        assert {"volumes", "image"} <= set(kw)
    assert ".env({'LABYRINTH_GX_REF': GX_REF})" in ast.unparse(tree) and "modal.is_local()" in src
    code_only = ast.unparse(ast.Module(body=tree.body[1:], type_ignores=[]))  # without the docstring
    for banned in ("local_entrypoint", "schedule=", "web_endpoint", "asgi_app", "fastapi_endpoint", "modal.Cron", "modal.Period"):
        assert banned not in code_only  # explicit launch only
    # nothing in main/ or scripts/ imports modal_app; only modal_backend imports modal, inside functions
    for py in list((REPO_ROOT / "main").rglob("*.py")) + list((REPO_ROOT / "scripts").rglob("*.py")):
        if py.name in ("modal_app.py", "test_live_gx.py"):
            continue
        t = ast.parse(py.read_text())
        for node in ast.walk(t):
            names = [a.name for a in node.names] if isinstance(node, (ast.Import, ast.ImportFrom)) else []
            mod = node.module or "" if isinstance(node, ast.ImportFrom) else ""
            assert "modal_app" not in mod and not any("modal_app" in n for n in names), py
            if any(n == "modal" or n.startswith("modal.") for n in names) or mod == "modal" or mod.startswith("modal."):
                assert py.name == "modal_backend.py", py
        if py.name == "modal_backend.py":
            assert not any(isinstance(n, (ast.Import, ast.ImportFrom)) and "modal" in [a.name for a in n.names]
                           for n in t.body)
    code = ("import sys, labyrinth_main.server.app, labyrinth_main.server.__main__, labyrinth_main.build_artifacts, "
            "labyrinth_main.features.live_gx.service, labyrinth_main.features.live_gx.rehearse; "
            "bad = [m for m in sys.modules if m == 'modal' or m.startswith('modal.') or m.endswith('modal_app')]; "
            "print(bad); sys.exit(1 if bad else 0)")
    proc = subprocess.run([sys.executable, "-c", code], cwd=REPO_ROOT / "main", capture_output=True, text=True)
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_L8_modal_startup_plus_execution_never_exceeds_guard_hard_timeout():
    """Real bound: Modal startup_timeout + execution timeout == planned seconds per call <= the hard timeout
    the orchestrator enforces from launch for any approved allocation."""
    startup = guard.modal_startup_timeout_s()
    assert startup == guard.SETUP_MIN * 60
    live = guard.evaluate(guard.Ledger(8.10, 0.0, True))
    assert live.approved and startup + guard.modal_timeout_s("live") == guard.planned_call_s("live") <= live.hard_timeout_s
    assert (startup, guard.modal_timeout_s("live")) == (300, 1200)
    reh = guard.evaluate(guard.Ledger(8.10, 0.0, True), slot_min=pricing.REHEARSAL_H * 60, setups=guard.REHEARSAL_SETUPS)
    phase = int(reh.hard_timeout_s * guard.PHASE_FRACTION)
    assert reh.approved and startup + guard.modal_timeout_s("rehearsal") == guard.planned_call_s("rehearsal") <= phase
    for billed in (0.0, 10.0, 20.0, 30.0, 37.0):  # every approved allocation gets the full planned duration
        d = guard.evaluate(guard.Ledger(billed, 0.0, True))
        if d.approved:
            assert guard.planned_call_s("live") <= d.hard_timeout_s


def test_L8_gx_input_generation_for_both_tubes():
    inputs = gx_input.build_inputs()
    assert set(inputs) == {"bean", "triangular"} and inputs == gx_input.build_inputs()
    iota = gx_input.iota_at(0.64)
    assert 0.85 < iota < 0.95
    tprim, fprim = gx_input.benchmark_gradients()
    assert (tprim, fprim) == (3.0, 1.0)
    for tube, zeta_deg, gpu in (("bean", 0.0, 0), ("triangular", 36.0, 1)):
        text = inputs[tube]
        assert "UNREHEARSED" in text and f"GPU {gpu}" in text
        cfg = tomllib.loads(text)
        geo = cfg["Geometry"]
        assert geo["geo_option"] == "vmec" and geo["torflux"] == 0.64 and geo["npol"] == 1.0
        assert "nperiod" not in cfg["Dimensions"]  # one field-line-length parameter only
        assert geo["alpha"] == pytest.approx(-iota * math.radians(zeta_deg))
        assert cfg["species"]["tprim"] == [tprim] and cfg["species"]["fprim"] == [fprim]
        assert cfg["Physics"]["nonlinear_mode"] is True
        assert (cfg["Dimensions"]["nlaguerre"], cfg["Dimensions"]["nhermite"]) == (4, 8)
        assert cfg["Restart"]["restart"] is False and cfg["Restart"]["save_for_restart"] is True
        assert cfg["Restart"]["nsave"] <= cfg["Diagnostics"]["nwrite"] * 2
    resumed = tomllib.loads(gx_input.build_inputs(restart_from={"bean": gx_input.RESUME_FILE})["bean"])["Restart"]
    assert resumed["restart"] is True and resumed["restart_from_file"] == gx_input.RESUME_FILE
    assert resumed["restart_to_file"] != resumed["restart_from_file"]
    with pytest.raises(ValueError):
        gx_input.render("bean", iota=iota, tprim=3.0, fprim=1.0, vmec_file="w", restart_from="x/a.nc", restart_to="a.nc")
    assert gx_input.IDENTICAL_REFERENCES is True


class _StubCall:
    def __init__(self, kw, log):
        self.kw, self.log = kw, log
        self.result, self.raises, self.cancel_kwargs = None, TimeoutError("still running"), None

    def get(self, timeout=None):
        self.log.append("call.get")
        if self.raises is not None:
            raise self.raises
        return self.result

    def cancel(self, **kw):
        self.log.append("call.cancel")
        self.cancel_kwargs = kw


class _StubDict(dict):
    def __init__(self, log):
        super().__init__()
        self.log, self.hang, self.fail_put = log, False, False

    def get(self, key, default=None):
        self.log.append("dict.get")
        if self.hang:
            time.sleep(1.0)
        return super().get(key, default)

    def __setitem__(self, key, value):
        self.log.append(f"dict.put {key}")
        if self.fail_put:
            raise ConnectionError("Dict unreachable")
        super().__setitem__(key, value)


class _FunctionTimeoutError(TimeoutError):
    pass


_FunctionTimeoutError.__name__ = "FunctionTimeoutError"


@pytest.fixture
def stub_modal(monkeypatch):
    log, spawned, names = [], [], []
    store = _StubDict(log)
    ctl = types.SimpleNamespace(spawn_delay=0.0, spawn_error=None)

    class Fn:
        def spawn(self, **kw):
            time.sleep(ctl.spawn_delay)
            if ctl.spawn_error is not None:
                raise ctl.spawn_error
            spawned.append(_StubCall(kw, log))
            return spawned[-1]

    def from_name(app, name):
        names.append((app, name))
        return Fn()

    stub = types.SimpleNamespace(Function=types.SimpleNamespace(from_name=from_name),
                                 Dict=types.SimpleNamespace(from_name=lambda name, create_if_missing: store),
                                 exception=types.SimpleNamespace(FunctionTimeoutError=_FunctionTimeoutError))
    monkeypatch.setitem(sys.modules, "modal", stub)
    return types.SimpleNamespace(log=log, spawned=spawned, store=store, names=names, ctl=ctl)


def test_L8_modal_backend_launch_poll_terminate_against_stub(stub_modal):
    b = modal_backend.ModalBackend(run_id="r", hard_timeout_s=guard.planned_call_s("live"))
    h = b.launch("triangular", 1, Checkpoint("triangular", 7.0, "r0/triangular.restart.nc"))
    assert stub_modal.names == [("labyrinth-gx", "gx_worker_live")]
    kw = stub_modal.spawned[0].kw
    # the worker gets the EXECUTION budget (from its own start), not the full planned seconds from launch
    assert kw["gpu_index"] == 1 and kw["hard_timeout_s"] == guard.modal_timeout_s("live") == 1200
    assert kw["checkpoint_ref"] == "r0/triangular.restart.nc"
    assert tomllib.loads(kw["input_toml"])["Restart"]["restart_from_file"] == gx_input.RESUME_FILE
    stub_modal.store["r/triangular"] = {"device_id": "GPU-uuid", "state": "running", "sim_time_raw": 9.0,
                                        "samples_raw": [[8.0, 1.0], [9.0, 2.0]]}
    p = b.poll(h)
    assert p["state"] == "running" and p["new_samples_raw"] == [[8.0, 1.0], [9.0, 2.0]]
    assert b.poll(h)["new_samples_raw"] == []
    b.terminate(h)
    assert stub_modal.spawned[0].cancel_kwargs == {"terminate_containers": True}
    # a guard hard timeout shorter than the Modal-enforced cap is refused before any spawn
    short = modal_backend.ModalBackend(run_id="s", hard_timeout_s=guard.planned_call_s("live") - 1)
    with pytest.raises(RuntimeError, match="shorter than the Modal-enforced startup"):
        short.launch("bean", 0, None)
    assert len(stub_modal.spawned) == 1
    assert modal_backend.ModalBackend(run_id="t", hard_timeout_s=2250, kind="rehearsal").function_name == "gx_worker_rehearsal"


def test_L8_modal_backend_polls_call_status_before_progress_dict(stub_modal):
    b = modal_backend.ModalBackend(run_id="r", hard_timeout_s=1500)
    h = b.launch("bean", 0, None)
    call = stub_modal.spawned[0]
    stub_modal.store["r/bean"] = {"device_id": "GPU-a", "state": "running", "sim_time_raw": 2.0, "samples_raw": [[1.0, 1.0], [2.0, 1.0]]}
    stub_modal.log.clear()
    b.poll(h)
    assert stub_modal.log == ["call.get", "dict.get"]
    # call finished; the Dict is stale (no last sample, no checkpoint): the return value wins
    call.raises = None
    call.result = {"device_id": "GPU-a", "state": "done", "sim_time_raw": 3.0,
                   "samples_raw": [[1.0, 1.0], [2.0, 1.0], [3.0, 1.0]], "checkpoint": {"ref": "r/bean.restart.nc", "sim_time_raw": 2.0}}
    stub_modal.log.clear()
    p = b.poll(h)
    assert stub_modal.log == ["call.get"]
    assert p["state"] == "done" and p["new_samples_raw"] == [[3.0, 1.0]] and p["checkpoint"]["sim_time_raw"] == 2.0


def test_L8_modal_backend_function_timeout_and_hung_calls(stub_modal, monkeypatch):
    b = modal_backend.ModalBackend(run_id="r", hard_timeout_s=1500)
    h = b.launch("bean", 0, None)
    stub_modal.spawned[0].raises = _FunctionTimeoutError("function timed out")
    p = b.poll(h)
    assert p["state"] == "failed" and "Modal-enforced hard timeout" in p["error"]
    # a hung client call is bounded locally and raises (the orchestrator then fails the worker and terminates)
    stub_modal.spawned[0].raises = TimeoutError("still running")
    stub_modal.store.hang = True
    monkeypatch.setattr(modal_backend, "CALL_TIMEOUT_S", 0.1)
    t0 = time.time()
    with pytest.raises(modal_backend.CallTimeout):
        b.poll(h)
    assert time.time() - t0 < 0.9
    assert threading.active_count() < 50


def test_L6_late_spawn_is_cancelled_never_orphaned(stub_modal, monkeypatch):
    monkeypatch.setattr(modal_backend, "CALL_TIMEOUT_S", 0.1)
    stub_modal.ctl.spawn_delay = 0.5  # Modal accepts the call AFTER our client-side bound
    planned = guard.planned_call_s("live")
    orch = Orchestrator(modal_backend.ModalBackend(run_id="r", hard_timeout_s=planned), hard_timeout_s=planned,
                        retry_sleep=lambda s: None)
    orch.run(poll_interval_s=0.01)
    snap = orch.snapshot(BUDGET, qualified=False)
    assert snap["mode"] == "fallback" and "launch did not complete in time" in snap["workers"][0]["error"]
    assert snap["reason"].startswith(TERMINATE_PENDING) and "termination pending" in snap["workers"][0]["error"]
    assert not orch.termination_confirmed and stub_modal.spawned == []  # nothing claimed confirmed yet
    assert orch.wait_terminated(3.0)  # the late call arrives and is cancelled immediately
    assert len(stub_modal.spawned) == 1 and stub_modal.spawned[0].cancel_kwargs == {"terminate_containers": True}
    assert orch.termination_confirmed and not orch.reason.startswith((TERMINATE_PENDING, TERMINATE_FAILED))
    assert orch.workers[1].launched is False  # the second spawn never started after the failure


def test_L6_late_spawn_that_errors_settles_as_nothing_started(stub_modal, monkeypatch):
    monkeypatch.setattr(modal_backend, "CALL_TIMEOUT_S", 0.1)
    stub_modal.ctl.spawn_delay, stub_modal.ctl.spawn_error = 0.4, ConnectionError("rejected")
    planned = guard.planned_call_s("live")
    orch = Orchestrator(modal_backend.ModalBackend(run_id="r", hard_timeout_s=planned), hard_timeout_s=planned)
    orch.run(poll_interval_s=0.01)
    assert not orch.termination_confirmed
    assert orch.wait_terminated(3.0) and stub_modal.spawned == []


def test_L6_shutdown_during_in_flight_launch_is_unconfirmed_until_cancelled(stub_modal, monkeypatch, tmp_path):
    monkeypatch.setattr(modal_backend, "CALL_TIMEOUT_S", 0.1)
    stub_modal.ctl.spawn_delay = 1.0
    qualify(tmp_path)
    svc = service.LiveService(state_dir=tmp_path, availability_check=available, poll_interval_s=0.01, join_timeout_s=0.2,
                              backend_factory=lambda rid, t: modal_backend.ModalBackend(run_id=rid, hard_timeout_s=t))
    assert svc.launch(guard.slot_estimate_usd())[0]
    deadline = time.time() + 5
    while svc.status()["mode"] != "fallback":
        assert time.time() < deadline
        time.sleep(0.01)
    assert svc.shutdown() is False  # the spawn is still in flight: never reported as terminated
    st = svc.status()
    assert st["reason"].startswith(TERMINATE_PENDING)
    assert svc.launch(guard.slot_estimate_usd())[0] is False
    assert svc._run.wait_terminated(3.0)
    assert stub_modal.spawned[0].cancel_kwargs == {"terminate_containers": True}
    assert svc.terminate() == (True, "Workers terminated.")


def _modal_app_namespace(*names: str, **module_globals) -> dict:
    """Compile the named top-level helpers out of modal_app.py's AST into a fresh namespace (never imports
    modal_app or modal). `module_globals` stands in for the module globals those helpers read."""
    tree = ast.parse((LIVE_GX / "modal_app.py").read_text())
    fns = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    assert sorted(f.name for f in fns) == sorted(names) and not any(f.decorator_list for f in fns)
    ns: dict = dict(module_globals)
    exec(compile(ast.Module(body=[ast.parse("from __future__ import annotations").body[0], *fns], type_ignores=[]),
                 "modal_app_helper", "exec"), ns)
    return ns


def _modal_app_function(name: str):
    return _modal_app_namespace(name)[name]


def test_L8_read_flux_returns_a_stable_prefix_and_flags_mid_series_nan(tmp_path):
    import netCDF4
    import numpy as np

    read_flux = _modal_app_function("_read_flux")

    def write(path, t, q):
        with netCDF4.Dataset(path, "w") as d:
            g = d.createGroup("Grids")
            g.createDimension("time", len(t))
            g.createVariable("time", "f8", ("time",))[:] = t
            dg = d.createGroup("Diagnostics")
            dg.createDimension("time", len(t))
            dg.createDimension("s", 1)
            dg.createVariable("HeatFlux_st", "f8", ("time", "s"))[:] = np.asarray(q, dtype=float)[:, None]

    write(tmp_path / "a.nc", [1.0, 2.0, 3.0], [5.0, 6.0, np.nan])  # last row still being written
    assert read_flux(str(tmp_path / "a.nc")) == ([[1.0, 5.0], [2.0, 6.0]], None)
    write(tmp_path / "b.nc", [1.0, 2.0, 3.0, 4.0], [5.0, np.nan, 7.0, 8.0])  # a NaN mid-series: stop there, flag it
    samples, problem = read_flux(str(tmp_path / "b.nc"))
    assert samples == [[1.0, 5.0]] and "non-finite heat flux" in problem
    assert read_flux(str(tmp_path / "missing.nc")) == ([], None)

    restart_time = _modal_app_function("_restart_time")
    with netCDF4.Dataset(tmp_path / "r.nc", "w") as d:
        d.createDimension("one", 1)
        d.createVariable("time", "f8", ("one",))[:] = [42.5]
    assert restart_time(str(tmp_path / "r.nc")) == 42.5
    (tmp_path / "torn.nc").write_bytes(b"CDF\x01 truncated")
    assert restart_time(str(tmp_path / "torn.nc")) is None


# ---------------------------------------------------------------- L6 · the rehearse CLI never exits with a spawned call un-cancelled
REHEARSE_HARNESS = r"""
import signal, sys, time, types
from pathlib import Path
signal.signal(signal.SIGINT, signal.default_int_handler)  # start like a foreground terminal session, whatever
signal.signal(signal.SIGTERM, signal.SIG_DFL)             # dispositions the test runner happened to inherit
signal.signal(signal.SIGHUP, signal.SIG_DFL)
log, release = Path(sys.argv[1]), Path(sys.argv[2])
call_timeout, confirm_wait, cost = (float(a) for a in sys.argv[3:6])

def note(text):  # TEST-ONLY: every stubbed Modal call is appended to a file the test reads
    with log.open("a") as f:
        f.write(text + "\n")

class Call:  # stand-in for modal.FunctionCall
    def __init__(self, tube):
        self.tube = tube
    def get(self, timeout=None):
        raise TimeoutError
    def cancel(self, **kw):
        note(f"cancel {self.tube} {sorted(kw.items())}")

class Fn:
    def spawn(self, **kw):
        note(f"spawn-sent {kw['tube']}")      # the RPC has left: from here on a GPU worker may exist
        while not release.exists():           # ... but Modal answers only when the test says so (or never)
            time.sleep(0.01)
        note(f"spawn-returned {kw['tube']}")
        return Call(kw["tube"])

class Progress(dict):  # stand-in for the modal.Dict that holds the run's kill switch
    def __setitem__(self, key, value):
        note(f"kill-switch {key.rsplit('-', 1)[1]}={value}")
        super().__setitem__(key, value)

progress = Progress()
sys.modules["modal"] = types.SimpleNamespace(
    Function=types.SimpleNamespace(from_name=lambda app, name: Fn()),
    Dict=types.SimpleNamespace(from_name=lambda name, create_if_missing: progress),
    exception=types.SimpleNamespace())
from labyrinth_main.features.live_gx import modal_backend, rehearse

modal_backend.CALL_TIMEOUT_S = call_timeout
rehearse.CONFIRM_WAIT_S = confirm_wait
factory = lambda rid, t: modal_backend.ModalBackend(run_id=rid, hard_timeout_s=t, kind="rehearsal")
sys.exit(rehearse.main(["--confirm-cost-usd", str(cost)], availability_check=lambda: (True, "test harness"),
                       backend_factory=factory, poll_interval_s=0.02))
"""
CANCEL_BEAN = "cancel bean [('terminate_containers', True)]"
KILL_SWITCH = "kill-switch init/abort=True"


class _RehearseCli:
    """The rehearse entrypoint in a subprocess, with a TEST-ONLY stub `modal` whose bean spawn RPC stays in
    flight until `release()`. The stub backend is injected through main()'s keyword hooks, which the command
    line cannot reach. Every stubbed Modal call is appended to a log the test reads."""

    def __init__(self, tmp_path, *, call_timeout=modal_backend.CALL_TIMEOUT_S, confirm_wait=30.0):
        self.state, self._log, self._release = tmp_path / "state", tmp_path / "modal-calls.log", tmp_path / "release"
        self.state.mkdir()
        write_ledger(self.state)
        env = {k: v for k, v in os.environ.items() if not k.startswith("MODAL_")}
        env.update(HOME=str(tmp_path), LABYRINTH_STATE_DIR=str(self.state))
        argv = [sys.executable, "-c", REHEARSE_HARNESS, str(self._log), str(self._release), str(call_timeout), str(confirm_wait),
                str(guard.rehearsal_estimate_usd())]
        self.proc = subprocess.Popen(argv, cwd=REPO_ROOT / "main", env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     text=True)

    def log(self) -> list[str]:
        return self._log.read_text().splitlines() if self._log.exists() else []

    def wait_until(self, reached, what: str) -> None:
        deadline = time.time() + 30
        while not reached():
            if self.proc.poll() is not None:
                raise AssertionError(f"exited {self.proc.returncode} before {what}: {self.log()} {self.proc.communicate()}")
            assert time.time() < deadline, f"never reached {what}: {self.log()}"
            time.sleep(0.01)

    def spawn_in_flight(self) -> None:
        self.wait_until(lambda: "spawn-sent bean" in self.log(), "bean's spawn RPC being in flight")

    def waiting_for_queued_cancel(self) -> None:
        # the run record is the last thing run_rehearsal writes: after it only the termination wait is left
        self.wait_until(lambda: any((self.state / "runs").glob("rehearsal-*.json")), "the wait for the queued cancel")

    def send(self, *signals) -> None:
        for sig in signals:
            self.proc.send_signal(sig)

    def release(self) -> None:
        self._release.write_text("Modal answers the spawn now\n")

    def finish(self):
        try:
            out, err = self.proc.communicate(timeout=30)
        finally:
            self.kill()
        return self.proc.returncode, out, err

    def kill(self) -> None:
        if self.proc.poll() is None:
            self.proc.kill()
            self.proc.communicate()


@pytest.fixture
def rehearse_cli(tmp_path):
    started = []

    def start(**kw):
        started.append(_RehearseCli(tmp_path, **kw))
        return started[-1]

    yield start
    for cli in started:
        cli.kill()


@pytest.mark.parametrize("signals", [[signal.SIGINT, signal.SIGTERM], [signal.SIGHUP]], ids=["SIGINT+SIGTERM", "SIGHUP"])
def test_L6_rehearse_cli_signal_during_in_flight_spawn_never_loses_its_handle(signals, rehearse_cli):
    """The signal lands while bean's spawn RPC is in flight. The phases run on the main thread, which is
    also where signals are handled: the spawn's handle must survive, so that the call is cancelled as soon
    as Modal answers, and nothing else may be spawned after the signal. (Two signals back to back, and a
    hangup; SIGINT and SIGTERM on their own are the two tests below.)"""
    cli = rehearse_cli()  # the real client-side bound (20 s): the spawn answers inside it
    cli.spawn_in_flight()
    cli.send(*signals)
    time.sleep(0.1)  # the handler has run; the process must still be there, waiting for its spawn
    assert cli.proc.poll() is None and cli.log() == ["spawn-sent bean"]
    cli.release()
    code, out, err = cli.finish()
    assert code == 2, out + err
    assert cli.log() == ["spawn-sent bean", "spawn-returned bean", KILL_SWITCH, CANCEL_BEAN]  # and triangular never spawned
    assert "phase 1: workers terminated. Stopped on request; workers terminated." in out and "NOT confirmed" not in out + err
    assert "Rehearsal interrupted; nothing qualified." in out and out.rstrip().endswith("Rehearsal did NOT pass; workers terminated.")
    assert not (cli.state / "qualification.json").exists()
    # the reservation stays pending and unreconciled: a human reconciles before the next allocation
    assert service.LedgerStore(cli.state / "ledger.json").load() == guard.Ledger(8.10, guard.rehearsal_estimate_usd(), False)


@pytest.mark.parametrize("sig", [signal.SIGINT, signal.SIGTERM], ids=["SIGINT", "SIGTERM"])
def test_L6_rehearse_cli_signal_then_late_spawn_is_cancelled_on_arrival(sig, rehearse_cli):
    """The spawn outlives its client-side bound after the signal. The process must wait for the late call
    (ignoring further signals: default SIGTERM would kill it here), cancel it, and only then exit."""
    cli = rehearse_cli(call_timeout=0.2)
    cli.spawn_in_flight()
    cli.send(sig)
    cli.waiting_for_queued_cancel()
    assert cli.log() == ["spawn-sent bean", KILL_SWITCH]  # cancel queued, kill switch already up
    cli.send(signal.SIGTERM, signal.SIGINT, signal.SIGHUP)
    time.sleep(0.1)
    assert cli.proc.poll() is None  # still waiting: none of them cut the wait short
    cli.release()
    code, out, err = cli.finish()
    assert code == 2, out + err
    assert cli.log() == ["spawn-sent bean", KILL_SWITCH, "spawn-returned bean", CANCEL_BEAN]
    assert "phase 1: workers terminated." in out and "NOT confirmed" not in out + err
    assert out.rstrip().endswith("Rehearsal did NOT pass; workers terminated.")
    assert not (cli.state / "qualification.json").exists()


@pytest.mark.parametrize("sig", [signal.SIGINT, signal.SIGTERM], ids=["SIGINT", "SIGTERM"])
def test_L6_rehearse_cli_signal_with_a_spawn_that_never_returns_exits_2_unconfirmed(sig, rehearse_cli):
    cli = rehearse_cli(call_timeout=0.2, confirm_wait=0.3)
    cli.spawn_in_flight()
    cli.send(sig)
    code, out, err = cli.finish()  # Modal never answers
    assert code == 2, out + err
    assert cli.log() == ["spawn-sent bean", KILL_SWITCH]  # nothing could be cancelled; the kill switch is up
    line = "phase 1: NOT confirmed terminated — check Modal dashboard. TERMINATION PENDING"
    assert line in out and line in err
    assert out.rstrip().endswith("Rehearsal did NOT pass; workers NOT confirmed terminated — check Modal dashboard.")
    assert "workers terminated" not in out  # termination is never claimed
    assert not (cli.state / "qualification.json").exists()


def test_L6_rehearsal_stop_request_reserves_and_launches_nothing_further(tmp_path):
    est = guard.rehearsal_estimate_usd()
    ledger = service.LedgerStore(tmp_path / "ledger.json")

    def rehearsal(factory, stop, started=None):
        write_ledger(tmp_path)
        return rehearse.run_rehearsal(factory, state_dir=tmp_path, confirm_cost_usd=est, poll_interval_s=0.005,
                                      started=started, stop=stop)

    # requested before the reservation: nothing reserved, no backend built
    stop, backends = rehearse.StopRequest(), []
    stop.set()
    ok, rec = rehearsal(rehearsal_factory(backends), stop)
    assert not ok and "nothing reserved" in rec["reason"] and backends == []
    assert ledger.load() == guard.Ledger(8.10, 0.0, True)

    # requested after the reservation but before phase 1 is registered (a signal handler cannot stop a phase
    # it cannot see yet): the phase is registered, stopped, and spawns nothing
    stop, backends, started = rehearse.StopRequest(), [], []

    def stop_while_building(run_id, timeout):
        stop.set()
        return rehearsal_factory(backends)(run_id, timeout)

    ok, rec = rehearsal(stop_while_building, stop, started)
    assert not ok and len(started) == len(backends) == 1 and backends[0].launch_calls == []
    assert rec["phases"][0]["mode"] == "terminated" and rec["phases"][0]["reason"].startswith("Stopped on request")
    assert ledger.load() == guard.Ledger(8.10, est, False)

    # requested when phase 1 has just finished cleanly: the continuation is never built or launched
    stop, backends, restart_store = rehearse.StopRequest(), [], {}

    class StopsAfterRetrieval(FakeBackend):
        def terminate(self, w):
            super().terminate(w)
            stop.set()

    def factory(run_id, timeout):
        backends.append(StopsAfterRetrieval(steps=3, restart_store=restart_store))
        return backends[-1]

    ok, rec = rehearsal(factory, stop)
    assert not ok and len(backends) == 1 and len(rec["phases"]) == 1
    assert rec["checks"]["init"] is True and rec["checks"]["continuation"] is False
    assert service.load_qualification(tmp_path) is None


def test_L6_rehearse_cli_cannot_reach_the_test_hooks_and_is_inert_without_credentials(tmp_path, monkeypatch, capsys):
    src = (LIVE_GX / "rehearse.py").read_text()
    tree = ast.parse(src)
    options = [ast.literal_eval(n.args[0]) for n in ast.walk(tree)
               if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "add_argument"]
    assert options == ["--confirm-cost-usd"]  # the only switch
    assert ast.unparse(tree.body[-1]) == "if __name__ == '__main__':\n    sys.exit(main())"  # hooks never passed
    main_fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
    assert [a.arg for a in main_fn.args.args] == ["argv"]
    assert {a.arg for a in main_fn.args.kwonlyargs} == {"availability_check", "backend_factory", "poll_interval_s"}
    assert "fake_backend" not in src and "environ" not in src and "getenv" not in src  # no hidden selector
    for k in ("MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET", "MODAL_CONFIG_PATH"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("LABYRINTH_STATE_DIR", str(tmp_path / "state"))
    for argv in (["--backend", "fake"], ["--fake"], ["--poll-interval-s", "0.01"], ["--confirm-cost-usd", "7.73", "fake"]):
        with pytest.raises(SystemExit) as e:
            rehearse.main(argv)
        assert e.value.code == 2, argv
    capsys.readouterr()
    assert rehearse.main([]) == 0 and "Nothing launched" in capsys.readouterr().out
    assert rehearse.main(["--confirm-cost-usd", str(guard.rehearsal_estimate_usd())]) == 2  # no credentials, no modal
    assert "Live GX unavailable" in capsys.readouterr().err
    assert not (tmp_path / "state").exists() and "modal" not in sys.modules  # nothing reserved, nothing imported


def test_L6_rehearse_cli_in_process_pass_and_crash_paths(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("LABYRINTH_STATE_DIR", str(tmp_path))
    cost = ["--confirm-cost-usd", str(guard.rehearsal_estimate_usd())]
    before = {s: signal.getsignal(s) for s in rehearse.STOP_SIGNALS}
    signal.signal(signal.SIGHUP, signal.SIG_IGN)  # as under nohup
    try:
        backends, during = [], []
        fake = rehearsal_factory(backends)

        def good(run_id, timeout):
            during.append({s: signal.getsignal(s) for s in rehearse.STOP_SIGNALS})
            return fake(run_id, timeout)

        write_ledger(tmp_path)
        assert rehearse.main(cost, availability_check=available, backend_factory=good, poll_interval_s=0.005) == 0
        out, err = capsys.readouterr()
        assert out.rstrip().endswith("Rehearsal PASSED; workers terminated.") and "phase 2: workers terminated." in out
        assert service.load_qualification(tmp_path) is not None and "interrupted" not in out
        # while it runs, SIGINT and SIGTERM request a cooperative stop; a hangup that was ignored stays ignored
        assert callable(during[0][signal.SIGINT]) and during[0][signal.SIGINT] is during[0][signal.SIGTERM]
        assert during[0][signal.SIGINT] is not signal.default_int_handler and during[0][signal.SIGHUP] is signal.SIG_IGN
        assert {s: signal.getsignal(s) for s in rehearse.STOP_SIGNALS} == {**before, signal.SIGHUP: signal.SIG_IGN}

        def crashing(run_id, timeout):
            if run_id.endswith("-cont"):
                raise RuntimeError("factory exploded")
            return fake(run_id, timeout)

        write_ledger(tmp_path)
        (tmp_path / "qualification.json").unlink()
        del backends[:]
        assert rehearse.main(cost, availability_check=available, backend_factory=crashing, poll_interval_s=0.005) == 2
        out, err = capsys.readouterr()
        assert "Rehearsal crashed" in err and "factory exploded" in err
        assert "phase 1: workers terminated." in out and out.rstrip().endswith("Rehearsal did NOT pass; workers terminated.")
        assert [w.terminate_calls for w in backends[0].workers] == [1, 1] and service.load_qualification(tmp_path) is None
    finally:
        signal.signal(signal.SIGHUP, before[signal.SIGHUP])
    assert {s: signal.getsignal(s) for s in rehearse.STOP_SIGNALS} == before


def test_L6_rehearse_cli_ctrl_c_with_both_workers_running_terminates_both(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("LABYRINTH_STATE_DIR", str(tmp_path))
    write_ledger(tmp_path)
    backends = []

    class CtrlC(FakeBackend):  # the operator presses Ctrl-C (once) as soon as both workers are running
        pressed = False

        def poll(self, w):
            result = super().poll(w)
            if not self.pressed and len(self.workers) == 2 and all(x.state == "running" for x in self.workers):
                self.pressed = True
                signal.raise_signal(signal.SIGINT)
            return result

    def factory(run_id, timeout):
        backends.append(CtrlC(steps=10**6, step_wall_s=0.01))
        return backends[-1]

    previous = signal.signal(signal.SIGINT, signal.default_int_handler)  # as in a foreground terminal session
    try:
        code = rehearse.main(["--confirm-cost-usd", str(guard.rehearsal_estimate_usd())], availability_check=available,
                             backend_factory=factory, poll_interval_s=0.005)
    except KeyboardInterrupt:
        pytest.fail("SIGINT was raised into the thread that owns the spawn handles instead of requesting a cooperative stop")
    finally:
        signal.signal(signal.SIGINT, previous or signal.default_int_handler)
    out, _ = capsys.readouterr()
    assert code == 2 and len(backends) == 1 and backends[0].pressed
    assert [w.terminate_calls for w in backends[0].workers] == [1, 1] and not any(w.thread.is_alive() for w in backends[0].workers)
    assert "phase 1: workers terminated. Stopped on request; workers terminated." in out
    assert "Rehearsal interrupted; nothing qualified." in out and service.load_qualification(tmp_path) is None


# ---------------------------------------------------------------- L8 · modal_app refuses a deploy that would lose startup_timeout
MODAL_APP_HARNESS = r"""
import json, os, runpy, sys, types

def accepting(registered):  # this modal's App.function takes startup_timeout
    def function(self, *, image=None, gpu=None, cpu=None, memory=None, timeout=None, retries=None, max_containers=None,
                 scaledown_window=None, volumes=None, startup_timeout=None):
        kw = dict(gpu=gpu, cpu=cpu, memory=memory, timeout=timeout, retries=retries, max_containers=max_containers,
                  scaledown_window=scaledown_window, volumes=sorted(volumes), startup_timeout=startup_timeout)
        return lambda fn: registered.__setitem__(fn.__name__, kw) or fn
    return function

def without(registered):  # an older modal: no such parameter (the decorator call itself would be a TypeError)
    def function(self, *, image=None, gpu=None, cpu=None, memory=None, timeout=None, retries=None, max_containers=None,
                 scaledown_window=None, volumes=None):
        return lambda fn: registered.__setitem__(fn.__name__, {"startup_timeout": "LOST"}) or fn
    return function

def kwargs_only(registered):  # would swallow the argument without anyone noticing
    def function(self, **kw):
        return lambda fn: registered.__setitem__(fn.__name__, {"startup_timeout": kw.get("startup_timeout")}) or fn
    return function

def unsignable(registered):  # inspect.signature() cannot describe it
    class Function:
        __signature__ = 42
        def __call__(self, **kw):
            return lambda fn: registered.__setitem__(fn.__name__, {"startup_timeout": kw.get("startup_timeout")}) or fn
    return Function()

def deploy(make_function, *, is_local=True, gx_ref="0123abc"):
    registered, dicts, volumes = {}, [], []
    class Image:  # modal.Image.from_registry(...).apt_install(...).pip_install(...).env(...) ...
        def __getattr__(self, name):
            return lambda *a, **k: self
    class App:
        def __init__(self, name):
            self.name = name
    App.function = make_function(registered)
    modal = types.ModuleType("modal")  # TEST-ONLY stub: the real package is never installed or imported
    modal.is_local = lambda: is_local
    modal.Image, modal.App = Image(), App
    modal.Volume = types.SimpleNamespace(from_name=lambda name, **kw: volumes.append(name) or object())
    modal.Dict = types.SimpleNamespace(from_name=lambda name, **kw: dicts.append(name) or {})
    sys.modules["modal"] = modal
    os.environ.pop("LABYRINTH_GX_REF", None)
    if gx_ref:
        os.environ["LABYRINTH_GX_REF"] = gx_ref
    error = None
    try:
        runpy.run_module("labyrinth_main.features.live_gx.modal_app", run_name="modal_app_under_test")
    except BaseException as e:
        error = [type(e).__name__, str(e)]
    return {"error": error, "registered": registered, "dicts": dicts, "volumes": volumes}

print(json.dumps({
    "accepting": deploy(accepting),
    "without": deploy(without),
    "kwargs-only": deploy(kwargs_only),
    "unsignable": deploy(unsignable),
    "in-container": deploy(kwargs_only, is_local=False, gx_ref=""),
    "no-gx-ref": deploy(accepting, gx_ref=""),
}))
"""


def test_L8_modal_app_refuses_to_deploy_when_startup_timeout_is_not_accepted():
    """Executes modal_app.py in a subprocess against a stub `modal` (the real package is never needed)."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("MODAL_")}
    proc = subprocess.run([sys.executable, "-c", MODAL_APP_HARNESS], cwd=REPO_ROOT / "main", env=env, capture_output=True,
                          text=True, timeout=120)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    r = json.loads(proc.stdout.splitlines()[-1])
    names = set(modal_backend.FUNCTION_NAMES.values())
    ok = r["accepting"]
    assert ok["error"] is None and set(ok["registered"]) == names
    assert ok["dicts"] == [modal_backend.PROGRESS_DICT] and ok["volumes"] == [modal_backend.CHECKPOINT_VOLUME]
    for kind, name in modal_backend.FUNCTION_NAMES.items():
        kw = ok["registered"][name]
        assert kw["startup_timeout"] == guard.modal_startup_timeout_s() == 300
        assert kw["timeout"] == guard.modal_timeout_s(kind) and kw["startup_timeout"] + kw["timeout"] == guard.planned_call_s(kind)
        assert (kw["gpu"], kw["retries"], kw["max_containers"], kw["scaledown_window"]) == ("A100-40GB", 0, 2, 2)
        assert (kw["cpu"], kw["memory"], kw["volumes"]) == ([4.0, 4.0], [16384, 16384], ["/ckpt"])
    for variant in ("without", "kwargs-only", "unsignable"):
        bad = r[variant]
        assert bad["error"] is not None and bad["error"][0] == "RuntimeError" and "startup_timeout" in bad["error"][1], (variant, bad)
        assert bad["registered"] == {}, variant  # refused BEFORE any GPU function is registered
    # inside the container (not a deploy) the same module still imports and defines both functions
    assert r["in-container"]["error"] is None and set(r["in-container"]["registered"]) == names
    # and a deploy without a pinned GX commit is refused as well
    assert r["no-gx-ref"]["error"][0] == "RuntimeError" and "LABYRINTH_GX_REF" in r["no-gx-ref"]["error"][1]
    assert r["no-gx-ref"]["registered"] == {}


# ---------------------------------------------------------------- L6 · run-level kill switch progress["<run_id>/abort"]
class _KillSwitchDict(dict):
    """Stub for the Modal progress Dict. Counts every read of the run's kill switch and can raise the switch
    after a given number of reads, as ModalBackend.terminate() would from the operator's machine."""

    def __init__(self, run_id: str, raise_after_reads: int | None = None):
        super().__init__()
        self.key, self.raise_after_reads, self.abort_reads = modal_backend.abort_key(run_id), raise_after_reads, 0

    def get(self, key, default=None):
        if key == self.key:
            self.abort_reads += 1
            if self.raise_after_reads is not None and self.abort_reads > self.raise_after_reads:
                self[self.key] = True
        return super().get(key, default)


@pytest.fixture
def gx_container(tmp_path, monkeypatch):
    """A stand-in for the worker container: fake `nvidia-smi` and `gx` executables on PATH (`gx` records its
    pid, then just keeps running) and modal_app._worker compiled from the AST against temp directories."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in (("nvidia-smi", "echo GPU-TEST-0000"), ("gx", "echo $$ > gx.pid\nexec sleep 120")):
        (bin_dir / name).write_text(f"#!/bin/sh\n{body}\n")
        (bin_dir / name).chmod(0o755)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    (tmp_path / "REVISION").write_text("0123abc\n")
    flux_reads: list[str] = []

    def read_flux(out_nc):  # called once per loop iteration and once after the loop
        flux_reads.append(out_nc)
        assert len(flux_reads) < 50, "the worker loop ignored the kill switch"
        pid_file, deadline = Path(out_nc).parent / "gx.pid", time.time() + 10
        while not (pid_file.exists() and pid_file.read_text().strip()):  # GX is really running before the test goes on
            assert time.time() < deadline
            time.sleep(0.005)
        return [], None

    def worker(progress):
        ns = _modal_app_namespace(
            "_aborted", "_restart_time", "_worker", progress=progress, abort_key=modal_backend.abort_key,
            checkpoints=types.SimpleNamespace(reload=lambda: None, commit=lambda: None), RESUME_FILE=gx_input.RESUME_FILE,
            CHECKPOINT_MARGIN_S=60, POLL_S=0.02, WORK_ROOT=str(tmp_path / "work"), CKPT_MOUNT=str(tmp_path / "ckpt"),
            GX_REVISION_FILE=str(tmp_path / "REVISION"), _read_flux=read_flux)
        return ns["_worker"]

    return types.SimpleNamespace(worker=worker, flux_reads=flux_reads, work=tmp_path / "work")


def test_L6_worker_kill_switch_set_before_start_never_starts_gx(gx_container):
    progress = _KillSwitchDict("run-1")
    progress[progress.key] = True
    state = gx_container.worker(progress)(tube="bean", gpu_index=0, progress_key="run-1/bean", input_toml="# test",
                                          checkpoint_ref=None, hard_timeout_s=1200)
    assert state["state"] == "failed" and state["error"] == "aborted by the run's kill switch before start"
    assert state["wall_end"] is not None and progress["run-1/bean"] == state
    assert progress.abort_reads == 1 and gx_container.flux_reads == []
    assert not (gx_container.work / "run-1_bean" / "gx.pid").exists()  # GX was never started


def test_L6_worker_checks_the_kill_switch_on_every_loop_iteration_and_stops_gx(gx_container):
    progress = _KillSwitchDict("run-1", raise_after_reads=3)  # clear at start and for two loop iterations, then raised
    state = gx_container.worker(progress)(tube="bean", gpu_index=0, progress_key="run-1/bean", input_toml="# test",
                                          checkpoint_ref=None, hard_timeout_s=1200)
    pid = int((gx_container.work / "run-1_bean" / "gx.pid").read_text())
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)  # GX was stopped and reaped, not left running on the GPU
    assert state["state"] == "failed" and state["error"] == "aborted by the run's kill switch"  # returned, not raised
    assert (state["device_id"], state["solver_revision"]) == ("GPU-TEST-0000", "GX 0123abc")
    assert state["wall_end"] is not None and progress["run-1/bean"] == state
    # one check at start and one per iteration: the 4th read saw the switch, so exactly two iterations ran in full
    assert progress.abort_reads == 4 and len(gx_container.flux_reads) == 2 + 1


def test_L6_kill_switch_key_is_shared_by_backend_and_worker(stub_modal, gx_container):
    planned = guard.planned_call_s("live")
    b = modal_backend.ModalBackend(run_id="run-9", hard_timeout_s=planned)
    h = b.launch("bean", 0, None)
    assert modal_backend.abort_key("run-9") == "run-9/abort" not in stub_modal.store
    stub_modal.log.clear()
    b.terminate(h)
    assert stub_modal.log == ["dict.put run-9/abort", "call.cancel"]  # the kill switch first, then the cancel
    assert stub_modal.store["run-9/abort"] is True
    # a worker of that run reads the very key the backend wrote, so it stops before starting GX
    state = gx_container.worker(stub_modal.store)(tube="triangular", gpu_index=1, progress_key="run-9/triangular",
                                                  input_toml="# test", checkpoint_ref=None, hard_timeout_s=1200)
    assert state["error"] == "aborted by the run's kill switch before start"
    assert not (gx_container.work / "run-9_triangular" / "gx.pid").exists()
    # other runs are untouched, and a failed lookup is not an abort (the worker keeps its own deadline)
    aborted = _modal_app_namespace("_aborted", progress=stub_modal.store, abort_key=modal_backend.abort_key)["_aborted"]
    assert aborted("run-9/bean") is True and aborted("run-10/bean") is False

    class Unreachable(dict):
        def get(self, key, default=None):
            raise ConnectionError("Dict unreachable")

    assert _modal_app_namespace("_aborted", progress=Unreachable(), abort_key=modal_backend.abort_key)["_aborted"]("run-9/bean") is False
    # the switch is best effort for a call that can be cancelled: a failed put does not stop the cancel
    b2 = modal_backend.ModalBackend(run_id="run-11", hard_timeout_s=planned)
    h2 = b2.launch("bean", 0, None)
    stub_modal.store.fail_put = True
    b2.terminate(h2)
    assert stub_modal.spawned[-1].cancel_kwargs == {"terminate_containers": True} and "run-11/abort" not in stub_modal.store


def test_L6_spawn_that_fails_client_side_raises_the_kill_switch_or_is_never_reported_terminated(stub_modal):
    """A spawn RPC that errors on the client may still have started a worker, and there is no call to cancel.
    The run's kill switch is the only stop: it is raised, or the session stays unconfirmed (TERMINATE FAILED)."""
    planned = guard.planned_call_s("live")
    stub_modal.ctl.spawn_error = ConnectionError("stream reset after send")
    orch = Orchestrator(modal_backend.ModalBackend(run_id="r", hard_timeout_s=planned), hard_timeout_s=planned,
                        retry_sleep=lambda s: None)
    orch.run(poll_interval_s=0.01)
    snap = orch.snapshot(BUDGET, qualified=False)
    assert snap["mode"] == "fallback" and snap["fallback"]["label"] == FAILED_LABEL
    assert snap["workers"][0]["error"].startswith("launch failed client-side (ConnectionError: stream reset after send) and a worker "
                                                  "may have started")
    assert stub_modal.store["r/abort"] is True and orch.termination_confirmed
    assert orch.workers[1].launched is False and len(stub_modal.names) == 1  # triangular was never attempted
    # the kill switch cannot be raised either: retried with backoff, then loud, and a later retry confirms
    stub_modal.store.fail_put = True
    sleeps = []
    orch = Orchestrator(modal_backend.ModalBackend(run_id="s", hard_timeout_s=planned), hard_timeout_s=planned,
                        retry_sleep=sleeps.append)
    orch.run(poll_interval_s=0.01)
    assert not orch.termination_confirmed and orch.reason.startswith(TERMINATE_FAILED)
    assert "kill switch could not be set" in orch.reason and sleeps[:len(TERMINATE_BACKOFF_S)] == list(TERMINATE_BACKOFF_S)
    assert "s/abort" not in stub_modal.store
    stub_modal.store.fail_put = False
    assert orch.stop_and_terminate() is True and stub_modal.store["s/abort"] is True
    # the in-flight spawn state: nothing to cancel yet, but the switch is already up
    stub_modal.ctl.spawn_error, stub_modal.ctl.spawn_delay = None, 0.3
    b = modal_backend.ModalBackend(run_id="t", hard_timeout_s=planned)
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(modal_backend, "CALL_TIMEOUT_S", 0.05)
        with pytest.raises(LaunchInFlight) as in_flight:
            b.launch("bean", 0, None)
    with pytest.raises(TerminationPending):
        b.terminate(in_flight.value.handle)
    assert stub_modal.store["t/abort"] is True and stub_modal.spawned == []
    assert in_flight.value.handle.spawn_done.wait(3.0)  # let the late call arrive and be cancelled before the stub goes away
    deadline = time.time() + 3
    while not stub_modal.spawned or stub_modal.spawned[0].cancel_kwargs is None:
        assert time.time() < deadline
        time.sleep(0.01)


# ---------------------------------------------------------------- L3 · hard timeout on the monotonic clock
@pytest.mark.parametrize("jump_s", [-3600.0, 3600.0], ids=["wall-clock-jumps-back", "wall-clock-jumps-forward"])
def test_L3_hard_timeout_fires_on_schedule_despite_a_wall_clock_jump(jump_s, monkeypatch):
    defaults = inspect.signature(Orchestrator.__init__).parameters
    assert defaults["monotonic"].default is time.monotonic and defaults["clock"].default is time.time

    class Clocks:
        mono, wall, sleeps = 5000.0, 1.8e9, 0

        def sleep(self, dt):
            self.sleeps += 1
            assert self.sleeps <= 60, "the hard timeout never fired"
            self.mono += dt
            self.wall += dt
            if self.sleeps == 3:
                self.wall += jump_s  # NTP step, operator, suspend/resume

    c = Clocks()
    monkeypatch.setattr(time, "time", lambda: c.wall)  # every wall-clock reader sees the jump, injected or not
    backend = FakeBackend(steps=10**6, step_wall_s=0.01)
    orch = Orchestrator(backend, hard_timeout_s=10, clock=time.time, monotonic=lambda: c.mono, sleep=c.sleep,
                        retry_sleep=lambda s: None)
    orch.run(poll_interval_s=1.0)
    snap = orch.snapshot(BUDGET, qualified=False)
    assert snap["mode"] == "fallback" and snap["reason"].startswith("Hard timeout reached: 10 s elapsed")
    assert c.sleeps == 10  # exactly 10 one-second polls: not after 3 (forward jump), not never (backward jump)
    assert snap["provenance"]["runtime"] == "10.0 s wall" and snap["fallback"]["label"] == TIMEOUT_LABEL
    assert [w.terminate_calls for w in backend.workers] == [1, 1]


# ---------------------------------------------------------------- L6 · the operator note on a hung spawn RPC matches the code
def test_L6_hung_spawn_operator_note_matches_the_code():
    """Behaviour itself: test_server.py::test_H5_terminate_while_a_spawn_rpc_hangs_answers_502_termination_pending,
    ::test_H1_shutdown_during_in_flight_launch and the rehearse CLI tests above. This pins the note's wording to it."""
    from labyrinth_main.server import __main__ as server_main

    note = " ".join(service.__doc__.split("Operator note")[1].split())
    assert "wait up to WORST_CASE_STOP_S + 10 s" in note and "exit with code 2" in note
    assert inspect.signature(service.LiveService.__init__).parameters["join_timeout_s"].default == service.WORST_CASE_STOP_S + 10
    assert rehearse.CONFIRM_WAIT_S == service.WORST_CASE_STOP_S + 10
    for quoted, emitted in (("TERMINATION PENDING", TERMINATE_PENDING), ("TERMINATE FAILED", TERMINATE_FAILED)):
        assert f'"{quoted}"' in note and emitted.startswith(quoted)
    message = "NOT confirmed terminated — check Modal"
    assert f'"{message}"' in note and message in inspect.getsource(server_main) and message in inspect.getsource(rehearse)
    assert "answers 502" in note and "200 if confirmed else 502" in (REPO_ROOT / "main/labyrinth_main/server/app.py").read_text()
    assert f"`{modal_backend.APP_NAME}`" in note
    assert "(SIGINT, SIGTERM, SIGHUP)" in note
    assert rehearse.STOP_SIGNALS == server_main.STOP_SIGNALS == (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)


def test_L6_worst_case_stop_bound_counts_every_bounded_modal_call(stub_modal, monkeypatch):
    calls, real = [], modal_backend.bounded
    monkeypatch.setattr(modal_backend, "bounded", lambda fn, what, timeout_s=None: calls.append(what) or real(fn, what, timeout_s))
    b = modal_backend.ModalBackend(run_id="r", hard_timeout_s=guard.planned_call_s("live"))
    h = b.launch("bean", 0, None)
    launch = len(calls) + 1  # + Function.spawn itself, bounded by the spawn_done wait
    del calls[:]
    b.poll(h)
    poll = len(calls)
    del calls[:]
    b.terminate(h)
    terminate = len(calls)
    assert (launch, poll, terminate) == (modal_backend.LAUNCH_CALLS, modal_backend.POLL_CALLS, modal_backend.TERMINATE_CALLS)
    per_call, workers = modal_backend.CALL_TIMEOUT_S, len(Orchestrator(b, hard_timeout_s=1).workers)
    in_flight = max(launch, workers * poll) * per_call + service.POLL_INTERVAL_S  # one launch, or one poll round + its sleep
    terminating = workers * (sum(TERMINATE_BACKOFF_S) + (1 + len(TERMINATE_BACKOFF_S)) * terminate * per_call)
    assert service.WORST_CASE_STOP_S == in_flight + terminating == 497.0
    assert inspect.signature(service.LiveService.__init__).parameters["poll_interval_s"].default == service.POLL_INTERVAL_S
