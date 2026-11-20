# Verify: 07-server
Verifier run: 2026-11-19/20, commit 60a9dee at start, fcf812d at end, plus working tree (`main/labyrinth_main/server/{__init__,__main__,app}.py` and `main/tests/test_server.py` are uncommitted). Before and after every probe I checked the files under test byte for byte against my mutation copy, and they did not change.

Safety: no `modal` package and no Modal credentials. The real server ran with `HOME` and `LABYRINTH_STATE_DIR` pointing into `/tmp/claude-0/-home-user-Labyrinth/7ab7c93d-a99a-5137-bbf3-e77ff0f80ade/scratchpad/v06/`. Every launch attempt was refused and the state dir stayed empty (no ledger reserved). I killed the server at the end and confirmed it was gone (`pgrep` empty, connect refused).

## Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| H1 | `python3 -m labyrinth_main.server` serves on 127.0.0.1:8787, stdlib only | `test_H1_*` (subprocess, default port 8787 in `parse_args`, AST import check) | I started the real module with `--port <free>`: it printed "Labyrinth API listening on http://127.0.0.1:54959". `/proc/net/tcp` shows `LISTEN 127.0.0.1 37155` (first instance) and no 0.0.0.0 bind. The imports in `server/*.py` are stdlib plus `labyrinth_main` only. | PASS |
| H2 | `GET /api/health` → `{"ok": true, "version": …}` | `test_H2_health` | curl: `HTTP/1.0 200 OK`, `Content-Type: application/json`, `{"ok": true, "version": "0.1.0"}` | PASS |
| H3 | `GET /api/live/status` → schema-valid, unavailable without credentials | `test_H3_*` | curl → `mode: unavailable` with budget ceiling 40.0, pending 8.1 (unreconciled default), estimate 2.65, slotFits false, hardTimeoutS 1500. My own jsonschema + referencing validator returned VALID, and its negative control rejected a bad `mode`. | PASS |
| H4 | `GET /api/live/stream` → SSE of status snapshots | `test_H4_*` | curl over 2.5 s: `Content-Type: text/event-stream`, 3 `data: {…}\n\n` events, each schema-valid with mode unavailable. | PASS |
| H5 | Launch needs JSON `{"confirmCostUsd": estimate}` + passing guard, else 409; terminate always allowed | `test_H5_*` (3 tests; the armed variant uses the test-only fake backend) | Real server: a wrong cost, the right cost (2.65), NaN or a JSON array → 409. `text/plain` and form-urlencoded → 409 "Content-Type must be application/json". Terminate → 200 "Nothing running.". No launch happened and no ledger was written. Mutations: accept any cost → H5 + L5 fail; skip the reconciliation check → H5 + L1 fail; disable the Host check → H5_only fails. | PASS |
| H6 | `/artifacts/<file>` with traversal protection (`/artifacts/../data/raw/...` → 404) | `test_H6_*` (3 tests incl. symlink escape) | 17 traversal variants all gave 404, sent with `curl --path-as-is`: `..`, `%2e%2e`, `%2E%2E%2F…`, double-encoded `%252e%252e`, `%5c` backslashes, raw `\`, `%5c..`, a `//` absolute path, a `%2f` absolute path, `../../../../etc/passwd`, `....//`, `manifest.json/../../`, `%00`, `.` and `..`. Control: `/artifacts/manifest.json` → 200, byte-identical to the file. Mutation (drop `is_relative_to`) fails both traversal tests. Non-loopback Host values (`evil.example`, `127.0.0.1.evil.example`, `10.0.0.5:8787`, empty) → 403, and so does a non-loopback Origin on GET and on POST launch or terminate. `localhost:8787` → 200. | PASS |

