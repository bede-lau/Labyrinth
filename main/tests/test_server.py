"""Task 07 · main-process HTTP API. Real servers on ephemeral ports; no network beyond loopback."""
from __future__ import annotations

import ast
import http.client
import json
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from labyrinth_main import __version__
from labyrinth_main.common.paths import CONTRACTS, REPO_ROOT
from labyrinth_main.features.live_gx import budget_guard as guard
from labyrinth_main.features.live_gx import rehearse, service
from labyrinth_main.features.live_gx.fake_backend import FakeBackend
from labyrinth_main.features.live_gx.orchestrator import NO_REHEARSAL_LABEL
from labyrinth_main.server import __main__ as server_main
from labyrinth_main.server.app import DEFAULT_HOST, DEFAULT_PORT, make_server

SERVER_PKG = REPO_ROOT / "main" / "labyrinth_main" / "server"


@pytest.fixture(scope="module")
def validator():
    resources = []
    for p in CONTRACTS.glob("*.schema.json"):
        schema = json.loads(p.read_text())
        res = Resource.from_contents(schema)
        resources += [(p.name, res), (schema["$id"], res)]
    return Draft202012Validator(json.loads((CONTRACTS / "live-status.schema.json").read_text()),
                                registry=Registry().with_resources(resources))


def assert_valid(validator, snap):
    errors = [f"{e.json_path}: {e.message}" for e in validator.iter_errors(snap)]
    assert not errors, errors


