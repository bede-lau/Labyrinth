# Verify: 07-server

This file holds two external verifier runs.

- **Run 1** (2026-11-19/20) covered H1–H6 on the working tree of that day; its result was PASS. It predates fix rounds 2–5.
- **Run 2** (2026-11-20, commit `c6244ec`) covers the whole task again. The verdict of this file is its last line.

The text of run 1 is kept as written; headings were moved one level down and its closing line is now labelled as
the run-1 verdict.

## Run 1 — H1–H6 (2026-11-19/20, commits 60a9dee → fcf812d)

Verifier run: 2026-11-19/20, commit 60a9dee at start, fcf812d at end, plus working tree (`main/labyrinth_main/server/{__init__,__main__,app}.py` and `main/tests/test_server.py` are uncommitted). Before and after every probe I checked the files under test byte for byte against my mutation copy, and they did not change.

Safety: no `modal` package and no Modal credentials. The real server ran with `HOME` and `LABYRINTH_STATE_DIR` pointing into `/tmp/claude-0/-home-user-Labyrinth/7ab7c93d-a99a-5137-bbf3-e77ff0f80ade/scratchpad/v06/`. Every launch attempt was refused and the state dir stayed empty (no ledger reserved). I killed the server at the end and confirmed it was gone (`pgrep` empty, connect refused).

### Outcomes (run 1)
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| H1 | `python3 -m labyrinth_main.server` serves on 127.0.0.1:8787, stdlib only | `test_H1_*` (subprocess, default port 8787 in `parse_args`, AST import check) | I started the real module with `--port <free>`: it printed "Labyrinth API listening on http://127.0.0.1:54959". `/proc/net/tcp` shows `LISTEN 127.0.0.1 37155` (first instance) and no 0.0.0.0 bind. The imports in `server/*.py` are stdlib plus `labyrinth_main` only. | PASS |
| H2 | `GET /api/health` → `{"ok": true, "version": …}` | `test_H2_health` | curl: `HTTP/1.0 200 OK`, `Content-Type: application/json`, `{"ok": true, "version": "0.1.0"}` | PASS |
| H3 | `GET /api/live/status` → schema-valid, unavailable without credentials | `test_H3_*` | curl → `mode: unavailable` with budget ceiling 40.0, pending 8.1 (unreconciled default), estimate 2.65, slotFits false, hardTimeoutS 1500. My own jsonschema + referencing validator returned VALID, and its negative control rejected a bad `mode`. | PASS |
| H4 | `GET /api/live/stream` → SSE of status snapshots | `test_H4_*` | curl over 2.5 s: `Content-Type: text/event-stream`, 3 `data: {…}\n\n` events, each schema-valid with mode unavailable. | PASS |
| H5 | Launch needs JSON `{"confirmCostUsd": estimate}` + passing guard, else 409; terminate always allowed | `test_H5_*` (3 tests; the armed variant uses the test-only fake backend) | Real server: a wrong cost, the right cost (2.65), NaN or a JSON array → 409. `text/plain` and form-urlencoded → 409 "Content-Type must be application/json". Terminate → 200 "Nothing running.". No launch happened and no ledger was written. Mutations: accept any cost → H5 + L5 fail; skip the reconciliation check → H5 + L1 fail; disable the Host check → H5_only fails. | PASS |
| H6 | `/artifacts/<file>` with traversal protection (`/artifacts/../data/raw/...` → 404) | `test_H6_*` (3 tests incl. symlink escape) | 17 traversal variants all gave 404, sent with `curl --path-as-is`: `..`, `%2e%2e`, `%2E%2E%2F…`, double-encoded `%252e%252e`, `%5c` backslashes, raw `\`, `%5c..`, a `//` absolute path, a `%2f` absolute path, `../../../../etc/passwd`, `....//`, `manifest.json/../../`, `%00`, `.` and `..`. Control: `/artifacts/manifest.json` → 200, byte-identical to the file. Mutation (drop `is_relative_to`) fails both traversal tests. Non-loopback Host values (`evil.example`, `127.0.0.1.evil.example`, `10.0.0.5:8787`, empty) → 403, and so does a non-loopback Origin on GET and on POST launch or terminate. `localhost:8787` → 200. | PASS |