## Real output
```
$ LABYRINTH_STATE_DIR=…/v06/state bash scripts/verify.sh all    # first run exited 2: renderer:typecheck only
  (src/design/components/*.tsx TS2882 — other agents' in-flight design work; all main/artifacts/boundary stages PASS)
$ LABYRINTH_STATE_DIR=…/v06/state bash scripts/verify.sh all    # final re-run
verify.sh all EXIT=0
  PASS  boundary:self-test  PASS  boundary:scan  PASS  docs:handoff  PASS  scripts:tests  PASS  main:lint
  PASS  main:tests (69 passed)  PASS  artifacts:schema  PASS  artifacts:fresh
  PASS  renderer:typecheck  PASS  renderer:tests  PASS  renderer:build
verify.sh: all stages passed.
$ python3 scripts/check_boundaries.py
boundary: OK (96 files scanned)        exit=0

$ cd main && python3 -m pytest -v -p no:cacheprovider tests/test_server.py   (run together with test_live_gx.py)
tests/test_server.py::test_H1_module_entrypoint_serves_on_loopback_default_8787_stdlib_only PASSED
tests/test_server.py::test_H2_health PASSED
tests/test_server.py::test_H3_live_status_is_schema_valid_and_unavailable_without_credentials PASSED
tests/test_server.py::test_H4_stream_is_server_sent_events_of_status_snapshots PASSED
tests/test_server.py::test_H5_launch_refused_without_credentials_even_with_correct_cost PASSED
tests/test_server.py::test_H5_launch_requires_exact_confirmed_cost_and_passing_guard PASSED
tests/test_server.py::test_H5_only_get_post_on_known_routes_and_loopback_hosts PASSED
tests/test_server.py::test_H6_artifacts_served_with_path_traversal_protection PASSED
tests/test_server.py::test_H6_symlink_escaping_artifacts_is_refused PASSED
tests/test_server.py::test_H6_artifacts_dir_is_repo_artifacts PASSED
============================== 28 passed in 5.12s ==============================
```

Real server, health and status (`env -u MODAL_TOKEN_ID -u MODAL_TOKEN_SECRET HOME=…/v06/home LABYRINTH_STATE_DIR=…/v06/state python3 -m labyrinth_main.server --port <free>`):
```
Labyrinth API listening on http://127.0.0.1:37155
LISTEN 127.0.0.1 37155
--- health
HTTP/1.0 200 OK
Server: labyrinth
Content-Type: application/json
Content-Length: 33
Cache-Control: no-store
X-Content-Type-Options: nosniff

{"ok": true, "version": "0.1.0"}
--- status
{ "schemaVersion": 1, "mode": "unavailable",
  "reason": "Live GX unavailable: no Modal credentials (MODAL_TOKEN_ID/MODAL_TOKEN_SECRET or ~/.modal.toml); the `modal` package is not installed (pip install modal==1.6.4). Replay only. Live GX is UNREHEARSED (D-011).",
  "qualified": false,
  "budget": {"ceilingUsd": 40.0, "billedUsd": 0.0, "pendingUsd": 8.1, "slotEstimateUsd": 2.65, "slotFits": false, "hardTimeoutS": 1500},
  "workers": [],
  "fallback": {"active": true, "label": "No qualified GX rehearsal recorded — showing archived stella/GENE evidence", "savedRunId": null} }
--- stream (curl -N --max-time 2.5; exit 28 = timeout, expected)
HTTP/1.0 200 OK
Content-Type: text/event-stream
Cache-Control: no-store
Connection: close

data: {"schemaVersion": 1, "mode": "unavailable", … }
3 events
--- own schema validation (jsonschema Draft 2020-12 + referencing registry of contracts/*.schema.json)
unavailable VALID      (status.json)
unavailable VALID      (SSE event 1)
unavailable VALID      (SSE event 2)
unavailable VALID      (SSE event 3)
negative control (mode=running-hot): ["'running-hot' is not one of ['unavailable', 'idle', 'launching', 'live', 'fallback', 'terminated']"]
```