@pytest.fixture
def no_modal_env(monkeypatch, tmp_path):
    for k in ("MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET", "MODAL_CONFIG_PATH"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("LABYRINTH_STATE_DIR", str(tmp_path / "state"))
    return tmp_path


def serve(svc: service.LiveService):
    srv = make_server(0, service=svc, stream_interval_s=0.05)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def qualify(state_dir: Path) -> str:
    """Genuine qualification + saved run via the fake rehearsal; then a reconciled ledger."""
    store = service.LedgerStore(state_dir / "ledger.json")
    store.save(guard.Ledger(8.10, 0.0, True))
    restart_store: dict = {}
    ok, rec = rehearse.run_rehearsal(lambda rid, t: FakeBackend(steps=3, restart_store=restart_store), state_dir=state_dir,
                                     confirm_cost_usd=guard.rehearsal_estimate_usd(), poll_interval_s=0.005)
    assert ok, rec
    store.save(guard.Ledger(8.10, 0.0, True))
    return rec["savedRunId"]


@pytest.fixture
def default_server(no_modal_env):
    srv = serve(service.LiveService())
    yield srv.server_address[1]
    srv.shutdown()
    srv.server_close()


@pytest.fixture
def armed_server(tmp_path):
    """Qualified + credentials forced + reconciled ledger + TEST-ONLY fake backend (never used by the real server)."""
    state = tmp_path / "armed"
    state.mkdir()
    qualify(state)
    backends = []

    def factory(run_id, timeout):
        backends.append(FakeBackend(steps=200, step_wall_s=0.02))
        return backends[-1]

    svc = service.LiveService(state_dir=state, availability_check=lambda: (True, "test"), backend_factory=factory,
                              poll_interval_s=0.01)
    srv = serve(svc)
    yield srv.server_address[1], svc, backends, state
    svc.terminate()
    srv.shutdown()
    srv.server_close()


def request(port, method, path, body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    hdrs = {"Content-Type": "application/json"} if body is not None else {}
    hdrs.update(headers or {})
    conn.request(method, path, body=None if body is None else (body if isinstance(body, (bytes, str)) else json.dumps(body)),
                 headers=hdrs)
    r = conn.getresponse()
    data = r.read()
    conn.close()
    return r.status, dict(r.getheaders()), data


def get_json(port, path):
    status, headers, data = request(port, "GET", path)
    return status, headers, json.loads(data)


# ---------------------------------------------------------------- H1
def test_H1_module_entrypoint_serves_on_loopback_default_8787_stdlib_only(tmp_path):
    args = server_main.parse_args([])
    assert (DEFAULT_HOST, DEFAULT_PORT, args.port) == ("127.0.0.1", 8787, 8787)
    env = {k: v for k, v in os.environ.items() if not k.startswith("MODAL_")}
    env.update(HOME=str(tmp_path), LABYRINTH_STATE_DIR=str(tmp_path / "state"))
    proc = subprocess.Popen([sys.executable, "-m", "labyrinth_main.server", "--port", "0"], cwd=REPO_ROOT / "main",
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        line = proc.stdout.readline()
        assert line.startswith("Labyrinth API listening on http://127.0.0.1:"), line + proc.stderr.read()
        port = int(line.rsplit(":", 1)[1])
        status, _, body = get_json(port, "/api/health")
        assert status == 200 and body["ok"] is True
    finally:
        proc.terminate()
        proc.wait(timeout=10)
    for py in SERVER_PKG.glob("*.py"):
        for node in ast.walk(ast.parse(py.read_text())):
            if isinstance(node, ast.Import):
                mods = [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0:
                mods = [node.module.split(".")[0]]
            else:
                continue
            assert all(m in sys.stdlib_module_names or m == "labyrinth_main" for m in mods), (py, mods)


# ---------------------------------------------------------------- H2
def test_H2_health(default_server):
    status, headers, body = get_json(default_server, "/api/health")
    assert status == 200 and body == {"ok": True, "version": __version__}
    assert headers["Content-Type"] == "application/json"


# ---------------------------------------------------------------- H3
def test_H3_live_status_is_schema_valid_and_unavailable_without_credentials(default_server, validator):
    status, _, body = get_json(default_server, "/api/live/status")
    assert status == 200
    assert_valid(validator, body)
    assert body["mode"] == "unavailable" and "no Modal credentials" in body["reason"]
    assert body["fallback"]["active"] is True and body["fallback"]["savedRunId"] is None


# ---------------------------------------------------------------- H4
def test_H4_stream_is_server_sent_events_of_status_snapshots(default_server, validator):
    conn = http.client.HTTPConnection("127.0.0.1", default_server, timeout=10)
    conn.request("GET", "/api/live/stream")
    r = conn.getresponse()
    assert r.status == 200 and r.getheader("Content-Type") == "text/event-stream"
    events = []
    while len(events) < 2:
        line = r.fp.readline().decode()
        assert line.startswith("data: ") and line.endswith("\n"), line
        assert r.fp.readline() == b"\n"
        events.append(json.loads(line[len("data: "):]))
    conn.close()
    for e in events:
        assert_valid(validator, e)
        assert e["mode"] == "unavailable"


def test_H4_concurrent_streams_are_capped(no_modal_env):
    srv = make_server(0, service=service.LiveService(), stream_interval_s=0.05, max_streams=2)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port, conns = srv.server_address[1], []
    try:
        for _ in range(2):
            c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
            c.request("GET", "/api/live/stream")
            r = c.getresponse()
            assert r.status == 200 and r.fp.readline().startswith(b"data: ")
            conns.append(c)
        assert request(port, "GET", "/api/live/stream")[0] == 503
        conns.pop().close()
        deadline = time.time() + 5
        while request(port, "GET", "/api/health")[0] == 200 and time.time() < deadline:
            c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
            c.request("GET", "/api/live/stream")
            r = c.getresponse()
            if r.status == 200:  # the slot was released once the closed stream's next write failed
                conns.append(c)
                break
            c.close()
            time.sleep(0.05)
        else:
            raise AssertionError("stream slot never released")
    finally:
        for c in conns:
            c.close()
        srv.shutdown()
        srv.server_close()


# ---------------------------------------------------------------- H5
def test_H5_launch_refused_without_credentials_even_with_correct_cost(default_server, no_modal_env):
    _, _, st = get_json(default_server, "/api/live/status")
    status, _, data = request(default_server, "POST", "/api/live/launch", {"confirmCostUsd": st["budget"]["slotEstimateUsd"]})
    body = json.loads(data)
    assert status == 409 and "unavailable" in body["reason"]
    assert not (no_modal_env / "state" / "ledger.json").exists()
    status, _, data = request(default_server, "POST", "/api/live/terminate", {})
    assert status == 200 and json.loads(data)["ok"] is True


def test_H5_launch_requires_exact_confirmed_cost_and_passing_guard(armed_server, validator):
    port, svc, backends, state = armed_server
    _, _, st = get_json(port, "/api/live/status")
    assert st["mode"] == "idle" and st["budget"]["slotFits"] is True
    est = st["budget"]["slotEstimateUsd"]
    for bad in ({}, {"confirmCostUsd": est - 0.01}, {"confirmCostUsd": est + 0.01}, {"confirmCostUsd": str(est)},
                {"confirmCostUsd": True}, "not json"):
        status, _, data = request(port, "POST", "/api/live/launch", bad)
        assert status == 409 and json.loads(data)["reason"].startswith("launch refused"), bad
    status, _, data = request(port, "POST", "/api/live/launch", json.dumps({"confirmCostUsd": est}),
                              headers={"Content-Type": "text/plain"})
    assert status == 409 and "Content-Type" in json.loads(data)["reason"]
    assert backends == []
    status, _, data = request(port, "POST", "/api/live/launch", {"confirmCostUsd": round(est, 2)})
    body = json.loads(data)
    assert status == 202 and body["ok"] is True, body
    assert_valid(validator, body["status"])
    assert len(backends) == 1
    assert service.LedgerStore(state / "ledger.json").load() == guard.Ledger(8.10, est, False)
    # a second launch is refused (running, and the ledger now needs reconciling)
    status, _, data = request(port, "POST", "/api/live/launch", {"confirmCostUsd": est})
    assert status == 409
    status, _, data = request(port, "POST", "/api/live/terminate")
    body = json.loads(data)
    assert status == 200 and body["ok"] is True
    assert body["status"]["mode"] == "idle" and body["status"]["reason"].startswith("Last session ended: Stopped on request")
    assert body["status"]["budget"]["slotFits"] is False
    assert [w.terminate_calls for w in backends[0].workers] == [1, 1]
    # guard refuses on an unreconciled ledger even with the right cost
    status, _, data = request(port, "POST", "/api/live/launch", {"confirmCostUsd": est})
    assert status == 409 and "not reconciled" in json.loads(data)["reason"] and len(backends) == 1
    # once a human reconciles, a new session can be launched
    service.LedgerStore(state / "ledger.json").save(guard.Ledger(8.10 + est, 0.0, True))
    status, _, data = request(port, "POST", "/api/live/launch", {"confirmCostUsd": est})
    assert status == 202 and len(backends) == 2, data


def test_H5_concurrent_launches_start_exactly_one_session(armed_server):
    port, svc, backends, state = armed_server
    est = guard.slot_estimate_usd()
    barrier, codes = threading.Barrier(8), []

    def fire():
        barrier.wait()
        codes.append(request(port, "POST", "/api/live/launch", {"confirmCostUsd": est})[0])

    threads = [threading.Thread(target=fire) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)
    assert sorted(codes) == [202] + [409] * 7 and len(backends) == 1
    assert service.LedgerStore(state / "ledger.json").load() == guard.Ledger(8.10, est, False)  # reserved once


def test_H5_terminate_failure_is_reported_not_ok(armed_server):
    port, svc, backends, state = armed_server
    broken = {"on": True}

    class Stuck(FakeBackend):
        def terminate(self, w):
            if broken["on"]:
                raise ConnectionError("Modal API unreachable")
            super().terminate(w)

    def factory(rid, t):
        backends.append(Stuck(steps=100000, step_wall_s=0.02))
        return backends[-1]

    svc.backend_factory = factory
    status, _, data = request(port, "POST", "/api/live/launch", {"confirmCostUsd": guard.slot_estimate_usd()})
    assert status == 202, data
    deadline = time.time() + 5
    while get_json(port, "/api/live/status")[2]["mode"] != "live":  # both workers launched
        assert time.time() < deadline
        time.sleep(0.01)
    svc._run.terminate_backoff_s, svc._run.retry_sleep = (0.0,), (lambda s: None)
    status, _, data = request(port, "POST", "/api/live/terminate")
    body = json.loads(data)
    assert status == 502 and body["ok"] is False and body["reason"].startswith("TERMINATE FAILED")
    assert body["status"]["reason"].startswith("TERMINATE FAILED") and body["status"]["mode"] != "terminated"
    # still counted as running: no new launch while GPUs may be billing
    service.LedgerStore(state / "ledger.json").save(guard.Ledger(20.0, 0.0, True))
    status, _, data = request(port, "POST", "/api/live/launch", {"confirmCostUsd": guard.slot_estimate_usd()})
    assert status == 409 and "unconfirmed" in json.loads(data)["reason"]
    # retrying terminate once Modal answers again confirms it
    broken["on"] = False
    status, _, data = request(port, "POST", "/api/live/terminate")
    assert status == 200 and json.loads(data)["ok"] is True
    assert [w.terminate_calls for w in backends[-1].workers] == [1, 1]


def test_H5_saved_run_route_and_fallback_wording(armed_server, tmp_path, no_modal_env, validator):
    port, svc, backends, state = armed_server
    saved = service.load_qualification(state)["savedRunId"]
    status, _, data = request(port, "GET", f"/api/live/runs/{saved}")
    body = json.loads(data)
    assert status == 200 and body["savedRunId"] == saved and body["continuationVerified"] is True
    for p in body["phases"]:
        assert_valid(validator, p)
    for bad in ("rehearsal-test", "../qualification", "rehearsal-0123456789ab", f"{saved}.json", "%2e%2e%2fledger"):
        assert request(port, "GET", f"/api/live/runs/{bad}")[0] == 404, bad
    # unavailable but qualified: the label names the saved run because it exists and is served
    st = service.LiveService(state_dir=state).status()
    assert st["mode"] == "unavailable" and st["fallback"]["label"] == f"Live GX unavailable — playing saved GX run {saved}"
    # the route serves only records that match contracts/live-run.schema.json exactly
    path = state / "runs" / f"{saved}.json"
    good = json.loads(path.read_text())
    for bad in ({**good, "extra": True}, {**good, "phases": good["phases"] * 2}):
        path.write_text(json.dumps(bad))
        assert request(port, "GET", f"/api/live/runs/{saved}")[0] == 404
    path.write_text(json.dumps(good))
    assert request(port, "GET", f"/api/live/runs/{saved}")[0] == 200
    # if the saved run is missing, never claim to play it
    (state / "runs" / f"{saved}.json").unlink()
    st = service.LiveService(state_dir=state).status()
    assert st["fallback"] == {"active": True, "label": NO_REHEARSAL_LABEL, "savedRunId": None}
    assert request(port, "GET", f"/api/live/runs/{saved}")[0] == 404


def test_H5_only_get_post_on_known_routes_and_loopback_hosts(default_server):
    assert request(default_server, "GET", "/api/nope")[0] == 404
    assert request(default_server, "POST", "/api/nope", {})[0] == 404
    assert request(default_server, "GET", "/api/live/launch")[0] == 405
    assert request(default_server, "POST", "/api/live/status", {})[0] == 405
    for m in ("PUT", "DELETE", "PATCH", "OPTIONS"):
        assert request(default_server, m, "/api/live/launch")[0] == 405
    assert request(default_server, "GET", "/api/health", headers={"Host": "evil.example:8787"})[0] == 403
    assert request(default_server, "POST", "/api/live/launch", {"confirmCostUsd": 1},
                   headers={"Origin": "https://evil.example"})[0] == 403


# ---------------------------------------------------------------- H6
def test_H6_artifacts_served_with_path_traversal_protection(default_server):
    status, headers, data = request(default_server, "GET", "/artifacts/manifest.json")
    assert status == 200 and headers["Content-Type"] == "application/json"
    assert data == (REPO_ROOT / "artifacts" / "manifest.json").read_bytes()
    raw = REPO_ROOT / "data" / "raw" / "wout_w7x_kjm.nc"
    assert raw.exists()
    for path in ("/artifacts/../data/raw/wout_w7x_kjm.nc", "/artifacts/%2e%2e/data/raw/wout_w7x_kjm.nc",
                 "/artifacts/..%2fdata%2fraw%2fwout_w7x_kjm.nc", "/artifacts/../../etc/passwd", "/artifacts//etc/passwd",
                 "/artifacts/%2fetc%2fpasswd", "/artifacts/", "/artifacts/missing.json", "/artifacts/a%00.json",
                 "/artifacts/../main/labyrinth_main/__init__.py"):
        status, _, data = request(default_server, "GET", path)
        assert status == 404, path
        assert b"wout" not in data and b"root:" not in data


def test_H6_symlink_escaping_artifacts_is_refused(tmp_path, no_modal_env):
    art = tmp_path / "artifacts"
    art.mkdir()
    (art / "ok.json").write_text("{}")
    secret = tmp_path / "secret.json"
    secret.write_text('{"secret": 1}')
    (art / "link.json").symlink_to(secret)
    srv = make_server(0, service=service.LiveService(), artifacts_dir=art)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        port = srv.server_address[1]
        assert request(port, "GET", "/artifacts/ok.json")[0] == 200
        assert request(port, "GET", "/artifacts/link.json")[0] == 404
    finally:
        srv.shutdown()
        srv.server_close()


def test_H6_artifacts_dir_is_repo_artifacts():
    from labyrinth_main.server import app

    assert Path(app.ARTIFACTS) == REPO_ROOT / "artifacts"


# ---------------------------------------------------------------- H1 (process exit never leaves GPUs running)
SIGNAL_HARNESS = r"""
import sys
from pathlib import Path
from labyrinth_main.features.live_gx import service
from labyrinth_main.features.live_gx.fake_backend import FakeBackend
from labyrinth_main.server import __main__ as server_main

log, state = Path(sys.argv[1]), Path(sys.argv[2])

class Recording(FakeBackend):  # TEST-ONLY: records every cancel to a file the test reads
    def terminate(self, w):
        super().terminate(w)
        with log.open("a") as f:
            f.write(f"cancel {w.tube}\n")

svc = service.LiveService(state_dir=state, availability_check=lambda: (True, "test harness"), poll_interval_s=0.02,
                          backend_factory=lambda rid, t: Recording(steps=10**6, step_wall_s=0.02))
sys.exit(server_main.main(["--port", "0"], service=svc))
"""


@pytest.mark.parametrize("sig", [signal.SIGINT, signal.SIGTERM], ids=["SIGINT", "SIGTERM"])
def test_H1_signal_terminates_running_workers_before_exit(sig, tmp_path):
    state = tmp_path / "state"
    state.mkdir()
    qualify(state)
    log = tmp_path / "cancels.log"
    env = {k: v for k, v in os.environ.items() if not k.startswith("MODAL_")}
    env.update(HOME=str(tmp_path))
    proc = subprocess.Popen([sys.executable, "-c", SIGNAL_HARNESS, str(log), str(state)], cwd=REPO_ROOT / "main", env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        line = proc.stdout.readline()
        assert line.startswith("Labyrinth API listening on http://127.0.0.1:"), line + proc.stderr.read()
        port = int(line.rsplit(":", 1)[1])
        status, _, data = request(port, "POST", "/api/live/launch", {"confirmCostUsd": guard.slot_estimate_usd()})
        assert status == 202, data
        deadline = time.time() + 10
        while get_json(port, "/api/live/status")[2]["mode"] != "live":
            assert time.time() < deadline
            time.sleep(0.02)
        assert not log.exists()
        proc.send_signal(sig)
        out, err = proc.communicate(timeout=30)
    finally:
        if proc.poll() is None:
            proc.kill()
    assert proc.returncode == 0, out + err
    assert "workers terminated." in out
    assert sorted(log.read_text().split("\n")[:-1]) == ["cancel bean", "cancel triangular"]


INFLIGHT_HARNESS = r"""
import sys, time, types
from pathlib import Path
log, state, delay, join = Path(sys.argv[1]), Path(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])

class Call:  # TEST-ONLY stand-in for modal.FunctionCall
    def get(self, timeout=None):
        raise TimeoutError
    def cancel(self, **kw):
        with log.open("a") as f:
            f.write(f"cancel {sorted(kw.items())}\n")

class Fn:
    def spawn(self, **kw):
        time.sleep(delay)  # Modal accepts the call only after the client-side bound
        return Call()

sys.modules["modal"] = types.SimpleNamespace(
    Function=types.SimpleNamespace(from_name=lambda app, name: Fn()),
    Dict=types.SimpleNamespace(from_name=lambda name, create_if_missing: {}),
    exception=types.SimpleNamespace())
from labyrinth_main.features.live_gx import modal_backend, service
from labyrinth_main.server import __main__ as server_main
modal_backend.CALL_TIMEOUT_S = 0.1
svc = service.LiveService(state_dir=state, availability_check=lambda: (True, "test harness"), poll_interval_s=0.02,
                          join_timeout_s=join,
                          backend_factory=lambda rid, t: modal_backend.ModalBackend(run_id=rid, hard_timeout_s=t))
sys.exit(server_main.main(["--port", "0"], service=svc))
"""


@pytest.mark.parametrize("delay,join,code,cancelled", [(3.0, 0.3, 2, False), (0.8, 5.0, 0, True)],
                         ids=["spawn-outlives-shutdown", "late-spawn-cancelled"])
def test_H1_shutdown_during_in_flight_launch(delay, join, code, cancelled, tmp_path):
    state = tmp_path / "state"
    state.mkdir()
    qualify(state)
    log = tmp_path / "cancels.log"
    env = {k: v for k, v in os.environ.items() if not k.startswith("MODAL_")}
    env.update(HOME=str(tmp_path))
    proc = subprocess.Popen([sys.executable, "-c", INFLIGHT_HARNESS, str(log), str(state), str(delay), str(join)],
                            cwd=REPO_ROOT / "main", env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        line = proc.stdout.readline()
        assert line.startswith("Labyrinth API listening on http://127.0.0.1:"), line + proc.stderr.read()
        port = int(line.rsplit(":", 1)[1])
        status, _, data = request(port, "POST", "/api/live/launch", {"confirmCostUsd": guard.slot_estimate_usd()})
        assert status == 202, data
        deadline = time.time() + 10
        while (st := get_json(port, "/api/live/status")[2])["mode"] != "fallback":
            assert time.time() < deadline
            time.sleep(0.02)
        assert st["reason"].startswith("TERMINATION PENDING")
        proc.send_signal(signal.SIGINT)
        out, err = proc.communicate(timeout=30)
    finally:
        if proc.poll() is None:
            proc.kill()
    assert proc.returncode == code, out + err
    if cancelled:
        assert "workers terminated." in out and log.read_text() == "cancel [('terminate_containers', True)]\n"
    else:
        assert "NOT confirmed terminated" in out and not log.exists()