### Real output (run 1)
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

### Findings (run 1)
- No defects found in the server. In H5 the reachable "passing guard + correct cost → 202" path is exercised only with the test-only fake backend (`test_server.py:67-87`). That is expected: the real server cannot reach `FakeBackend`, since there is no flag or env var for it (grep: it is referenced only under `main/tests/`).
- `test_H1` asserts the printed address, not the socket. My `/proc/net/tcp` probe confirmed the bind is 127.0.0.1.
- `POST /api/live/terminate` is "always allowed" only for loopback Host/Origin; any other Host or Origin gets 403. This is consistent with the documented DNS-rebinding and CSRF guard (`server/app.py:117-120`).
- The status served while a run is in progress inherits 06 finding F1: a malformed backend report ends as `terminated` without fallback. That is an orchestrator issue tracked in `tasks/06-live-gx/VERIFY.md`, not a server defect.
- verify.sh: the first run exited 2 only on `renderer:typecheck` in `renderer/src/design/components/*` (another agent's in-flight work). The final re-run exited 0.

Run 1 verdict (H1–H6): PASS

## Run 2 — whole task (2026-11-20, commit c6244ec)

Verifier run: 2026-11-20, commit c6244ec

Exactly that commit, not the working tree (a backend engineer started review round 6 in `main/` during the run).
`verify.sh main` ran on the shared tree while `git status --short -- main contracts` was empty; everything else
ran in the isolated copy made at the start with `scripts/probe-copy.sh v0607`, which I compared with the commit
file by file (`git show c6244ec:<path> | cmp`, 81 files: 0 differ). `verify.sh all` ran in that copy. Mutations ran
in six further copies. All copies are deleted; the shared tree was never mutated. No `modal` install, no Modal
credentials, no network: every server ran under an audit-hook socket guard that raises on a non-loopback connect
(it recorded none), bound 127.0.0.1 on ports 18707–18760 with its state dir under my scratch dir `$S`
(`…\scratchpad\v0607`), and was stopped (`ss -ltn` at the end: none). The server under attack is the unmodified
`python3 -m labyrinth_main.server --port N`; the client is my own raw-socket code. For the armed part the real
CLI ran with my stand-in `modal` package on `PYTHONPATH` and placeholder strings in `MODAL_TOKEN_ID/SECRET`.
Details of the tools, the L1–L8 probes and the full mutation list: `tasks/06-live-gx/VERIFY.md`, run 2.

### Outcomes (run 2)
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| H1 | `python3 -m labyrinth_main.server` serves on 127.0.0.1:8787 (stdlib only) | `test_H1_module_entrypoint_serves_on_loopback_default_8787_stdlib_only`, 4 × `test_H1_signal_terminates_running_workers_before_exit`, 2 × `test_H1_shutdown_during_in_flight_launch` (**flaky**, S2-3). Mutations: port → red; bind 0.0.0.0 → the suite hangs (no assertion fails); `LabyrinthServer.shutdown()` without `service.shutdown()` survives | `ss -ltn`: only `127.0.0.1:18707`; the machine's other address and `[::1]` refuse; audit hook: the only bind is `('127.0.0.1', 18707)`; `--help` names 8787; `--host`, `--bind`, `--service`, `--fake`, `--backend` → argparse exit 2; `server/*.py` import only stdlib + `labyrinth_main` (read). 57 signal runs: exit 0 only with every spawned call cancelled, exit 2 + "NOT confirmed terminated" otherwise. | PASS (S2-3 flaky test; S2-6, S2-7 minor) |
| H2 | `GET /api/health` → `{"ok": true, "version": …}` | `test_H2_health`. 1 mutation: red | `200 {"ok": true, "version": "0.1.0"}`, `application/json`, `no-store`, `nosniff`, no CORS headers | PASS |
| H3 | `GET /api/live/status` → schema-valid live status (unavailable without credentials) | `test_H3_live_status_is_schema_valid_and_unavailable_without_credentials`. 1 mutation: red | 200, valid with my own validator, `mode: unavailable`, budget `{40.0, 0.0, 8.1, 2.65, false, 1500}`; armed: `idle` → `launching` → `live` → `fallback`, all valid (206 server snapshots among 983, 0 invalid) | PASS (S2-5 minor) |
| H4 | `GET /api/live/stream` → Server-Sent Events of status snapshots | `test_H4_stream_is_server_sent_events_of_status_snapshots`, `test_H4_concurrent_streams_are_capped`. 4 mutations: 3 red, 1 by hang | `text/event-stream`, 4 events in 3.6 s, gaps 1.0 s, each `data: <valid JSON>`; 9th concurrent stream → 503; a slot is free 1.0 s after a client closes, 0.1 s after a reset; all 8 back after every client left; live: sim clocks advance across events | PASS |
| H5 | `POST /api/live/launch` needs `{"confirmCostUsd": <estimate>}` and a passing guard, else 409 with reason; `POST /api/live/terminate` always allowed | 7 × `test_H5_*`. 17 mutations: 10 red, 3 by hang, **4 survive** (S2-4) | 202 only for the right cost on a reconciled ledger; busy, unreconciled, unavailable, wrong cost, wrong type → 409. **But:** `confirmCostUsd` 1e308 or a 400-digit integer → no HTTP response at all (S2-2); 14 kinds of refusal come back without `status` (S2-4); and after a late spawn error with a failed kill-switch put, terminate answers **200** "Workers terminated." and the server exits 0 while a worker of that run is still running in my stub (S2-1). 502 TERMINATION PENDING / TERMINATE FAILED otherwise correct. | **FAIL (S2-1, S2-2)** |
| H6 | `GET /artifacts/<file>` with path-traversal protection | 3 × `test_H6_*`. 2 mutations: 2 red | manifest and all 5 artifacts byte-identical; 51 attempts (`..`, `%2e%2e`, double-encoded, backslash, absolute, NUL, CR/LF, overlong and fullwidth dots, symlink to a file / a directory / an absolute path outside) → 404 with no content leaked; 13 malformed or traversal `savedRunId`s → 404 | PASS |

### Real output (run 2)

Gates:
```
$ (shared tree /mnt/d/Labyrinth @ c6244ec) LABYRINTH_STATE_DIR=$S/state-default bash scripts/verify.sh main
127 passed in 30.85s
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (22s)
  PASS  scripts:tests (9s)
  PASS  main:lint (0s)
  PASS  main:tests (31s)
  PASS  artifacts:schema (1s)
  PASS  artifacts:fresh (0s)
verify.sh: all stages passed.
verify.sh main (shared tree) EXIT=0
$ (probe copy /home/qqbot/.cache/labyrinth-probes/v0607) LABYRINTH_STATE_DIR=$S/state-default bash scripts/verify.sh all
  PASS  boundary:self-test … PASS  main:tests (25s) … PASS  renderer:typecheck (11s)  PASS  renderer:tests (142s)  PASS  renderer:build (3s)
verify.sh: all stages passed.
verify.sh all (probe copy) EXIT=0
$ python3 scripts/check_boundaries.py   # in the probe copy
boundary: OK (142 files scanned)
exit=0
```

Each outcome's tests alone (probe copy) and the signal-test loop:
```
$ python3 -m pytest -q -p no:cacheprovider main/tests/test_server.py -k test_H1_     (… _H2_ … _H6_)
H1: 7 passed, 14 deselected in 3.13s
H2: 1 passed, 20 deselected in 0.65s
H3: 1 passed, 20 deselected in 0.61s
H4: 2 passed, 19 deselected in 1.21s
H5: 7 passed, 14 deselected in 4.58s
H6: 3 passed, 18 deselected in 1.13s
$ for i in 1..15: python3 -m pytest -q -p no:cacheprovider main/tests/test_live_gx.py main/tests/test_server.py -k "signal or ctrl_c or shutdown_during_in_flight or in_process_pass"
signal tests: 15/15 iterations green          (shared tree)
iteration 12: exit 1 | 1 failed, 14 passed, 65 deselected in 6.78s
signal tests: 14/15 iterations green          (probe copy)
    assert st["reason"].startswith("TERMINATION PENDING")
E    +    where … = 'GPU 0 (bean) worker failed: launch did not complete in time (Function.spawn did not return within 0 s); its cancel is queued. Other worker terminated.'.startswith
FAILED main/tests/test_server.py::test_H1_shutdown_during_in_flight_launch[late-spawn-cancelled]
```

Mutations of `server/app.py` and `server/__main__.py` (28 of the 163 in the 06 file; 18 red, 5 by hang, 5 survive):
```
SURVIVORS
  H05   H5  app.py   if n < 0 or n > MAX_BODY:  ->  if n < 0:
  H07   H5  app.py   do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_HEAD = _refuse_method  ->  … = do_GET
  H07b  H5  app.py   do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_HEAD = _refuse_method  ->  (do_HEAD removed)
  H12   H5  app.py   return self._json(409, {"ok": False, "reason": …, "status": svc.status()})  ->  (without "status")
  H19   H1  app.py   self.service.shutdown(); super().shutdown()  ->  super().shutdown()
DETECTED ONLY BECAUSE THE SUITE HUNG (killed after 120–300 s; assertion failures printed before the hang)
  H08 H4 (stream cap removed): 0     H10 H5 (terminate always 200): 2     H11 H5 (launch 200 instead of 202): 3
  H13 H1 (bind 0.0.0.0): 0           H28 H5 (terminate skipped): 2
RED: H01 H02 H03 H14 H22 H31 (Host / Origin / method routing), H04 H29 (artifacts), H06 H23 H24 H25 (launch body, saved run),
     H09 H17 H27 (SSE), H16 (health), H26 (status), H30 (port), M01–M05 (signals, exit code, final message)
```

The attack (`run.sh p_http.py AB`, ports 18707 and 18708):
```
== A1. endpoints and status codes (interface.md §3)
  ok   GET /api/health -> 200 {"ok": true, "version": "0.1.0"} [application/json]
  ok   headers: cache-control no-store, nosniff, no CORS headers; server banner 'labyrinth'
  ok   GET /api/live/status -> 200, schema-valid, mode unavailable, fallback {'active': True, 'label': 'No qualified GX rehearsal recorded — showing archived stella/GENE evidence', 'savedRunId': None}
  ok   budget in the snapshot: {'ceilingUsd': 40.0, 'billedUsd': 0.0, 'pendingUsd': 8.1, 'slotEstimateUsd': 2.65, 'slotFits': False, 'hardTimeoutS': 1500}
  ok   GET /api/live/stream -> 200 [text/event-stream], 4 events in 3.6 s, gaps [1.0, 1.0, 1.0], every event `data: <schema-valid JSON>`
  ok   GET /api/live/runs/<13 missing, malformed and traversal ids> -> 404 each
  ok   POST /api/live/terminate -> 200 'Nothing running.'
== A2. launch refusals without credentials: 409, reason, status in the body
  ok   18 refused launch requests -> 409 with a reason each
  NOTE interface.md §3 documents `409 {ok:false,reason,status}` for ANY launch refusal; 14 of 18 refusals came back WITHOUT `status` (the body/content-type refusals): ['content-type text/plain', 'content-type form', 'no content-type', 'malformed JSON', 'JSON array', 'JSON string', 'empty body', 'missing key', 'body of 4097 bytes', 'body of 1 MB', 'Content-Length: abc', 'Content-Length: -5', 'Content-Length: 10**12 (nothing sent)', 'invalid UTF-8 body']
  ok   a body of exactly 4096 bytes is read and refused on its merits -> 409
  ok   4097 bytes -> 409 'launch refused: body must be at most 4096 bytes'
== A3. methods
  ok   PUT/DELETE/PATCH/OPTIONS/HEAD on 8 paths -> 405 with Allow: GET, POST, no CORS headers (exceptions: [])
  NOTE interface.md §3 says 'Only GET and POST; other methods -> 405', but methods the handler does not name get the stdlib's answer: {'TRACE': (501, 'text/html;charset=utf-8'), 'CONNECT': (501, 'text/html;charset=utf-8'), 'PROPFIND': (501, 'text/html;charset=utf-8'), 'get': (501, 'text/html;charset=utf-8'), 'FOO': (501, 'text/html;charset=utf-8')}
  ok   GET on the POST routes -> 405/405, Allow: POST
  ok   POST on the GET routes -> {'/api/health': 405, '/api/live/status': 405, '/api/live/stream': 405, '/artifacts/manifest.json': 405}
  ok   unknown paths -> 404
== A4. Host / Origin
  ok   20 non-loopback Host values -> 403, 7 loopback forms -> 200 (exceptions: [])
  ok   no Host header at all -> 403 (HTTP/1.1), 403 (HTTP/1.0)
       two Host headers: loopback first -> 200, evil first -> 403 (the first one is the one checked)
  ok   13 non-loopback Origin values x 5 routes -> 403; 5 loopback origins -> 200 (exceptions: [])
== A5. /artifacts/ traversal
  ok   control: /artifacts/manifest.json -> 200, byte-identical
  ok   all 5 artifacts in the manifest served byte-identical: ['geometry.json', 'transport.json', 'forecast.json', 'budget.json', 'spatial.json']
  ok   51 traversal attempts (encoded, double-encoded, backslash, absolute, NUL, overlong/fullwidth dots, symlink file/dir/absolute) -> 404, no content leaked (exceptions: [])
       paths that stay inside artifacts/: symlink to a sibling -> 200; ../artifacts/manifest.json -> 200; ./manifest.json -> 200
== A6. SSE cap and slot release
  ok   9th concurrent stream -> 503 {"ok": false, "reason": "too many live streams (max 8); poll /api/live/status instead"}
  ok   status and health still answer while 8 streams are open
  ok   after one client disconnects, its slot is free again after 1.01 s
  ok   after a connection reset, the slot is free again after 0.1 s
  ok   all 8 slots are back after every client left
== A7. slow / lying clients
  ok   a client that announces a body and never sends it does not block other requests
  NOTE a request that announces Content-Length and sends no body holds its handler thread open indefinitely (no socket timeout on the server); POST /api/live/terminate reads the announced body BEFORE terminating, so such a request never reaches terminate() (loopback clients only)
  ok   40 idle connections do not stop the server answering
== A8. the listening socket
  ok   ss -ltn: listening addresses for port 18707: ['127.0.0.1:18707']
  ok   connecting to this machine's other addresses on port 18707: [('172.28.59.13', 'ConnectionRefusedError')]
       [::1]:18707 -> ConnectionRefusedError (the server binds IPv4 loopback only)
== A9. shutdown
  ok   SIGTERM with nothing running: exit 0, 'Labyrinth API stopped; workers terminated.'; open SSE stream: closed
  ok   the port is closed after exit
  ok   L4/H1 socket guard (audit hook) on the server process: outbound non-loopback connects/DNS = 0; binds = ["('127.0.0.1', 18707)"]
  ok   L8: modal / modal_app never imported by the server process (import attempts [], at exit [{'modal_like_modules': [], 'modal_file': None, 'modal_type': None}])
== B1. armed real server (stub modal, placeholder credentials): idle
  ok   status: mode idle, qualified, slotFits, fallback {'active': False, 'label': '', 'savedRunId': 'rehearsal-1db61c0f3275'}
  ok   GET /api/live/runs/rehearsal-1db61c0f3275 -> 200, valid against live-run.schema.json
== B2. refusals while launchable: every one must be 409 with the status in the body and nothing spawned
  ok   18 bad confirmations: nothing spawned, ledger untouched, no lock left
  FAIL every refusal is answered with 409 — got NO HTTP RESPONSE (handler crashed) for: ['1e308', '400-digit integer']
  NOTE armed server: 409 bodies WITHOUT `status`: ['{}', 'text/plain', 'not JSON']
       server stderr (last traceback line): OverflowError: int too large to convert to float
  ok   the server still answers after those requests
== B3. launch -> 202, live, SSE, second launch refused
  ok   POST launch 2.65 -> 202 'Launched live-689800a9c06d; $2.65 reserved as pending.'
  ok   ledger: {'billedUsd': 15.83, 'pendingUsd': 2.65, 'reconciled': False}
  ok   two spawns of gx_worker_live: ['fn=gx_worker_live gpu=0 hard_timeout_s=1200 ckpt=None restar', 'fn=gx_worker_live gpu=1 hard_timeout_s=1200 ckpt=None restar']
  ok   second launch -> 409 'launch refused: A session is still running (or its termination is unco'
  ok   SSE while live: 7 events, modes ['launching', 'live'], sim clocks advance [(113.14, 339.41), (98.99, 339.41)]
== B4. terminate -> 200 only when confirmed
  ok   POST terminate -> 200 'Workers terminated.'; status mode idle, reason 'Last session ended: Stopped on request; workers terminated. '
  ok   both calls cancelled, no orphan: ['kill-switch', 'cancel-sent', 'cancel-ok', 'kill-switch', 'cancel-sent', 'cancel-ok']
  ok   launch on the unreconciled ledger -> 409 'launch refused: Budget guard refused: ledger not reconciled '
== B5. 2.650000001 / 2.6549 (rounds to the cent)
       confirmCostUsd 2.650000001 -> 202
       confirmCostUsd 2.6549 -> 202
== B6. terminate while the cancel RPC keeps failing -> 502 TERMINATE FAILED
  ok   POST terminate -> 502 after 22 s; reason 'TERMINATE FAILED — check Modal dashboard; GPUs may still be '; status mode 'launching'
  ok   launch while unconfirmed (reconciled ledger) -> 409 'launch refused: A session is still running (or its termination is unco'
  ok   once the cancel works again: POST terminate -> 200; orphans []
== B7. shutdown while live, with a slow cancel: what does a client see, and how does the process exit?
       during shutdown (cancel of bean in flight): process alive=True; GET /api/health -> <None timeout waiting for the response b''>; POST launch -> <None timeout waiting for the response b''>
  ok   three more signals do not cut the shutdown short, and no launch is accepted during it
  ok   exit 0; 'Labyrinth API stopped; workers terminated.'; orphans []
```

Terminate after a late spawn error with a failed kill-switch put, real server and real constants (`run.sh p_http.py C`):
```
  ok   launch -> 202
  ok   after 20 s: 'TERMINATION PENDING — cancel queued, not yet confirmed; GPUs'
  ok   while the spawn is in flight: POST terminate -> 502
       after the late spawn error: POST terminate -> 200 'Workers terminated.'; status mode 'fallback' reason 'GPU 0 (bean) worker failed: launch did not complete in time (Function.'
       stub: kill switch set = False; cancels = 0; remote workers still running = ['live-55a9e304b3e1/bean id=0430a148']
  FAIL terminate answers 200 only when nothing of the run can still be running
       SIGTERM afterwards: exit 0, 'Labyrinth API stopped; workers terminated.'; remote workers still running at exit = ['live-55a9e304b3e1/bean id=0430a148']
  FAIL exit 0 / 'workers terminated.' only when nothing of the run can still be running
```

A spawn that never returns, real constants (`run.sh p_real_exit2.py`, port 18709):
```
  ok   after 20.2 s (CALL_TIMEOUT_S = 20): mode fallback, reason 'TERMINATION PENDING — cancel queued, not yet confirmed; GPUs'
  ok   POST /api/live/terminate -> 502 in 5.0 s, reason 'TERMINATION PENDING — cancel queued, not yet confi'
  ok   launch while pending -> 409 'launch refused: A session is still running (or its termination is unco'
  ok   SIGTERM, then SIGINT+SIGHUP+SIGTERM: the process is still waiting for the queued cancel
       a request during the shutdown wait: <None timeout waiting for the response b''>
  ok   exit code 2 after 507 s (WORST_CASE_STOP_S + 10 = 507 s)
  ok   last stdout line: 'Labyrinth API stopped; workers NOT confirmed terminated — check Modal.'
```

Signals on the server entrypoint (`run.sh p_signals.py`; 57 server runs of the 107; table and method in the 06 file):
idle 10, launch-before-spawn 3, spawn-in-flight 10, spawn-late 6, during-terminate 10 → exit 0, every spawned call
cancelled; spawn-never 3, cancel-fails 2 → exit 2 with "NOT confirmed terminated — check Modal."; both-live 13 →
12 × exit 0, 1 × exit −15 after the last line was printed. Hangup with a dead terminal (`run.sh p_misc.py`):
```
       srv idle        : exit 1 (expected 0); spawns 0, cancels 0, orphans [], unanswered spawns []
       srv both-live   : exit 1 (expected 0); spawns 2, cancels 2, orphans [], unanswered spawns []
       srv spawn-never : exit 1 (expected 2); spawns 1, cancels 0, orphans [], unanswered spawns ['live-19e7271db341/bean']
       GET /api/live/status -> <None connection closed without any response b''>      (ledger.json: "billedUsd": 1 followed by 400 zeros)
```

### Findings (run 2)

Line numbers are those of commit `c6244ec`.

- **S2-1 (blocker, H5; the defect is in task 06 code and was found independently by the reviewer).**
  `main/labyrinth_main/features/live_gx/modal_backend.py:186-192, 256-263`: a late spawn that errors client-side
  is settled as terminated even when the kill-switch put failed. Through this server: `POST /api/live/terminate`
  → 200, exit 0, with a worker possibly running. *Fix:* settle confirmed only when the kill switch is known to be
  set, otherwise TERMINATE FAILED (502, exit 2).
- **S2-2 (major, H5; known to the reviewer).** `service.py:164, 166` (`cost_matches`): `confirmCostUsd` 1e308 or a
  400-digit integer raises `OverflowError`; the handler thread dies and the client gets no response instead of
  409. Nothing launches, the lock is released, the server keeps serving. *Fix:* catch it and refuse.
- **S2-3 (major, tests).** `main/tests/test_server.py:545-548` is flaky (1 of 15 loops unloaded, 2 of 72 with six
  suites at once): it waits for `mode == "fallback"` and then asserts the TERMINATION PENDING prefix, which
  `orchestrator.py:415-425` sets a moment later. `test_server.py:338-341` has the same shape. `INFLIGHT_HARNESS`
  (`test_server.py:496-524`) also fails whenever the suite starts with SIGINT ignored. *Fix:* wait for the marker;
  reset the dispositions in that harness as the other two do.
- **S2-4 (minor, H5).** `server/app.py:148, 150, 152`: content-type, body and missing-key refusals answer
  `409 {ok, reason}` without `status`, although interface.md §3 documents `{ok, reason, status}` for any refusal
  (14 kinds). No test asserts `status` in a 409 body (mutation H12 survives), the body cap (H05) or 405 on a
  path where GET is allowed (`test_server.py:389-390` only tries `/api/live/launch`; H07, H07b survive).
  `server/app.py:161`: methods not named there (TRACE, CONNECT, anything else) get the stdlib's 501 HTML page,
  not the documented 405.
- **S2-5 (minor, H3).** `budget_guard.py:115`: a `ledger.json` with an integer too large for a float makes
  `status()` raise; `/api/live/status`, the stream and both POST routes then give no response until the file is fixed.
- **S2-6 (minor, H1).** `server/__main__.py:54-58`: the previous signal handlers are restored before the final
  `print` and before the process exits (exit −15 / −2 instead of 0 / 2 when a signal lands there: 16 of 60 runs
  with signals 30–120 ms apart, see the 06 file), and the `print` itself is unguarded (exit 1 after a hangup with
  a dead terminal). `server/__main__.py:26-31` produces "OSError: Signal N ignored due to race condition" on
  stderr for two different signals back to back. *Fix:* keep the signals ignored until exit; guard the print.
- **S2-7 (minor).** `server/app.py:141, 105`: no socket timeout; a request that announces a body and never sends
  it holds a thread for ever, and `POST /api/live/terminate` reads the announced body before terminating. During
  shutdown (up to 507 s) connections are accepted by the kernel and never answered. `service.py:284-297`: a
  failed (not pending) cancel makes shutdown idle for the whole 507 s without retrying.
- **S2-8 (minor, tests).** Failing assertions hang instead of reporting: fixture teardown waits the real 507 s
  (`test_server.py:98-100`) and `assert …, line + proc.stderr.read()` (`test_server.py:130, 476, 540`) blocks on
  a live process (bind 0.0.0.0 was detected only because the suite hung).
- Not checkable here: anything that needs a real Modal account (see the 06 file).

Verdict: FAIL — H5 fails: POST /api/live/terminate answers 200 and the server exits 0 after a late spawn error with a failed kill-switch put while a worker may still be running, and two confirmCostUsd values crash the handler instead of 409; H1–H4 and H6 hold, with a flaky H1 test