Launch, traversal and host probes (second server instance on port 54959, after the container restarted):
```
=== launch probes
-X POST -H Content-Type: application/json -d {"confirmCostUsd": 1.00} …/api/live/launch -> 409  {"ok": false, "reason": "launch refused: Live GX unavailable: no Modal credentials …
-X POST -H Content-Type: application/json -d {"confirmCostUsd": 2.65} …/api/live/launch -> 409  {"ok": false, "reason": "launch refused: Live GX unavailable: no Modal credentials …
-X POST -H Content-Type: text/plain -d {"confirmCostUsd": 2.65} …/api/live/launch -> 409  {"ok": false, "reason": "launch refused: Content-Type must be application/json"}
-X POST -H Content-Type: application/x-www-form-urlencoded -d confirmCostUsd=2.65 …/api/live/launch -> 409  {"ok": false, "reason": "launch refused: Content-Type must be application/json"}
-X POST -H Content-Type: application/json -d {"confirmCostUsd": NaN} …/api/live/launch -> 409  {"ok": false, "reason": "launch refused: Live GX unavailable: …
-X POST -H Content-Type: application/json -d [2.65] …/api/live/launch -> 409  {"ok": false, "reason": "launch refused: body must be a JSON object"}
-X POST …/api/live/terminate                      -> 200  {"ok": true, "reason": "Nothing running.", "status": {"schemaVersion": 1, "mode": "unavailable", …
state dir after probes: empty (total 8: . ..)
=== traversal probes
--path-as-is …/artifacts/../data/raw/wout_w7x_kjm.nc -> 404  {"ok": false, "reason": "not found"}
--path-as-is …/artifacts/%2e%2e/data/raw/wout_w7x_kjm.nc -> 404
--path-as-is …/artifacts/%2E%2E%2Fdata%2Fraw%2Fwout_w7x_kjm.nc -> 404
--path-as-is …/artifacts/%252e%252e/data/raw/wout_w7x_kjm.nc -> 404
--path-as-is …/artifacts/%252e%252e%252fdata%252fraw%252fwout_w7x_kjm.nc -> 404
--path-as-is …/artifacts/..%5cdata%5craw%5cwout_w7x_kjm.nc -> 404
--path-as-is …/artifacts/..\data\raw\wout_w7x_kjm.nc -> 404
--path-as-is …/artifacts/%5c..%5cdata -> 404
--path-as-is …/artifacts//home/user/Labyrinth/data/raw/wout_w7x_kjm.nc -> 404
--path-as-is …/artifacts/%2fhome%2fuser%2fLabyrinth%2fdata%2fraw%2fwout_w7x_kjm.nc -> 404
--path-as-is …/artifacts/%2fetc%2fpasswd -> 404
--path-as-is …/artifacts/../../../../etc/passwd -> 404
--path-as-is …/artifacts/....//data/raw/wout_w7x_kjm.nc -> 404
--path-as-is …/artifacts/manifest.json/../../data/raw/wout_w7x_kjm.nc -> 404
--path-as-is …/artifacts/manifest.json%00.png -> 404
--path-as-is …/artifacts/. -> 404
--path-as-is …/artifacts/.. -> 404
=== control: legit artifact
…/artifacts/manifest.json -> 200  {"artifacts":[{"id":"geometry","path":"geometry.json", …
byte-identical
=== host/origin
-H Host: evil.example …/api/health -> 403  {"ok": false, "reason": "non-loopback Host/Origin refused"}
-H Host: 127.0.0.1.evil.example …/api/health -> 403
-H Host: 10.0.0.5:8787 …/api/live/status -> 403
-H Host: (empty) …/api/health -> 403
-H Host: localhost:8787 …/api/health -> 200  {"ok": true, "version": "0.1.0"}
-H Origin: http://evil.example …/api/live/status -> 403
-X POST -H Origin: https://evil.example … {"confirmCostUsd": 2.65} …/api/live/launch -> 403
-X POST -H Host: evil.example …/api/live/terminate -> 403
=== kill
no server process running
curl: (7) Failed to connect to 127.0.0.1 port 54959 after 0 ms: Couldn't connect to server
```

Mutations on a copy at `…/scratchpad/v06/mut` (`PYTHONDONTWRITEBYTECODE=1`):
```
=== F: artifacts containment check removed (is_relative_to dropped)
FAILED tests/test_server.py::test_H6_artifacts_served_with_path_traversal_protection
FAILED tests/test_server.py::test_H6_symlink_escaping_artifacts_is_refused
=== G: any confirmCostUsd accepted
FAILED tests/test_server.py::test_H5_launch_requires_exact_confirmed_cost_and_passing_guard
FAILED tests/test_live_gx.py::test_L5_rehearsal_verifies_init_then_continuation_and_qualifies
=== C2: guard reconciliation check removed
FAILED tests/test_live_gx.py::test_L1_refuses_unreconciled_or_invalid_ledger
FAILED tests/test_server.py::test_H5_launch_requires_exact_confirmed_cost_and_passing_guard
=== H: Host/Origin check disabled
FAILED tests/test_server.py::test_H5_only_get_post_on_known_routes_and_loopback_hosts
=== restored
28 passed in 5.72s
```

## Findings
- No defects found in the server. In H5 the reachable "passing guard + correct cost → 202" path is exercised only with the test-only fake backend (`test_server.py:67-87`). That is expected: the real server cannot reach `FakeBackend`, since there is no flag or env var for it (grep: it is referenced only under `main/tests/`).
- `test_H1` asserts the printed address, not the socket. My `/proc/net/tcp` probe confirmed the bind is 127.0.0.1.
- `POST /api/live/terminate` is "always allowed" only for loopback Host/Origin; any other Host or Origin gets 403. This is consistent with the documented DNS-rebinding and CSRF guard (`server/app.py:117-120`).
- The status served while a run is in progress inherits 06 finding F1: a malformed backend report ends as `terminated` without fallback. That is an orchestrator issue tracked in `tasks/06-live-gx/VERIFY.md`, not a server defect.
- verify.sh: the first run exited 2 only on `renderer:typecheck` in `renderer/src/design/components/*` (another agent's in-flight work). The final re-run exited 0.

Verdict: PASS
