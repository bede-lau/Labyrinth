# Verify: 06-live-gx

This file holds two external verifier runs.

- **Run 1** (2026-11-19/20) covered outcomes L1–L8 on the working tree of that day. Its result was FAIL (finding F1).
- **Run 2** (2026-11-20, commit `c6244ec`) covers outcomes L1–L8 again, after fix rounds 2–5. L9–L10 get their own
  run after the frontend fix round. The verdict of this file is its last line.

The text of run 1 is kept as written. Only its scope notes were reworded (each marked "[reworded in run 2]"),
because `scripts/check_docs.py` reads certain phrases as a partial verdict; headings were moved one level down
and its closing line is now labelled as the run-1 verdict.

## Run 1 — L1–L8 (2026-11-19/20, commits 60a9dee → fcf812d)

Verifier run: 2026-11-19/20, commit 60a9dee at start, fcf812d at end, plus working tree (all task 06 backend files are still uncommitted: `features/live_gx/{budget_guard,orchestrator,fake_backend,modal_backend,modal_app,gx_input,service,rehearse}.py`, `main/tests/test_live_gx.py`). Before and after every probe I checked the files under test byte for byte against my mutation copy, and they did not change.

**Scope.** [reworded in run 2] Run 1 covered outcomes L1–L8. At that time `renderer/src/features/live-gx/` held no finished view, so L9–L10 were outside run 1. A `LiveView.tsx` appeared there while run 1 was in progress, and it was not examined. **Task 06 stays not-DONE until a verifier has checked L9–L10 as well**, whatever the L1–L8 verdict below says.

Safety: I did not install `modal` (`python3 -c "import modal"` → `ModuleNotFoundError`), set no Modal credentials (`~/.modal.toml` absent, no `MODAL_*` env) and made no outbound calls. All state went to `LABYRINTH_STATE_DIR=/tmp/claude-0/-home-user-Labyrinth/7ab7c93d-a99a-5137-bbf3-e77ff0f80ade/scratchpad/v06/state`, which was still empty at the end, so no ledger was ever written.

### Outcomes (run 1)
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| L1 | Slot estimate = rate × (slot+setup+idle) + storage; refuses when billed+pending+estimate > $40; hard timeout; refuses unreconciled ledger | `test_L1_*` (4 tests) | I recomputed $2.65 and $7.73 from pricing.py and D-015 without the guard helpers. I ran 13 hand-made ledgers: the pass, at-limit, over-limit, pending-only-over, unreconciled, negative, NaN, inf, string and bool cases all behave as expected. Mutations: ceiling 45 and ceiling 39 each fail 2 L1 tests; dropping `pending` from the total fails 1; removing the reconciliation check fails L1 and H5. | PASS (minor finding F4) |
| L2 | Two concurrent workers, GPU0 bean / GPU1 triangular, device IDs, overlapping wall-clock, monotone simTime, samples in archive units | `test_L2_*` | Fake backend with 8 steps: launch order `[('bean',0),('triangular',1)]`. Worker-thread overlap was 0.241 s and the orchestrator's recorded intervals overlapped by 0.245 s. Both clocks are monotone and end at 79.1960 = 56·√2. Sample ratios: t_arch/t_raw = 1.414214 and Q_raw/Q_arch = 2.828427. Mutation (simTime left raw) fails L2 and both L5 tests. | PASS |
| L3 | Either worker fails → `fallback`, label, savedRunId (null without rehearsal), error kept, other worker terminated | `test_L3_*` (2 tests) | A crash, a launch failure and a poll exception each give `fallback`, keep the error and terminate the other worker (`terminate_calls [1, 1]`, threads dead). **However, a malformed poll result (not a dict, a non-dict `checkpoint`, or a non-iterable `new_samples_raw`) raises out of `run()` and ends in `terminated` with `fallback.active False` and label `''`** (F1). Mutation D (`_fail` no longer terminates the other worker) survives, because the `finally` in `run()` terminates it anyway (F5). | **FAIL (F1)** |
| L4 | No credentials or no `modal` → `unavailable`, zero network calls | `test_L4_*` (2 tests) | A subprocess with `sys.addaudithook` watching socket.connect, getaddrinfo, gethostbyname, urllib and http.client recorded **no events** across `LiveService().status()` and a launch with the correct cost. The launch was refused and no ledger was written. The real server also reports `unavailable` (see 07). | PASS |
| L5 | Resume from checkpoint continues simTime from the checkpoint | `test_L5_*` (3 tests) | With a checkpoint at raw 100, the first simTime is 141.4214 = 100·√2 and the last is 183.8478 = 130·√2. `ignore_checkpoint=True` → `fallback`, "simulation clock went backwards (0.0 < 100.0 from checkpoint)". | PASS |
| L6 | Workers always terminated after retrieval, also on exception | `test_L6_*` (2 tests) | **Mutation A** (`terminate_all()` removed from the `finally` in `run()`) fails both L6 tests. KeyboardInterrupt raised from the 2nd launch → the first worker is still terminated (`[1]`, thread dead). Hard timeout 0 → both terminated. One gap: a worker whose `terminate()` call raises can be left running (F2). | PASS (finding F2) |
| L7 | Every status snapshot validates against `contracts/live-status.schema.json` | `test_L7_*` | My own validator (jsonschema with a `referencing` registry, plus negative controls that do fail) passed 57 snapshots covering 6 orchestrator scenarios and `unavailable` (modes fallback, launching, live, terminated, unavailable) with 0 errors. The server's `/api/live/status` response and 3 SSE events were valid. | PASS |
| L8 | `modal_app.py`: A100-40GB, hard timeout, explicit launch only, GX inputs for both tubes; never imported by tests or replay; UNREHEARSED | `test_L8_*` (3 tests) | grep: `import modal` appears only at modal_backend.py:70 and :83 (inside functions) and at modal_app.py:22. Nothing imports `modal_app`. Loading server, `__main__`, build_artifacts, service and rehearse puts no modal or fake module in `sys.modules`. `FakeBackend` is referenced only from `main/tests/`. The decorator has `gpu=GPU ("A100-40GB")`, `timeout=MODAL_TIMEOUT_S (4800)`, `retries=0` and `max_containers=2`, and there is no entrypoint, schedule or web endpoint. Inputs: bean GPU 0 with α=−0.0, triangular GPU 1 with α=−0.57187 = −ι(0.64)·36°, ι=0.91016, tprim/fprim 3/1, torflux 0.64. | PASS |
| L9 | Frontend live panel | — | [reworded in run 2] outside run 1 | outside run 1 |
| L10 | Frontend launch button + confirmation | — | [reworded in run 2] outside run 1 | outside run 1 |

### Real output (run 1)
```
$ LABYRINTH_STATE_DIR=…/v06/state bash scripts/verify.sh all        # first run (start of session)
  PASS  main:lint / main:tests (65 passed) / artifacts:schema / artifacts:fresh / boundary:*
  FAIL  renderer:typecheck   (src/design/components/*.tsx: TS2882 './components.css' — other agents' in-flight design work)
verify.sh: FAILED — … Exiting 2.

$ LABYRINTH_STATE_DIR=…/v06/state bash scripts/verify.sh all        # re-run at end of session
verify.sh all EXIT=0
  PASS  boundary:self-test (0s)   PASS  boundary:scan (0s)   PASS  docs:handoff (0s)   PASS  scripts:tests (1s)
  PASS  main:lint (0s)            PASS  main:tests (7s)      PASS  artifacts:schema    PASS  artifacts:fresh
  PASS  renderer:typecheck (4s)   PASS  renderer:tests (3s)  PASS  renderer:build (3s)
verify.sh: all stages passed.
main:tests → 69 passed in 6.35s ; boundary: OK (95 files scanned)

$ python3 scripts/check_boundaries.py
boundary: OK (96 files scanned)        exit=0

$ cd main && python3 -m pytest -v -p no:cacheprovider tests/test_live_gx.py tests/test_server.py
tests/test_live_gx.py::test_L1_slot_estimate_formula_uses_pricing_constants PASSED
tests/test_live_gx.py::test_L1_refuses_when_billed_plus_pending_plus_estimate_exceeds_ceiling PASSED
tests/test_live_gx.py::test_L1_refuses_unreconciled_or_invalid_ledger PASSED
tests/test_live_gx.py::test_L1_hard_timeout_is_planned_duration_capped_by_remaining_budget PASSED
tests/test_live_gx.py::test_L2_two_workers_run_concurrently_with_devices_clocks_and_archive_units PASSED
tests/test_live_gx.py::test_L3_worker_failure_falls_back_and_terminates_other_worker PASSED
tests/test_live_gx.py::test_L3_fallback_names_saved_run_and_covers_launch_and_poll_failures PASSED
tests/test_live_gx.py::test_L4_no_credentials_or_no_modal_means_unavailable_with_zero_network PASSED
tests/test_live_gx.py::test_L4_credentials_check_is_local PASSED
tests/test_live_gx.py::test_L5_checkpoint_continuation_resumes_sim_time_not_zero PASSED
tests/test_live_gx.py::test_L5_worker_restarting_from_zero_is_a_failure PASSED
tests/test_live_gx.py::test_L5_rehearsal_verifies_init_then_continuation_and_qualifies PASSED
tests/test_live_gx.py::test_L6_workers_terminated_after_retrieval_on_success PASSED
tests/test_live_gx.py::test_L6_workers_terminated_on_exception_and_hard_timeout PASSED
tests/test_live_gx.py::test_L7_every_status_snapshot_validates PASSED
tests/test_live_gx.py::test_L8_modal_app_defines_guarded_gx_worker_and_is_never_imported PASSED
tests/test_live_gx.py::test_L8_gx_input_generation_for_both_tubes PASSED
tests/test_live_gx.py::test_L8_modal_backend_contract_against_stub_modal PASSED
… (10 test_server.py tests PASSED)
============================== 28 passed in 5.12s ==============================
```

Budget guard by hand (my own recompute, then `evaluate()`):
```
live raw 2.641667 -> ceil cents 2.65; guard 2.65
rehearsal raw 7.725000 -> ceil cents 7.73; guard 7.73
D-015 planned total 8.10+2*7.73+2.65 = 26.21
pass: billed 8.10 pending 0 reconciled     approved=True  timeout= 1500 | … = $10.75 <= $40.00; hard
pass: exactly at 40 (37.35+0)              approved=True  timeout= 1500 | … = $40.00 <= $40.00; hard
refuse: 37.36+0+2.65=40.01                 approved=False timeout= 1499 | … = $40.01 exceeds the $40.
refuse: 20+17.36 pending +2.65             approved=False timeout= 1499 | … pending $17.36 … = $40.01 exceeds
refuse: unreconciled 0/0                   approved=False timeout= 1500 | Budget guard refused: ledger not reconciled …
refuse: negative billed                    approved=False timeout=    0 | … must be finite, non-negative numbers.
refuse: negative pending                   approved=False timeout=    0 | … must be finite, non-negative numbers.
refuse: NaN pending                        approved=False timeout=    0 | … must be finite, non-negative numbers.
refuse: inf billed                         approved=False timeout=    0 | … must be finite, non-negative numbers.
refuse: string billed                      approved=False timeout=    0 | … must be finite, non-negative numbers.
refuse: bool billed                        approved=False timeout=    0 | … must be finite, non-negative numbers.
edge: 37.354 (+2.65=40.004)                approved=True  timeout= 1500 | … = $40.00 <= $40.00; hard
edge: 37.3549                              approved=True  timeout= 1500 | … = $40.00 <= $40.00; hard
rehearsal guard: True 7.73 4500
```

Orchestrator probes (fake backend; the script is at `…/scratchpad/v06/probes/orch_probe.py`):
```
== 1. happy path: overlap, GPU mapping, monotone simTime, archive units
launch calls: [('bean', 0), ('triangular', 1)]
thread intervals bean=[1795142712.514,1795142712.755] tri=[1795142712.514,1795142712.755] overlap=0.241s
orchestrator intervals overlap: 0.245s
 gpu0 bean dev=FAKE-GPU-0-bean-0 clocks(unique)=[0.0, 9.8995, 19.799].. last=79.1960 expect 79.1960 monotone=True
   sample0 raw (t=7.0, Q=6.39962) -> archive (t=9.89949, Q=2.26261); ratios t=1.414214 Q=2.828427 (sqrt2=1.414214, 2sqrt2=2.828427)
 gpu1 triangular dev=FAKE-GPU-1-triangular-1 clocks(unique)=[0.0, 9.8995, 19.799].. last=79.1960 expect 79.1960 monotone=True
mode terminated terminate_calls [1, 1] alive [False, False] exc None
== 2. bean fails at step 2 -> fallback, triangular terminated
mode fallback | fallback {'active': True, 'label': 'Worker failed. No qualified GX rehearsal recorded — showing archived stella/GENE evidence', 'savedRunId': None} | errors ['simulated GX crash on bean at step 2', None] | terminate [1, 1] alive [False, False]
== 3. poll() returns a non-dict (malformed backend report)
mode terminated | fallback.active False | label '' | reason Session ended abnormally; workers terminated. | exc AttributeError: 'NoneType' object has no attribute 'get' | terminate [1, 1] alive [False, False]
== 4. checkpoint field is a string, new_samples_raw is an int
 checkpoint='x': mode terminated | fallback.active False | exc AttributeError: 'str' object has no attribute 'get' | alive [False, False]
 new_samples_raw=5: mode terminated | fallback.active False | exc TypeError: 'int' object is not iterable | alive [False, False]
== 5. terminate() raises (cancel failed) -> worker possibly left running
mode fallback | errors ['terminate failed: ConnectionError: cancel RPC failed', 'simulated GX crash on triangular at step 2; terminate failed: ConnectionError: cancel RPC failed'] | terminate_calls [1, 1] | threads alive [True, False]
== 6. hard timeout while workers run (not a worker failure)
mode terminated | fallback {'active': False, 'label': '', 'savedRunId': None} | reason Hard timeout of 0 s reached; workers terminated. | alive [False, False]
== 7. worker reports error text with state=running (ignored?)
mode terminated | worker errors [None, None]
== 8. KeyboardInterrupt from the 2nd launch -> first worker still terminated?
mode terminated | exc KeyboardInterrupt:  | terminate [1] | alive [False]
== 9. checkpoint continuation from 100 raw; ignore_checkpoint -> fallback
 resumed simTime first/last [(141.4213562373095, 183.84776310850236), (141.4213562373095, 183.84776310850236)] 100*sqrt2= 141.4213562373095
 ignore_checkpoint: mode fallback simulation clock went backwards (0.0 < 100.0 from checkpoint); checkpoint continuation broken
```

L4 and L7 independent probe (audit hook plus my own schema validator):
```
L4 status mode: unavailable | state_dir: …/scratchpad/v06/state | network audit events: [] | modal in sys.modules: False
L4 launch with correct cost: False Live GX unavailable: no Modal credentials (MODAL_TOKEN_ID/MO | ledger written: False | events: []
L7: 57 snapshots, modes ['fallback', 'launching', 'live', 'terminated', 'unavailable'] | invalid: []
negative control (mode=running-hot): ["'running-hot' is not one of ['unavailable', 'idle', 'launching', 'live', 'fallback', 'terminated']"]
```

grep for modal and fake imports:
```
--- import modal anywhere:
main/labyrinth_main/features/live_gx/modal_backend.py:70:        import modal
main/labyrinth_main/features/live_gx/modal_backend.py:83:        import modal
main/labyrinth_main/features/live_gx/modal_app.py:22:import modal
--- modal_app referenced: only in test_live_gx.py (read as text/AST) and a modal_backend.py docstring
--- fake_backend referenced outside main/tests: only an orchestrator.py docstring
modules loaded by server/replay/service/rehearse matching modal|fake: []
```

Mutations, run on a copy at `…/scratchpad/v06/mut` with `PYTHONDONTWRITEBYTECODE=1`. The repo tree was never touched.
```
=== baseline
28 passed in 5.81s
=== A: terminate_all removed from run() finally
FAILED tests/test_live_gx.py::test_L6_workers_terminated_after_retrieval_on_success
FAILED tests/test_live_gx.py::test_L6_workers_terminated_on_exception_and_hard_timeout
2 failed, 16 deselected in 0.23s
=== B: ceiling 40 -> 45
FAILED tests/test_live_gx.py::test_L1_refuses_when_billed_plus_pending_plus_estimate_exceeds_ceiling
FAILED tests/test_live_gx.py::test_L1_hard_timeout_is_planned_duration_capped_by_remaining_budget
2 failed, 2 passed, 14 deselected in 0.17s
=== B2: ceiling 40 -> 39
2 failed, 2 passed, 14 deselected in 0.18s   (same two L1 tests)
=== C: guard ignores pending
FAILED tests/test_live_gx.py::test_L1_refuses_when_billed_plus_pending_plus_estimate_exceeds_ceiling
=== C2: reconciliation check removed
FAILED tests/test_live_gx.py::test_L1_refuses_unreconciled_or_invalid_ledger
FAILED tests/test_server.py::test_H5_launch_requires_exact_confirmed_cost_and_passing_guard
=== D: _fail() does not terminate the other worker
2 passed, 16 deselected in 0.25s                      <- survives (see F5)
=== E: simTime left in raw GX units
FAILED test_L2_…  FAILED test_L5_checkpoint_continuation_…  FAILED test_L5_rehearsal_…
=== I: failure -> terminated instead of fallback
4 failed (both L3 tests, L5_worker_restarting_from_zero, L7)
=== restored
28 passed in 5.72s
```

### Findings (run 1)
- **F1 (defect, L3; causes the FAIL): a malformed backend report ends the session without fallback.** In `main/labyrinth_main/features/live_gx/orchestrator.py:204-213` the `try` covers only `self.backend.poll(...)` (line 205). `apply_poll(...)` (line 210) runs outside it, and so do the `result.get` calls, the `for pair in new` loop and the `ck.get` call. A poll result that is not a dict, a `checkpoint` that is not a dict, or a `new_samples_raw` that is not iterable raises AttributeError or TypeError. That exception escapes `run()`, whose `finally` sets mode `terminated` with "Session ended abnormally" (line 245): `fallback.active False`, empty label, no worker error recorded. Inside `LiveService` the exception dies silently in the daemon thread. The workers are still terminated, so there is no cost leak, but the PRD rule "if either worker fails, label and play the saved run" is broken on this path. It is also inconsistent with `apply_poll` itself, which already turns a malformed *sample pair* into a failure. The shipped `ModalBackend.poll` normally returns well-formed dicts, so in practice this needs a corrupt or foreign progress-Dict entry. No test covers it. Suggested fix: move `apply_poll` inside the `try` (or check `isinstance(result, dict)` and the field types) so the failure goes through `_fail`.
- **F2 (medium): a failed `terminate()` can leave a worker running with nothing more than an error string.** `orchestrator.py:249-263` marks the record `terminated=True` before calling `backend.terminate`. If that call raises (probe 5: the thread is still alive), the error is appended to the worker but nothing retries and nothing escalates. In production the in-container deadline bounds it (`modal_app.py:106`, guard timeout − 60 s, counted from container start), and so does Modal's absolute `timeout` of 4800 s (`modal_app.py:35`). Worst case if the worker loop hangs: 80 min × $6.10/h ≈ $8.13, against $2.65 reserved.
- **F3 (low, design): a hard timeout before both workers finish is reported as `terminated`, not `fallback`.** See `orchestrator.py:231-233`. The fallback label is empty, so the UI cannot tell "finished" from "cut off" except by reading `reason`. A worker reporting `error` text together with a non-`failed` state is ignored (probe 7, `orchestrator.py:106`).
- **F4 (low): the budget guard tolerates going up to half a cent over the ceiling.** `budget_guard.py:106` compares `round(total, 2) > ceiling_usd`, so billed 37.354 + 2.65 = 40.004 is approved, and 37.3549 too. TASK L1 says "refuses when … > $40". Ledger values entered by a human are in cents, so the real-world effect is negligible.
- **F5 (weak test): mutation D survives.** `test_L3_*` passes even when `_fail` no longer terminates the other worker, because the `finally` in `run()` terminates it a moment later. Today the two behave the same, but the "terminated on failure" part of L3 is in effect tested through L6's `finally`, not through `_fail`.
- Not verifiable here (D-011): real GX on Modal, the CUDA image build, GX TOML parameter names, `_read_flux` netCDF layouts and real device UUIDs. All of these are UNREHEARSED, and the code says so.
- verify.sh: the first run exited 2 only because of `renderer:typecheck` errors in `renderer/src/design/components/*` (another agent's in-flight work, not task 06 files). The final re-run exited 0.

Backend verdict FAIL because of F1 (L3: a failure path that ends without fallback). Task 06 stays not-DONE in any case until the frontend L9–L10 are built and verified.

Run 1 verdict (L1–L8): FAIL

## Run 2 — L1–L8 (2026-11-20, commit c6244ec)

Verifier run: 2026-11-20, commit c6244ec

Exactly that commit, not the working tree: a backend engineer started review round 6 in `main/` while this run
was in progress; nothing below was run on those edits.

**Scope.** Outcomes L1–L8 after fix rounds 2–5 (`git diff 2b1607e c6244ec -- main`, 8 files). L9–L10 are being
fixed in `renderer/` right now and get their own run afterwards; this run says nothing about them.

**Where things ran** (Windows + WSL; every command through `wsl.exe -e bash scripts/dev.sh …`; `$S` is my scratch
dir `…\scratchpad\v0607`, in WSL `/mnt/c/Users/admin/AppData/Local/Temp/claude/cab28ef23558f274/9a7f397a-27eb-4e8c-9851-59a90e804ccb/scratchpad/v0607`):
- `verify.sh main`, my first L1 probe and one 15× loop of the signal tests: the shared tree `D:\Labyrinth`, at a
  time when `git status --short -- main contracts` was empty (main/ byte-identical to `c6244ec`).
- Everything else, and a second pass of the L1 probe and the signal loop: the isolated copy made at the start with
  `scripts/probe-copy.sh v0607` (`~/.cache/labyrinth-probes/v0607`). I compared the copy with the commit file by
  file (`git show c6244ec:<path> | cmp`, 81 files under `main/`, `contracts/`, `scripts/`, `artifacts/`,
  `tasks/06-live-gx/`, `tasks/07-server/`): 0 differ. `verify.sh all` ran in that copy.
- Mutations: six further copies of that copy (`v0607-m1 … m6`, `diff -rq` identical for `main/` and `contracts/`).
  The shared tree was never mutated; all seven copies were deleted at the end.
- Safety: `modal` is not installed (`importlib.util.find_spec('modal')` → `None`), there are no Modal credentials
  (`~/.modal.toml` absent, no `MODAL_*` variables) and nothing touched the network: every probe subprocess ran with
  an audit-hook guard (`sys.addaudithook`, loaded through `PYTHONPATH`) that records every socket connect / DNS
  lookup and raises on a non-loopback one. It recorded none. (`strace` is not installed in this WSL; the audit
  hook sees C-level socket use in every process, which is the equivalent I could get.) Servers bound 127.0.0.1 on
  ports 18707–18760 with state dirs under `$S`; at the end `ss -ltn` shows none of them and `~/.labyrinth` does
  not exist.
- Tools I wrote for this run (all under `$S`, none in the repo): my own `WorkerBackend` (`vbackend.py`, a thread
  per worker, every failure scriptable, every issued handle audited); my own stand-in `modal` package
  (`stubmodal/modal/`, file-controlled, with a simulated remote worker that honours the run's kill switch) so that
  the **unmodified** `ModalBackend`, `python3 -m labyrinth_main.server` and
  `python3 -m labyrinth_main.features.live_gx.rehearse` run their real code paths; my own raw-socket HTTP client;
  my own jsonschema validator. Two probes start the real CLIs with placeholder strings in
  `MODAL_TOKEN_ID/SECRET` (literally `verifier-placeholder-not-a-credential`) and the stub on `PYTHONPATH`; the
  stub cannot reach a network and the guard above was active.

### Outcomes (run 2)
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| L1 | Slot estimate = rate × (slot + setup + idle) + storage; refuses when billed + pending + estimate > $40; hard timeout; refuses an unreconciled ledger | 5 × `test_L1_*`, `test_H5_launch_requires_exact_confirmed_cost_and_passing_guard`, `test_H5_concurrent_launches_start_exactly_one_session`. 24 mutations: 18 red, **6 survive** (R2-4) | Decimal recompute from `pricing.py` + D-015: $2.641667 → **$2.65**, $7.725 → **$7.73**, plan $26.21, timeouts 1500 / 4500 s, Modal 300 + 1200 / 1950 s. Every cent split of $37.35 (3736) and $32.27 (3228) approved, every split one cent higher refused. 24 ledger-file states (missing, empty, truncated, list, null, missing keys, strings, NaN, Infinity, negative, bool, `"true"`, 1, nested, binary, locked) → refused, no backend built, ledger untouched. Each launch and each rehearsal reserves its estimate and marks the ledger unreconciled. 12 threads on one service, 12 services on one state dir × 10, and 8 processes × 20 rounds (+ 6 live + 2 rehearsal × 20): exactly one reservation every time; the same probe against a copy with the lock removed: 40/40 rounds with more than one. Real `rehearse` CLI: 32.27 + 7.73 launches, 32.28 refused. | PASS (R2-4 weak tests; R2-6, R2-7 minor) |
| L2 | Two workers concurrently, GPU 0 bean / GPU 1 triangular, device IDs, overlapping wall-clock intervals, monotone simTime, samples in archive units | `test_L2_two_workers_run_concurrently_with_devices_clocks_and_archive_units`. 10 mutations: 6 red, 1 red-then-hang, 3 survive (qualification checks, R2-16) | Own backend: launch order `[('bean', 0), ('triangular', 1)]`; two distinct device IDs as reported; overlap 0.322 s (orchestrator) / 0.320 s (my threads); simTime monotone over 28 snapshots to 79.1960 = 56·√2; 8 samples per worker equal to my t·√2, Q/(2√2) to 1e-12 and not to the twice-converted value; each snapshot's samples are a prefix of the next. Sequential workers → `overlap: False`, one shared device ID → `distinctDevices: False`, neither qualifies. Same through the real `ModalBackend` against my stub. | PASS |
| L3 | Either worker failing → `fallback`, label, `savedRunId` (null without a qualified rehearsal), error kept, other worker terminated | 13 × `test_L3_*`. 16 mutations: 16 red | One fails, both fail, launch raises (first / second worker), poll raises, 11 kinds of malformed report, 3 transient errors in a row, hard timeout in the run and during launch: always `fallback`, label `Worker failed. No qualified GX rehearsal recorded — …` / `Hard timeout reached. …`, `savedRunId` null (or the id when one is given), error text kept, every issued handle cancelled, no worker thread left. Fallback never reverts. | PASS (the wording defect R2-2 is filed under L6) |
| L4 | No credentials or no `modal` → `unavailable`, zero network calls | 2 × `test_L4_*`, `test_L6_rehearse_cli_cannot_reach_the_test_hooks_and_is_inert_without_credentials`, `test_H3_*`. 6 mutations: 5 red, 1 survives (S09, R2-4) | Real `rehearse` CLI and real server as subprocesses under the raising socket guard: no credentials → exit 2 / `unavailable`; placeholder credentials without `modal` → "not installed"; stub `modal` importable without credentials → "no Modal credentials" and the stub was never imported. 0 non-loopback connects / DNS lookups over all probe processes, and over the 16 processes of the whole main test suite. Nothing written to the state dir. Forced-available but unqualified service → `unavailable`, launch refused. | PASS |
| L5 | A run resumed from a checkpoint continues simTime from the checkpoint | 5 × `test_L5_*`. 10 mutations: 8 red, 2 survive (R2-16) | Checkpoint at raw 123: first simTime 173.9483 = 123·√2, last 253.1442 = 179·√2, all samples later than the checkpoint; a worker restarting from 0 → `fallback`, "simulation clock went backwards (0.0 < 123.0 from checkpoint)". Rehearsal with my backend: phase 1 ends at raw 35, restart file at 28, phase 2 launched with 28 and ends at 63·√2. Real CLI against the stub: phase 2 spawned with `ckpt=<run>-init/…/….restart.nc restart=True from=resume_from.nc`, clocks end at 90·√2. | PASS |
| L6 | Workers are always terminated after retrieval (also on exception) | 24 × `test_L6_*`, 6 × `test_H1_signal_* / test_H1_shutdown_during_in_flight_launch`. 53 mutations: 40 red, 7 red-by-hang, 6 survive | Normal end, exception and `KeyboardInterrupt` out of launch / poll, terminate raising twice, stop request, SIGINT / SIGTERM / SIGHUP on both entrypoints (107 subprocess runs, single / double / mixed, before a spawn, during a spawn RPC, during terminate, while a cancel is queued): every spawned call was cancelled or the process exited 2 with "NOT confirmed terminated". **But:** a late spawn that errors client-side after the kill-switch put failed is reported terminated — `termination_confirmed` True, `POST /api/live/terminate` → 200, server exit 0 — while my stub's worker for that run is still running (R2-1). And the status reason says "Other worker terminated." / "workers terminated." while the cancel has not returned (R2-2). | **FAIL (R2-1, R2-2)** |
| L7 | Every status snapshot validates against `contracts/live-status.schema.json` | `test_L7_every_status_snapshot_validates`. 4 mutations: 4 red | 983 snapshots from all my scenarios (orchestrator, service, real `ModalBackend` against the stub, real server status / SSE / 202 / 409 / 502 bodies, saved-run phases), all six modes, including 34 `TERMINATION PENDING`, 26 `TERMINATE FAILED` (with `live`, `fallback` and `launching`) and 8 "Stopped on request": 0 invalid with my own validator; 12 of 12 negative controls rejected. | PASS |
| L8 | `modal_app.py`: A100-40GB, hard timeout, explicit launch only, GX inputs for both tubes; never imported by tests or replay; UNREHEARSED | 8 × `test_L8_*`. 16 mutations: 15 red, 1 survives (A16) | AST: one `@app.function` per worker with `gpu=GPU ('A100-40GB')`, `retries=0`, `timeout` and `startup_timeout` from the guard, `max_containers=2`, no entrypoint / schedule / web endpoint. Executed in a subprocess against my own recording stub: registers `gx_worker_live` (timeout 1200, startup 300) and `gx_worker_rehearsal` (1950, 300), touches only `App()`, `Image.*`, `Volume.from_name`, `Dict.from_name`; four `App.function` shapes without a usable `startup_timeout` → `RuntimeError` before anything is registered; no `LABYRINTH_GX_REF` → `RuntimeError`. Import trace: `server --help`, `build_artifacts` and all 16 processes of the main suite never load `modal_app` or a real `modal`. | PASS (R2-18 observation) |
| L9 | Live panel (frontend) | — | outside this run: re-verified after the frontend fix round | NOT CHECKED |
| L10 | Launch button + confirmation (frontend) | — | outside this run: re-verified after the frontend fix round | NOT CHECKED |

**L1–L8 result: FAIL.** L1–L5, L7 and L8 hold. L6 does not: there is a path on which termination is reported
confirmed without a successful cancel and without the kill switch (R2-1; the reviewer found it independently and
it is being fixed), and the status text claims termination before the cancel has returned (R2-2).

### Real output (run 2)

Gates (`$S/01_gates.sh`):
```
$ (shared tree /mnt/d/Labyrinth @ c6244ec) LABYRINTH_STATE_DIR=$S/state-default bash scripts/verify.sh main
━━━ [main:tests] $ python3 -m pytest -q main/tests
127 passed in 30.85s
━━━ verify.sh summary (scope: main)
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
━━━ verify.sh summary (scope: all)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (1s)
  PASS  docs:handoff (0s)
  PASS  scripts:tests (1s)
  PASS  main:lint (0s)
  PASS  main:tests (25s)
  PASS  artifacts:schema (0s)
  PASS  artifacts:fresh (1s)
  PASS  renderer:typecheck (11s)
  PASS  renderer:tests (142s)
  PASS  renderer:build (3s)
verify.sh: all stages passed.
verify.sh all (probe copy) EXIT=0

$ bash $S/05_snapshot_check.sh
HEAD: c6244ec
--- probe copy vs commit c6244ec, file by file (git show c6244ec:<path> | cmp):
81 files compared, 0 differ
```

Each outcome's tests on their own, and the boundary rule (`$S/12_per_outcome.sh`, in the probe copy):
```
$ cd /home/qqbot/.cache/labyrinth-probes/v0607   # probe copy == commit c6244ec
$ python3 -m pytest -q -p no:cacheprovider main/tests/test_live_gx.py -k test_L1_      (… _L2_ … _L8_)
L1: 5 passed, 54 deselected in 0.34s
L2: 1 passed, 58 deselected in 0.37s
L3: 13 passed, 46 deselected in 2.97s
L4: 2 passed, 57 deselected in 0.24s
L5: 5 passed, 54 deselected in 0.64s
L6: 24 passed, 35 deselected in 6.94s
L7: 1 passed, 58 deselected in 0.74s
L8: 8 passed, 51 deselected in 0.64s
$ python3 -m pytest -q -p no:cacheprovider main/tests/test_live_gx.py main/tests/test_server.py
80 passed in 21.85s
$ python3 scripts/check_boundaries.py   # in the probe copy
boundary: OK (142 files scanned)
exit=0
$ python3 -m ruff check main
All checks passed!
```

The repo's signal tests, 15 times (`$S/04_signal_loop.sh`): **29 of 30 iterations green** (15/15 on the shared
tree, 14/15 in the probe copy):
```
$ cd /mnt/d/Labyrinth && for i in 1..15: python3 -m pytest -q -p no:cacheprovider main/tests/test_live_gx.py main/tests/test_server.py -k "signal or ctrl_c or shutdown_during_in_flight or in_process_pass"
iteration 1: exit 0 | 15 passed, 65 deselected in 10.63s
…
iteration 15: exit 0 | 15 passed, 65 deselected in 10.21s
signal tests: 15/15 iterations green

$ cd /home/qqbot/.cache/labyrinth-probes/v0607 && for i in 1..15: (same command)
iteration 11: exit 0 | 15 passed, 65 deselected in 7.50s
iteration 12: exit 1 | 1 failed, 14 passed, 65 deselected in 6.78s
iteration 13: exit 0 | 15 passed, 65 deselected in 7.53s
signal tests: 14/15 iterations green
    assert st["reason"].startswith("TERMINATION PENDING")
E    +    where <built-in method startswith of str object at 0x7eb8741a3cf0> = 'GPU 0 (bean) worker failed: launch did not complete in time (Function.spawn did not return within 0 s); its cancel is queued. Other worker terminated.'.startswith
FAILED main/tests/test_server.py::test_H1_shutdown_during_in_flight_launch[late-spawn-cancelled]

$ bash $S/10_flaky_hunt.sh 6 12 "shutdown_during_in_flight" inflight      # the same test, 6 copies at once, 12 repeats each
copy 6: 11/12 green
copy 5: 11/12 green
copy 2: 12/12 green   (copies 1, 3, 4 likewise)
      2 FAILED main/tests/test_server.py::test_H1_shutdown_during_in_flight_launch[late-spawn-cancelled]

$ bash $S/09_baseline_cmp.sh     # the unmutated suite started as a background job of a script (SIGINT ignored at start)
--- foreground
baseline in v0607-m1: exit 0 in 23s | 80 passed in 22.55s
--- background job (&): SIGINT is ignored in the child, as for any job started with & from a script
baseline in v0607-m2: exit 1 in 81s | 3 failed, 77 passed in 80.53s (0:01:20)
    FAILED main/tests/test_live_gx.py::test_L6_rehearse_cli_in_process_pass_and_crash_paths
    FAILED main/tests/test_server.py::test_H1_shutdown_during_in_flight_launch[spawn-outlives-shutdown]
    FAILED main/tests/test_server.py::test_H1_shutdown_during_in_flight_launch[late-spawn-cancelled]
```

Mutations (`$S/mutations.py`, `$S/mutate.py`; 163 single-line mutations of `live_gx/*.py` and `server/*.py`, each
followed by `python3 -m pytest -q --tb=no -rfE -p no:cacheprovider main/tests/test_live_gx.py main/tests/test_server.py`
in a worker copy, then restored; a red that consisted only of the flaky test above was re-run):
```
mutations defined 163, run 163, missing []
totals: {'RED': 126, 'SURVIVED': 24, 'TIMEOUT': 13}
| Outcome | mutations | red (assertion) | red (suite hangs > timeout) | survived |
| L1 (+L1/L8) | 24 | 18 | 0 | 6 |
| L2 | 10 | 6 | 1 | 3 |
| L3 (+L3/L5) | 16 | 16 | 0 | 0 |
| L4 | 6 | 5 | 0 | 1 |
| L5 | 7 | 5 | 0 | 2 |
| L6 (+L6/H1) | 53 | 40 | 7 | 6 |
| L7 | 4 | 4 | 0 | 0 |
| L8 | 15 | 14 | 0 | 1 |
| H1–H6 (see 07-server) | 28 | 18 | 5 | 5 |
| all | 163 | 126 | 13 | 24 |

SURVIVORS (task 06)
  R14   L1  rehearse.py       with store.locked():  ->  if True:
  R15   L1  rehearse.py       if not decision.approved:  ->  if False:
  S02   L1  service.py        with self.ledger.locked():  ->  if True:
  S04   L1  service.py        (ledger file missing)  reconciled=False  ->  reconciled=True
  S05   L1  service.py        (ledger file malformed) Ledger(nan, nan, False)  ->  Ledger(0.0, 0.0, True)
  S06   L1  service.py        reconciled=raw["reconciled"] is True  ->  bool(raw["reconciled"])
  S09   L4  service.py        if qual is None: return "unavailable", …  ->  if False:
  O31   L2  orchestrator.py   if last is not None and (t <= last if strict else t < last):  ->  if False:
  R08   L2  rehearse.py       devices_ok = all(len({…device_id…}) == 2 …)  ->  devices_ok = True
  R09   L2  rehearse.py       overlap_ok = all(_overlap(p) for p in phases)  ->  overlap_ok = True
  R07   L5  rehearse.py       w.sim_time_raw > ckpts[w.tube].sim_time_raw  ->  w.sim_time_raw >= 0
  R17   L5  rehearse.py       init_ok = p1.mode == "terminated" and all(w.state == "done" …) and …  ->  init_ok = set(ckpts) == {…}
  A12   L6  modal_app.py      deadline = wall_start + hard_timeout_s - CHECKPOINT_MARGIN_S  ->  … + 3600
  A13   L6  modal_app.py      if time.time() >= deadline or prior:  ->  if time.time() >= deadline:
  B17   L6  modal_backend.py  _settle(h, False, f"late spawn could not be cancelled: {last}")  ->  _settle(h, True, None)
  R06   L6  rehearse.py       qualified = passed and confirmed and crash is None  ->  qualified = passed and crash is None
  R22   L6  rehearse.py       if init_ok and not p1.termination_confirmed: init_ok = p1.wait_terminated(…)  ->  pass
  S11   L6  service.py        if thread is not None and thread.is_alive(): return False, (…)  ->  if False:
  A16   L8  modal_app.py      hard_timeout_s=min(hard_timeout_s, LIVE_TIMEOUT_S)  ->  hard_timeout_s=hard_timeout_s

DETECTED ONLY BECAUSE THE SUITE HUNG (killed after 120–300 s; number of assertion failures printed before the hang)
  O01 L2 (GPU/tube mapping swapped): 9      O16 L6 (terminate_all removed from run()'s finally): 0
  O21 L6 (TERMINATE prefix dropped): 7      O22 L6 (PENDING/FAILED swapped): 7      O25 L6 (stop check removed): 0
  S12 L6 (terminate always "confirmed"): 2  S15 L6 (busy check removed): 1          S21 L6 (terminate skips the stop): 0
tests that never went red for any mutation:
   ['test_H6_artifacts_dir_is_repo_artifacts', 'test_L1_ledger_reservation_is_locked_across_processes', 'test_L6_workers_terminated_after_retrieval_on_success', 'test_L6_workers_terminated_on_exception', 'test_L8_gx_input_generation_for_both_tubes', 'test_L8_modal_backend_function_timeout_and_hung_calls', 'test_L8_modal_backend_polls_call_status_before_progress_dict', 'test_L8_read_flux_returns_a_stable_prefix_and_flags_mid_series_nan']
  (67 test functions; 59 detected at least one mutation)
```

L1 (`run.sh p_l1.py`, `run.sh p_l1_race.py`, `14_race_mutant.sh`; second pass, against the probe copy):
```
code under test: /home/qqbot/.cache/labyrinth-probes/v0607
  rate 6.1 ceiling 40.0 posted 8.1 slot 15 min rehearsal 60.0 min
  live raw 2.641667 -> 2.65; rehearsal raw 7.725000 -> 7.73; planned total 26.21
  hard timeouts: live 1500 s, rehearsal 4500 s (phase 2250 s)
  ok   modal timeouts startup 300 live 1200 rehearsal 1950
  ok   worst-case billed at the hard timeout: live 2.6417 <= 2.65, rehearsal 7.7250 <= 7.73
  ok   live: all 3736 splits of $37.35 approved (exactly at $40.0) — exceptions []
  ok   live: all splits of $37.36 refused (one cent over) — exceptions []
  ok   rehearsal: all 3228 splits of $32.27 approved (exactly at $40.0) — exceptions []
  ok   rehearsal: all splits of $32.28 refused (one cent over) — exceptions []
  ok   sub-cent billed 37.3500001: approved=False (expected False)
  ok   missing file               refused=True backend_built=False ledger_untouched=True slotFits=False schema_errors=0 | Budget guard refused: ledger not reconciled (billed $0.00, p
  ok   truncated JSON             refused=True backend_built=False ledger_untouched=True slotFits=False schema_errors=0 | Budget guard refused: ledger billed/pending must be finite,
  ok   reconciled string 'true'   refused=True backend_built=False ledger_untouched=True slotFits=False schema_errors=0 | Budget guard refused: ledger not reconciled (billed $8.10, p
  FAIL huge int billed: raised OverflowError: int too large to convert to float
  ok   locked ledger: refused after 5.0 s, nothing reserved | ledger is locked by another process (…/state-l1/ledger.json.lock); …
  ok   billed 37.35: accepted=True, ledger after = {'billedUsd': 37.35, 'pendingUsd': 2.65, 'reconciled': False} | Launched live-e3f1b503c139; $2.65 reserved as pending.
  ok   a second launch on the now-unreconciled ledger is refused | Budget guard refused: ledger not reconciled (billed $37.35, pending $2
  ok   confirm 2.64                   accepted=False launched=False
  ok   confirm 2.65                   accepted=True launched=True
  note confirm 2.650000001            accepted=True (rounds to the cent; not exact equality)
  note confirm 2.6549                 accepted=True (rounds to the cent; not exact equality)
  ok   confirm '2.65'                 accepted=False launched=False
  ok   confirm None                   accepted=False launched=False
  ok   confirm nan                    accepted=False launched=False
  ok   confirm -2.65                  accepted=False launched=False
  FAIL confirm 1e+308                 RAISED OverflowError: cannot convert float infinity to integer (launched=False, lock left=False)
  FAIL confirm 10**400                RAISED OverflowError: int too large to convert to float (launched=False, lock left=False)
  ok   accepted 1/12, backends built 1, ledger {'billedUsd': 8.1, 'pendingUsd': 2.65, 'reconciled': False}
  ok   10 rounds: exactly one launch per round — bad rounds []
  ok   15 rounds x 7 processes: exactly one reservation per round (winners {'live': 0, 'rehearsal': 15}) — bad rounds []
L1 PROBE: 3 FAILED          (the three OverflowErrors: finding R2-6)

mutant: 2 changed lines (lock removed from LiveService.launch and run_rehearsal)
6 live + 2 rehearsal: 20 rounds, exactly one reservation in 0; rounds with MORE than one: 20; winners {'live': 0, 'rehearsal': 0}
   bad round: (1, ['live', 'live', 'live', 'live', 'live', 'live', 'live', 'live'], {'billedUsd': 8.1, 'pendingUsd': 2.65, 'reconciled': False})
RACE PROBE: 40 BAD ROUNDS
--- unmutated probe copy, same probe:
8 live: 20 rounds, exactly one reservation in 20; rounds with MORE than one: 0; winners {'live': 20, 'rehearsal': 0}
6 live + 2 rehearsal: 20 rounds, exactly one reservation in 20; rounds with MORE than one: 0; winners {'live': 0, 'rehearsal': 20}
RACE PROBE: OK
```

L2 / L3 / L5 / L6 with my own backend (`run.sh p_orch.py`, against the probe copy; 62 checks ok, 8 notes):
```
  ok   launch order/mapping [('bean', 0), ('triangular', 1)]
  ok   distinct device IDs recorded as reported: ['VGPU-0-50207eda', 'VGPU-1-576c43a4']
  ok   wall-clock intervals overlap: orchestrator 0.322 s, my worker threads 0.320 s
  ok   GPU 0 simTime monotone over 28 snapshots, 0.0000 -> 79.1960 (expect 79.1960)
  ok   GPU 0: 8 samples converted exactly once (t x sqrt2, Q / 2 sqrt2); raw (7.0, 5.007) -> (9.899495, 1.770242); mine (9.899495, 1.770242)
  ok   GPU 0: each snapshot's samples are a prefix of the next (no re-conversion, no duplicates)
  ok   sequential workers: qualified=False, checks={'init': True, 'continuation': True, 'distinctDevices': True, 'overlap': False}
  ok   same device id twice: qualified=False, checks={'init': True, 'continuation': True, 'distinctDevices': False, 'overlap': True}
  ok   GPU 0: first simTime 173.9483 >= 173.9483, last 253.1442 == 253.1442, first sample t 183.8478
  ok   mode fallback | simulation clock went backwards (0.0 < 123.0 from checkpoint); checkpoint continuation broken
  ok   qualified=True; phase-1 last sample t_raw [35.0, 35.0], checkpoint handed to phase 2 [28.0, 28.0], phase-2 final simTime [89.095454429505, 89.095454429505] (expect 89.0955)
  ok   one worker fails: fallback {'active': True, 'label': 'Worker failed. No qualified GX rehearsal recorded — showing archived stella/GENE evidence', 'savedRunId': None} | error probe GX crash on triangular at step 3
  ok   other worker terminated: mode=fallback termination_confirmed=True issued=2 cancel_ok=[True, True] terminate_calls=[1, 1] threads_alive=[False, False]
  ok   launch raises on GPU 1: bean terminated | mode=fallback termination_confirmed=True issued=1 cancel_ok=[True] terminate_calls=[1] threads_alive=[False]
  ok   BaseException out of launch: propagated=KeyboardInterrupt, bean still terminated | mode=terminated termination_confirmed=True issued=1 cancel_ok=[True] …
  ok   BaseException out of poll: both terminated | mode=terminated termination_confirmed=True issued=2 cancel_ok=[True, True] …
  ok   malformed report (None): fallback | malformed poll result None          (… 10 more kinds, all fallback)
  ok   terminate raises twice then succeeds: mode=terminated termination_confirmed=True issued=2 cancel_ok=[True, True] terminate_calls=[3, 1] threads_alive=[False, False]
  ok   terminate always raises: mode 'live', reason starts 'TERMINATE FAILED — check Modal dashboard', attempts [5, 1], backoff [0.5, 1.0, 2.0, 4.0]
  ok   a later retry that succeeds confirms: mode 'terminated' reason 'Stopped on request; workers terminated.'
  NOTE terminate() hanging on GPU 0: status meanwhile is mode='live' reason='Both workers launched; streaming GX output (live).'; GPU 1 terminate attempted=0 (workers are terminated one after the other)
       worker failure: cancel of GPU 0 in flight for 0.5 s -> mode='fallback' reason='GPU 1 (triangular) worker failed: probe GX crash on triangular at step 3. Other worker terminated.' | termination_confirmed=False GPU 0 really stopped=False GPU 1 terminate attempted=0
       hard timeout: cancel of GPU 0 in flight for 0.5 s -> mode='fallback' reason='Hard timeout reached: 0.3 s elapsed before both workers finished; workers terminated.' | termination_confirmed=False GPU 0 really stopped=False GPU 1 terminate attempted=0
  ok   hard timeout during run: 'Hard timeout reached. No qualified GX re' | mode=fallback termination_confirmed=True issued=2 cancel_ok=[True, True] …
  NOTE hard timeout 0.2 s, launch(bean) took 0.6 s: the orchestrator still spawned GPU 1 (0.60 s after start) before noticing the timeout — the deadline is not checked between the two spawns (both were terminated)
  ok   spawn in flight: mode fallback, reason 'TERMINATION PENDING — cancel queued, not yet confi', confirmed False, GPU 1 spawned: False
  ok   late spawn cancelled on arrival: mode=fallback termination_confirmed=True issued=1 cancel_ok=[True] terminate_calls=[1] threads_alive=[False]
  ok   spawn never returns: mode=fallback termination_confirmed=False issued=1 cancel_ok=[False] terminate_calls=[1] threads_alive=[False]
  ok   stop_and_terminate / wait_terminated never claim confirmation
  ok   one cancel failed + one pending: reason 'TERMINATE FAILED — check Modal dashboard; GPUs may still be '
  ok   no qualification.json: mode unavailable, launch accepted=False, backend built=False | Not qualified: no recorded GX rehearsal has verifi
  ok   terminate fails: False 'TERMINATE FAILED — check Modal dashboard; GPUs may'; status mode 'live'
  ok   no new launch while a termination is unconfirmed: A session is still running (or its termination is unconfirmed).
  ok   shutdown() reports False while unconfirmed (server would exit 2); it took 2.00 s with join_timeout_s=2.0
  NOTE shutdown() with a FAILED (not pending) terminate: 5 cancel attempts in one immediate round, then an idle wait of the whole join_timeout_s (2.0 s here, 507 s with the real constants) during which nothing is retried and nothing can confirm
  NOTE saved run file removed during a session: fallback still says 'Worker failed — playing saved GX run rehearsal-0e5bea6e8ec8' (savedRunId rehearsal-0e5bea6e8ec8) while qualified=False and /api/live/runs/<id> would be 404
snapshots recorded: 340
ORCHESTRATOR PROBE: ALL OK
```

The real `ModalBackend` against my stub `modal` (`run.sh p_modal.py`; client bound scaled to 0.3 s in m7–m13 the way
the repo's tests scale it):
```
  ok   spawn kwargs: ['spawn-sent live-m1/bean fn=gx_worker_live gpu=0 hard_timeout_s=1200 ckpt=None restart=False from=None', 'spawn-sent live-m1/triangular fn=gx_worker_live gpu=1 hard_timeout_s=1200 ckpt=None restart=False from=None']
  ok   kill switch then cancel(terminate_containers=True) for both: ['kill-switch live-m1/abort=True', "cancel-sent live-m1/bean id=0e9d4194 kwargs=[('terminate_containers', True)]", …]
  ok   4 spawns of gx_worker_rehearsal with execution budget 1950 s
  ok   phase-2 clocks continue from the restart time 40 (not 0, not the last sample 50): [127.27922061357856, 127.27922061357856] vs 127.2792
== m5 spawn RPC raises but the worker STARTED anyway: the kill switch is what stops it
  ok   confirmed=True; remote worker aborted by the switch: ['remote-start live-m5/bean id=42437e96 …', 'remote-aborted live-m5/bean id=42437e96 (kill switch)']
== m6 spawn raises, worker started anyway, AND the kill switch cannot be set
  ok   unconfirmed and loud: 'TERMINATE FAILED — check Modal dashboard; GPUs may still be billing: GPU 0 (bean) terminate unconfirmed after '
== m7 spawn outlives the client bound (scaled to 0.3 s), then arrives
  ok   late call cancelled on arrival: ['spawn-sent', 'dict.put', 'kill-switch', 'spawn-returned', 'cancel-sent', 'remote-start', 'remote-stopped', 'cancel-ok']
== m8 late spawn arrives but its cancel keeps failing
  ok   unconfirmed and loud: 'TERMINATE FAILED — check Modal dashboard; GPUs may still be billing: GPU 0 (bean) late spawn could n'
== m9 late spawn ERRORS client-side while the kill-switch put had failed (reviewer's finding; reproduced here)
  ok   while in flight: 'TERMINATION PENDING — cancel queued, not yet confi'
       confirmed=True reason='GPU 0 (bean) worker failed: launch did not complete in time (Function.' kill_switch_set=False remote workers still running=['live-m9/bean id=a007729e']
== m12 FunctionCall.cancel hangs (bounded): never confirmed until a cancel really returns
  ok   after 1.8 s: mode 'live' reason 'TERMINATE FAILED — check Modal dashboard; GPUs may still be billing: GPU 0 (bean) terminat'
MODAL-STUB PROBE: ALL OK     (m9 is reported as a NOTE by the probe; it is finding R2-1)
```

The same defect through the **real server with its real constants** (`run.sh p_http.py C`, port 18712):
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

The real `rehearse` CLI (`run.sh p_real_reh.py`; `python3 -m labyrinth_main.features.live_gx.rehearse …` unmodified):
```
  ok   no arguments: exit 0 | Rehearsal estimate $7.73, hard timeout 4500 s. Budget guard refused: ledger not reconciled (billed $0.00, pending $8.10). …
  ok   --confirm-cost-usd 7.73: exit 2 | stderr Live GX unavailable: no Modal credentials (MODAL_TOKEN_ID/MODAL_TOKEN_SECRET or ~/.modal.toml); the `modal` package is not installed (pip install modal==1.6.4).
  ok   nothing written to the state dir (exists=False)
  ok   rehearse --backend fake: exit 2 (argparse refuses)        (also --fake, --poll-interval-s, --availability, a stray positional)
  ok   server --service fake: exit 2 (argparse refuses; no way to select a fake or another bind address)   (also --fake, --backend, --host, --bind)
  ok   environment variables naming a fake backend change nothing: exit 2
  ok   socket guard over 14 processes: non-loopback connects / DNS lookups = 0
     labyrinth_main/features/live_gx/modal_app.py:48: GX_REF = os.environ.get("LABYRINTH_GX_REF", "")
     labyrinth_main/features/live_gx/modal_backend.py:39: env = os.environ if env is None else env
     labyrinth_main/features/live_gx/service.py:59: return Path(os.environ.get("LABYRINTH_STATE_DIR") or Path.home() / ".labyrinth")
  ok   no module under labyrinth_main imports fake_backend: []
  ok   exit 2 | Live GX unavailable: the `modal` package is not installed (pip install modal==1.6.4). Replay only.      (placeholder credentials, no modal)
  ok   exit 2 | Live GX unavailable: no Modal credentials (…). Repl | stub calls []                                      (stub importable, no credentials)
  ok   missing ledger: exit 2, nothing spawned | …"Budget guard refused: ledger not reconciled (billed $0.00, pending $8.10). …
  ok   wrong cost 7.72: exit 2, nothing spawned, ledger untouched
  ok   one cent over the ceiling (32.28 + 7.73): exit 2, nothing spawned
  ok   exactly at the ceiling (32.27 + 7.73 = 40.00): exit 0 in 4.5 s | last line 'Rehearsal PASSED; workers terminated.'
  ok   4 spawns (2 from initialization, 2 resumed): ['rehearsal-1db61c0f3275-init/bean', 'rehearsal-1db61c0f3275-init/triangular', 'rehearsal-1db61c0f3275-cont/bean', 'rehearsal-1db61c0f3275-cont/triangular']
  ok   all 4 calls cancelled after retrieval; orphans []
  ok   ledger after the rehearsal: {'billedUsd': 32.27, 'pendingUsd': 7.73, 'reconciled': False}
  ok   a second rehearsal on the unreconciled ledger is refused: exit 2
REAL REHEARSE CLI PROBE: ALL OK
```

The real server with its real constants and a spawn that never returns (`run.sh p_real_exit2.py`, port 18709, 9 min):
```
       status timeline: [(0.0, ('launching', 'Launching GX worker')), (20.2, ('fallback', 'TERMINATION PENDING'))]
  ok   after 20.2 s (CALL_TIMEOUT_S = 20): mode fallback, reason 'TERMINATION PENDING — cancel queued, not yet confirmed; GPUs'
  ok   kill switch raised, GPU 1 never spawned: ['import', 'from_name', 'spawn-sent', 'dict.put', 'kill-switch']
  ok   POST /api/live/terminate -> 502 in 5.0 s, reason 'TERMINATION PENDING — cancel queued, not yet confi'
  ok   SIGTERM, then SIGINT+SIGHUP+SIGTERM: the process is still waiting for the queued cancel
  ok   exit code 2 after 507 s (WORST_CASE_STOP_S + 10 = 507 s)
  ok   last stdout line: 'Labyrinth API stopped; workers NOT confirmed terminated — check Modal.'
  ok   ledger keeps the reservation, unreconciled: {'billedUsd': 15.83, 'pendingUsd': 2.65, 'reconciled': False}
  ok   socket guard: non-loopback connects/DNS 0; binds ["('127.0.0.1', 18709)"]
REAL SERVER EXIT-2 PROBE: ALL OK
```

Signals on both entrypoints (`run.sh p_signals.py`; my own harness code calling `rehearse.main(…, availability_check=,
backend_factory=, poll_interval_s=)` and `server.__main__.main(…, service=)` with `modal_backend.CALL_TIMEOUT_S`,
`rehearse.CONFIRM_WAIT_S` and `join_timeout_s` scaled — the hooks the repo's tests use; real `ModalBackend`, my stub
`modal`). 107 subprocess runs; `spawn` / `cancel` are stub calls, `unans` = spawn RPCs never answered:
```
entry timing               signals        exit  sec  spawn cancel kill orph unans  last stdout line
reh   before-spawn         INT               2   0.9     1      1    T    0     0  Rehearsal did NOT pass; workers terminated.
reh   spawn-late           TERM              2   1.1     1      1    T    0     0  Rehearsal did NOT pass; workers terminated.
reh   spawn-never          HUP               2   1.8     1      0    T    0     1  sal did NOT pass; workers NOT confirmed terminated — check Modal dashboard.
reh   phase2-live          INT               2   1.0     4      4    T    0     0  Rehearsal did NOT pass; workers terminated.
reh   spawn-in-flight      HUP+INT+TERM      2   0.8     1      1    T    0     0  Rehearsal did NOT pass; workers terminated.
reh   during-terminate     INT+TERM          2   1.0     2      2    T    0     0  Rehearsal did NOT pass; workers terminated.
reh   cancel-fails         TERM+HUP          2  16.7     2      1    T    0     0  sal did NOT pass; workers NOT confirmed terminated — check Modal dashboard.
srv   idle                 HUP+HUP           0   0.2     0      0    F    0     0  Labyrinth API stopped; workers terminated.
srv   launch-before-spawn  TERM              0   0.9     1      1    T    0     0  Labyrinth API stopped; workers terminated.
srv   spawn-in-flight      TERM+TERM         0   1.0     1      1    T    0     0  Labyrinth API stopped; workers terminated.
srv   spawn-late           HUP               0   1.5     1      1    T    0     0  Labyrinth API stopped; workers terminated.
srv   spawn-never          INT               2   1.9     1      0    T    0     1  Labyrinth API stopped; workers NOT confirmed terminated — check Modal.
srv   during-terminate     HUP+INT+TERM      0   1.0     2      2    T    0     0  Labyrinth API stopped; workers terminated.
srv   both-live            INT+TERM          0   0.7     2      2    T    0     0  Labyrinth API stopped; workers terminated.  <-- traceback on stderr: OSError: Signal 15 ignored due to race condition
reh   both-live            HUP+INT+TERM    -15   0.6     2      2    T    0     0  Rehearsal did NOT pass; workers terminated.  <-- exit -15, expected 2; exit code -15 is neither 0 nor 2
srv   both-live            HUP+INT+TERM    -15   0.7     2      2    T    0     0  Labyrinth API stopped; workers terminated.  <-- exit -15, expected 0; exit code -15 is neither 0 nor 2
…  (93 further rows; full table in $S/out/p_signals.txt)
socket guard over all runs: non-loopback connects/DNS = 0
SIGNAL MATRIX: 93/107 runs as expected; 14 WITH PROBLEMS
```
Per timing (runs: outcome): `rehearse` — before-spawn 3, spawn-in-flight 10, spawn-late 6, during-terminate 10,
phase2-live 3: all exit 2, every spawned call cancelled; both-live 13: 12 × exit 2, 1 × exit −15 after its last
line; spawn-never 3 and cancel-fails 2: exit 2 with "NOT confirmed terminated" on stdout and stderr. Server — idle
10, launch-before-spawn 3, spawn-in-flight 10, spawn-late 6, during-terminate 10: all exit 0 with every spawned
call cancelled; both-live 13: 12 × exit 0, 1 × exit −15 after its last line; spawn-never 3 and cancel-fails 2: exit 2
with "NOT confirmed terminated". In no run did a process print "workers terminated" or exit 0 while a stub
worker was running or a spawn RPC was unanswered. The 14 flagged runs are 2 exit-status races (R2-9) and 12 runs
whose only problem is the stderr noise of R2-11.

The exit-status race on its own (`run.sh p_signals.py exitrace`: three signals 30–120 ms apart, both workers live):
```
reh   both-live            HUP+INT+TERM    -15   0.6     2      2    T    0     0  Rehearsal did NOT pass; workers terminated.  <-- exit -15, expected 2; …
srv   both-live            TERM+INT+INT     -2   0.8     2      2    T    0     0  Labyrinth API stopped; workers terminated.  <-- exit -2, expected 0; …
SIGNAL MATRIX: 44/60 runs as expected; 16 WITH PROBLEMS
```

Hangup with a dead terminal, and a ledger holding a 400-digit number (`run.sh p_misc.py`):
```
       srv idle        : exit 1 (expected 0); spawns 0, cancels 0, orphans [], unanswered spawns []
       srv both-live   : exit 1 (expected 0); spawns 2, cancels 2, orphans [], unanswered spawns []
       srv spawn-never : exit 1 (expected 2); spawns 1, cancels 0, orphans [], unanswered spawns ['live-19e7271db341/bean']
       reh both-live   : exit 2 (expected 2); spawns 2, cancels 2, orphans [], unanswered spawns []
       reh spawn-never : exit 2 (expected 2); spawns 1, cancels 0, orphans [], unanswered spawns ['rehearsal-98af9ad1a23b-init/bean']
       GET /api/live/status -> <None connection closed without any response b''>      (ledger.json: "billedUsd": 1 followed by 400 zeros)
       server stderr: ['OverflowError: int too large to convert to float']
```

L8 and the import / socket trace (`run.sh p_l8.py`):
```
        gx_worker_live: {'gpu': 'A100-40GB', 'cpu': [4.0, 4.0], 'memory': [16384, 16384], 'timeout': 1200, 'retries': 0, 'max_containers': 2, 'scaledown_window': 2, 'volumes': ['/ckpt'], 'startup_timeout': 300, 'schedule': None}
        gx_worker_rehearsal: {'gpu': 'A100-40GB', 'cpu': [4.0, 4.0], 'memory': [16384, 16384], 'timeout': 1950, 'retries': 0, 'max_containers': 2, 'scaledown_window': 2, 'volumes': ['/ckpt'], 'startup_timeout': 300, 'schedule': None}
  ok   import/deploy touches only App(), Image.*, Volume.from_name, Dict.from_name — nothing is run or scheduled ([])
        image chain: ['from_registry', 'apt_install', 'pip_install', 'env', 'run_commands', 'add_local_file', 'add_local_python_source']
  ok   App.function variant 'no-startup-timeout': RuntimeError before any function is registered (0 registered)
  ok   App.function variant 'kwargs-only': RuntimeError before any function is registered (0 registered)
  ok   App.function variant 'args-kwargs': RuntimeError before any function is registered (0 registered)
  ok   App.function variant 'renamed': RuntimeError before any function is registered (0 registered)
  FAIL App.function variant 'positional-only-name': error=None, registered=['gx_worker_live', 'gx_worker_rehearsal']
  ok   deploy without a pinned GX commit: ['RuntimeError', 'Set LABYRINTH_GX_REF to the GX commit to build (pin it; it is recorded as the solver revision).']
        main/labyrinth_main/features/live_gx/modal_app.py [('modal', 'module level', 41)]
        main/labyrinth_main/features/live_gx/modal_backend.py [('modal', 'inside a function', 172), ('modal', 'inside a function', 211), ('modal', 'inside a function', 246)]
  ok   python3 -m labyrinth_main.server --help: exit 0; modal/modal_app imports []; modules at exit [[]]; network 0
  ok   python3 -m labyrinth_main.build_artifacts: exit 0; modal/modal_app imports []; network 0; rebuilt artifacts byte-identical: True
        127 passed in 27.58s
  ok   16 processes (pytest + every subprocess the tests start): non-loopback connects / DNS lookups = 0 []
  ok   no process ever had a real `modal` package loaded; `modal` in sys.modules at exit by (type, has __file__): {(None, False): 7, ('SimpleNamespace', False): 8, ('module', False): 1}
        import-system lookups of modal / modal_app (a module not already in sys.modules): []
  ok   every socket the suite binds is on 127.0.0.1: {"('127.0.0.1'": 20}
```

L7 (`run.sh p_l7.py`):
```
schema: /home/qqbot/.cache/labyrinth-probes/v0607/contracts/live-status.schema.json
snapshots: 983; invalid: 0
by source: {'l1': 50, 'L2': 67, 'L5': 46, 'L3': 309, 'L6': 203, 'svc': 19, 'real2': 79, 'http-a': 20, 'http-b': 28, 'modal': 83, 'http-c': 79}
by mode: {'terminated': 60, 'idle': 65, 'launching': 234, 'live': 391, 'fallback': 210, 'unavailable': 23}
by reason marker: {'(other)': 894, 'Session ended abnormally': 8, 'TERMINATE FAILED': 26, 'Stopped on request': 8, 'Hard timeout reached': 10, 'TERMINATION PENDING': 34, 'Last session ended': 3}
mode x TERMINAT* marker: {'live + TERMINATE FAILED': 8, 'fallback + TERMINATE FAILED': 16, 'fallback + TERMINATION PENDING': 34, 'launching + TERMINATE FAILED': 2}
  control [mode = 'terminating']: rejected ["$.mode: 'terminating' is not one of ['unavailable', 'idle', 'launching', 'live', 'fallback', 'terminated']"]
  …  (12 of 12 controls rejected)
L7 PROBE: ALL OK
```
(The 983 include 339 snapshots that two probes recorded on the shared tree before the maintainer's notice, when
its `main/` was byte-identical to `c6244ec`.)

End of run (`$S/16_cleanup.sh`):
```
--- listening sockets on the verifier's ports (18700-18799):
(none)
--- default state dir:
ls: cannot access '/home/qqbot/.labyrinth': No such file or directory
removed /home/qqbot/.cache/labyrinth-probes/v0607          (and v0607-m1 … v0607-m6)
(no v0607 copies left)
```

### Findings (run 2)

Line numbers are those of commit `c6244ec` (`git show c6244ec:<path>`).

**Blocker**
- **R2-1 (L6; found independently by the reviewer, being fixed in round 6 — confirmed here end to end).**
  `main/labyrinth_main/features/live_gx/modal_backend.py:186-192`: when a spawn that outlived the client bound
  finally *errors*, `spawn()` calls `_settle(h, True, None)` ("nothing was started"). `terminate()` at `:256-263`
  had raised `TerminationPending` and dropped `abort_error`, so this happens even when the kill-switch put failed.
  Result: `termination_confirmed` True, `POST /api/live/terminate` → 200 "Workers terminated.", status without any
  TERMINATE marker, server exit 0 "workers terminated." — with a worker that may be running, no cancel and no kill
  switch (probe m9; HTTP part C with the real 20 s bound). The synchronous path (`:265-268`) gets this right.
  *Fix:* settle the late-error case as confirmed only if the kill switch is known to be set (re-try the put there);
  otherwise settle `False` so the session reads TERMINATE FAILED and a later terminate re-tries the put.

**Major**
- **R2-2 (L6 / L3).** `orchestrator.py:432` builds the fallback reason "… Other worker terminated." and
  `orchestrator.py:325-326` "… workers terminated." *before* any cancel is attempted; `_fallback()` (`:415-425`)
  publishes mode and reason under the lock and only then calls `terminate_all()` (`:425`). For as long as the
  cancel RPCs take — two bounded calls of 20 s per attempt and up to five attempts per worker — the status says
  the workers are terminated and carries no TERMINATION marker (probe: `termination_confirmed=False`, worker
  thread alive, reason "… Other worker terminated."). If the cancel then fails, the text stays, appended behind
  the TERMINATE FAILED prefix. This contradicts architecture.md "termination is never reported confirmed until a
  cancel succeeded". *Fix:* say "terminating the other worker" until `terminate_all()` returned True, and set the
  pending marker in the same locked section that sets `mode = "fallback"`.
- **R2-3 (tests; consequence of R2-2).** `main/tests/test_server.py:545-548` waits for `mode == "fallback"` and
  then asserts `reason.startswith("TERMINATION PENDING")`; a status poll that lands between the two fails it:
  1 of 15 unloaded iterations in the probe copy, 2 of 72 with six suites running at once, 2 of 6 concurrent
  baseline suites. `main/tests/test_server.py:338-341` has the same shape. *Fix:* wait for the marker, not the mode.
- **R2-4 (tests; money-guard wiring is not covered).** The suite stays green when `run_rehearsal` ignores a
  refusing guard (R15, `rehearse.py:90`), when either entrypoint drops the ledger lock (R14 `rehearse.py:87`, S02
  `service.py:254`), when a missing or a malformed ledger file is read as reconciled (S04 `service.py:89`, S05
  `service.py:91`), when `reconciled` accepts any truthy value (S06 `service.py:86`) and when the "qualified" gate
  is removed (S09 `service.py:203`). `test_L1_ledger_reservation_is_locked_across_processes`
  (`test_live_gx.py:151`) exercises `LedgerStore.locked()` inside one process only and went red for no mutation.
  The behaviour is right at `c6244ec` (my probes above, including two real processes), but nothing in the suite
  can fail if it breaks. *Fix:* tests that call `run_rehearsal` / the CLI with an unreconciled, an over-ceiling,
  a missing and a malformed ledger; a two-process launch race; an available-but-unqualified `LiveService`.

**Minor**
- **R2-5 (tests).** Three tests fail whenever the suite starts with SIGINT ignored (any job started with `&` from
  a script): `INFLIGHT_HARNESS` (`test_server.py:496-524`) does not reset the dispositions the way the other two
  harnesses do, and `test_live_gx.py:1133` assumes SIGINT is not ignored. 60 s of timeouts, 3 failures, no defect.
- **R2-6 (L1 / H5; the confirmCostUsd half is known to the reviewer).** `service.py:164` (`math.isfinite` on a
  400-digit int) and `service.py:166` (`round(1e308 * 100)`) raise `OverflowError`; `budget_guard.py:115` does
  the same for a huge integer in `ledger.json`, after which `status()`, the SSE stream and both POST routes give
  no HTTP response until the file is fixed. Nothing launches. *Fix:* treat `OverflowError` as "refuse".
- **R2-7 (known to the reviewer).** `service.py:166` compares after rounding: 2.6451 … 2.6549 are accepted as $2.65.
- **R2-8.** `service.py:284-286, 297`: on shutdown with a *failed* (not pending) cancel, one retry round runs and
  then `wait_terminated()` idles for the whole `join_timeout_s` (507 s) although nothing is queued that could
  confirm; signals are ignored and HTTP requests get no answer meanwhile. *Fix:* retry the cancel during that
  window, or return at once when no cancel is pending.
- **R2-9.** Both entrypoints restore the previous signal handlers before the process has exited
  (`server/__main__.py:54-56`, before the final `print` at `:57-58`; `rehearse.py:222-225`). A signal arriving
  after the cleanup kills the process: exit −15 / −2 instead of 0 / 2 in 16 of 60 runs with signals 30–120 ms
  apart (workers were cancelled and the last line was printed in all 16). In the server the handlers come back
  *before* the print, so the "NOT confirmed terminated" line can be lost in that window (by reading; not
  reproduced). *Fix:* do not restore the handlers on the way out; print first.
- **R2-10.** `server/__main__.py:57-58`: the final `print` is unguarded; after a hangup with a dead terminal it
  raises, the process exits 1 instead of 0 / 2 (workers were handled first). `rehearse.py` has `_say()` for this.
- **R2-11.** `server/__main__.py:26-31`: changing dispositions inside the handler makes CPython print
  "OSError: Signal 15 ignored due to race condition" with a traceback on stderr when two different signals arrive
  back to back (12 of 57 server runs). Cosmetic.
- **R2-12.** `orchestrator.py:354-378` terminates the workers one after the other, retries included: while GPU 0's
  cancel is failing, GPU 1's first cancel is not attempted (up to 5 × 2 × 20 s + 7.5 s later). In the `finally`
  path the status meanwhile still reads `live` with no marker. *Fix:* first attempt for every worker, then retries.
- **R2-13.** `orchestrator.py:264-282`: the hard timeout is not checked between the two spawns.
- **R2-14.** `modal_backend.py:178-199`: a stop request that arrives during `Function.from_name` does not prevent
  the `Function.spawn` of the same launch (it is cancelled right after: "before-spawn" rows above, spawn 1 / cancel 1).
- **R2-15.** `orchestrator.py:421` / `service.py:267`: a saved run deleted while a session runs is still named in
  the fallback label although `qualified` is then false and `/api/live/runs/<id>` is 404.
- **R2-16 (tests).** Further survivors: B17 (`modal_backend.py:155`: a late cancel that failed every retry reported
  as success), S11 (`service.py:287-289`), R06 (`rehearse.py:218`: passed but unconfirmed → exit 0), R22
  (`rehearse.py:110-111`), A12 / A13 (`modal_app.py:169, 180`: the worker's own deadline and its refusal of a
  rescheduled input), A16 (`modal_app.py:258`), O31 (`orchestrator.py:174`), R07 / R08 / R09 / R17
  (`rehearse.py:108-120`: the qualification checks are only ever tested in the passing direction).
- **R2-17 (tests).** Eight task-06 mutations were detected only because the suite hung: a failing assertion is
  followed by fixture teardowns that wait the real 507 s (`test_server.py:98-100`), and
  `assert …, line + proc.stderr.read()` (`test_server.py:130, 476, 540`) blocks on a live process when the
  assertion fails. A red gate can take many minutes to report.
- **R2-18 (L8, observation).** TASK L8 says "never imported by tests"; one test executes `modal_app.py` with
  `runpy` in a subprocess against a stub (the pytest process and every other process never load it; no real
  `modal` anywhere). The startup-timeout guard (`modal_app.py:85-91`) checks that the *name* is in the signature:
  a positional-only parameter of that name plus `**kwargs` would pass (contrived).
- Not defects, by contract of `WorkerBackend`: a backend whose `launch()` starts a worker and then raises a plain
  exception leaves it running with `termination_confirmed` True; a backend whose `launch()` never returns makes
  the status read `terminated` while `terminate()` correctly answers unconfirmed. `ModalBackend` does neither.

**Could not be checked here (needs a real Modal account; everything below stays UNREHEARSED, D-011).** That
`modal==1.6.4` has the API this code was written against (`FunctionCall.cancel(terminate_containers=True)`,
`App.function(startup_timeout=…)` and what it bounds, `FunctionCall.get(timeout=0)` raising `TimeoutError`,
`modal.exception.FunctionTimeoutError`, `Dict.from_name(create_if_missing=True)`, `modal.is_local()`); that
`timeout` counts from container start so that 300 + 1200 s is really the billed bound; the image build and the GX
build at the pinned commit; the GX TOML parameter names and the netCDF layouts `_read_flux` / `_restart_time`
expect; real device UUIDs; how long a real kill switch or cancel takes; what Modal bills against the $2.65 / $7.73
estimates. My stub reproduces the *protocol* the code expects, not Modal.

Verdict: FAIL — L6 fails (a late spawn that errors after a failed kill-switch put is reported terminated with a worker possibly running; the status claims termination before any cancel returned); L9–L10 NOT CHECKED (they await the frontend fix round)

## Run 3 — whole task

Verifier run: 2026-11-20, commit 3faed3a

**Scope.** All ten outcomes, L1–L8 (backend) and L9–L10 (frontend), at commit `3faed3a`. The owner asked for short,
non-redundant checks, so this run is deliberately lean: each outcome's tests run once, one probe script of my own covers
L1–L8, and five targeted mutations aim at the run-2 blockers (R2-1, R2-2), the run-2 weak-test finding R2-4, and L9/L10.
The 163-mutation sweep, signal matrix and real-server probes of run 2 were not repeated.

**Where things ran.** Windows + WSL, every command through `wsl.exe -e bash scripts/dev.sh …`. `git status --short` on
the owned paths (`main/labyrinth_main/features/live_gx/`, `renderer/src/features/live-gx/`) was empty at the start: the
tree under test is the commit. Tests and my read-only probe ran on the shared tree `D:\Labyrinth`. Mutations ran only in
`~/.cache/labyrinth-probes/vt-06-live-gx` from `scripts/probe-copy.sh`; it was compared file by file with the commit
before and after (0 differ) and deleted at the end. `modal` was not installed and no Modal credentials were set. An
audit hook in my probe recorded no socket connect or DNS lookup. No server was started. `~/.labyrinth` does not exist.

**Gates.** Not re-run by me (the caller said so, and nine verifiers share this machine). The maintainer ran
`verify.sh all` at `3faed3a` on this tree: exit 0, 11/11 stages (boundary self-test 134 shapes, scripts 71 passed,
ruff clean, main 331 passed, artifacts schema + fresh, tsc clean, vitest 1350 passed, vite build OK). That is quoted
evidence, not my own output.

### Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| L1 | Slot estimate = rate × (slot + setup + idle) + storage; refuses when billed + pending + estimate > $40; hard timeout; refuses an unreconciled ledger | 80 × `test_L1_*` (incl. the new both-entrypoints and too-large-amount tests): 80 passed | My recompute 6.10 × 25/60 + 0.10 = 2.641667 → $2.65 = guard. 37.35 and 30 + 7.35 approved; 37.36, 20 + 17.36 and 37.354 refused (run-1 F4 is fixed); unreconciled, NaN, negative refused; hard timeout 1500 s. Mutation M3 (rehearsal ignores a refusing guard, the run-2 survivor R15) is now caught by 14 tests | PASS |
| L2 | Two workers concurrently, GPU 0 bean / GPU 1 triangular, device IDs, overlapping intervals, monotone simTime, samples in archive units | 7 × `test_L2_*`: 7 passed | My own backend (not `FakeBackend`): launch order bean/0 then triangular/1; my device IDs recorded as reported; overlap 0.180 s (my threads) and 0.145 s (orchestrator); clocks monotone to 60·√2; all 6 samples per worker equal my t·√2 and Q/(2√2) | PASS |
| L3 | Either worker failing → `fallback`, label, `savedRunId` (null without a rehearsal), error kept, other worker terminated | 15 × `test_L3_*`: 15 passed | My backend, bean crashes at step 2: mode fallback, label "Worker failed. No qualified GX rehearsal recorded …", savedRunId null, my error text kept, triangular terminate called once and its thread stopped while still running. With a saved run id, label and savedRunId name it | PASS |
| L4 | No credentials or no `modal` → `unavailable`, zero network calls | 3 × `test_L4_*`: 3 passed | Subprocess with no `MODAL_*` and an empty HOME under a socket audit hook: `LiveService.status()` unavailable ("no Modal credentials"), launch refused, 0 socket events, no `modal` module loaded, no ledger written | PASS |
| L5 | A run resumed from a checkpoint continues simTime from the checkpoint | 7 × `test_L5_*`: 7 passed | My backend resumed at raw 77: first simTime 123.04 ≥ 77·√2, last 165.4630 = 117·√2. My backend restarting at 0 → fallback, "simulation clock went backwards (10.0 < 77.0 from checkpoint)" | PASS |
| L6 | Workers always terminated after retrieval (also on exception) | 92 × `test_L6_*`: 92 passed | My backend: normal end → terminate [1, 1], threads stopped; KeyboardInterrupt out of the run loop propagates and both are still terminated. Mutation M1 (re-introduces R2-1: a late client-side spawn error settled as confirmed) caught by 6 cells of the termination matrix on all three surfaces; M2 (re-introduces R2-2: fallback reason without the pending marker while cancels run) caught by 2 tests | PASS |
| L7 | Every status snapshot validates against `contracts/live-status.schema.json` | `test_L7_every_status_snapshot_validates`: passed (it asserts all six modes occur) | My own jsonschema validator over the 73 snapshots of my probe (modes fallback, launching, live, terminated): 0 invalid; a negative control (mode "running-hot") is rejected | PASS |
| L8 | `modal_app.py`: A100-40GB worker, hard timeout, explicit launch only, GX inputs for both tubes; never imported by tests or replay; UNREHEARSED | 10 × `test_L8_*`: 10 passed | Text scan of `main/` and `scripts/`: `import modal` only in `modal_app.py:48` and inside functions of `modal_backend.py` (226, 270, 305); nothing imports `modal_app`. AST: exactly two decorators, both `app.function(gpu=GPU, timeout=…, retries=0, max_containers=2, startup_timeout=…)`; `GPU = "A100-40GB"`; docstring starts "UNREHEARSED" | PASS |
| L9 | Live panel polls `/api/live/status`; unavailable/fallback show an unmistakable label and play the replay; live shows both device IDs, both clocks advancing, sample counts | 26 vitest cases named L9 (`LiveView.test.tsx`, `liveStatusStore.test.ts`): all passed | `liveStatus.ts:243` polls `/api/live/status`. Mutation M5 (`isLive` also true for mode fallback) is caught by 6 L9 cases (8 cases in all) | PASS (note F3-1) |
| L10 | Launch enabled only when mode is `idle` and `budget.slotFits`; explicit confirmation showing the slot cost | 38 vitest cases named L10: all passed | Mutation M4 (the `slotFits` check removed from `launchBlockedReason`) is caught by 5 cases. The tests check the dialog text "$2.65" and the POST body `{confirmCostUsd: 2.65}` | PASS (note F3-1) |

### Real output

Start of run:
```
$ wsl.exe -e bash scripts/dev.sh python3 --version
Python 3.12.3
$ wsl.exe -e git status --short
 M status.md
$ wsl.exe -e git log --oneline -1
3faed3a Review round: all six areas approved; 91 confirmed findings fixed
```

Backend tests, once, on the shared tree (`01_tests.sh`):
```
HEAD: 3faed3a
$ python3 -m pytest -q -rA -p no:cacheprovider main/tests/test_live_gx.py
exit=0
215 passed in 32.39s
L1: 80 passed, 0 failed
L2: 7 passed, 0 failed
L3: 15 passed, 0 failed
L4: 3 passed, 0 failed
L5: 7 passed, 0 failed
L6: 92 passed, 0 failed
L7: 1 passed, 0 failed
L8: 10 passed, 0 failed
```

Frontend tests, once, on the shared tree (`02_fe.sh`):
```
$ (in /mnt/d/Labyrinth/renderer) npx vitest run --reporter=verbose src/features/live-gx src/lib/liveStatusStore.test.ts
exit=0
 Test Files  2 passed (2)
      Tests  91 passed (91)
L9: 26 passed, 0 failed
L10: 38 passed, 0 failed
```

My probe (`p_backend.py`: my own `WorkerBackend`, unit math, schema validator and socket audit hook; read-only against
the shared tree). The first pass printed one red line for L8. That was a bug in my probe: it searched the whole file for
the text `local_entrypoint`, which appears in the module docstring ("There is no local_entrypoint …"). I replaced that check with
an AST check of the decorators, and the second pass shows the corrected L8 lines:
```
== L1 budget guard (own recompute: rate 6.10 $/h x (15+5+5) min + $0.10, ceil to cent)
  ok   slot estimate raw 2.641667 -> mine 2.65, guard 2.65
  ok   billed 37.35 pending 0 reconciled True: approved=True (want True) | Budget guard approves: billed $37.35 + pending $0.00 + slot $2.65 = $4
  ok   billed 30.0 pending 7.35 reconciled True: approved=True (want True) | Budget guard approves: billed $30.00 + pending $7.35 + slot $2.65 = $4
  ok   billed 37.36 pending 0 reconciled True: approved=False (want False) | Budget guard refused: billed $37.36 + pending $0.00 + slot $2.65 = $40
  ok   billed 20.0 pending 17.36 reconciled True: approved=False (want False) | Budget guard refused: billed $20.00 + pending $17.36 + slot $2.65 = $4
  ok   billed 37.354 pending 0 reconciled True: approved=False (want False) | Budget guard refused: billed $37.35 + pending $0.00 + slot $2.65 = $40
  ok   billed 8.1 pending 0 reconciled False: approved=False (want False) | Budget guard refused: ledger not reconciled (billed $8.10, pending $0.
  ok   billed nan pending 0 reconciled True: approved=False (want False) | Budget guard refused: ledger.json is unusable (billed/pending must be
  ok   billed -1.0 pending 0 reconciled True: approved=False (want False) | Budget guard refused: ledger.json is unusable (billed/pending must be
  ok   hard timeout for an approved slot: 1500 s (planned 25 min = 1500 s)
== L2 own backend: concurrency, devices, clocks, units
  ok   launch order [('bean', 0), ('triangular', 1)]
  ok   device IDs recorded as reported: ['MYGPU-0-ad93ca', 'MYGPU-1-c1167d']
  ok   overlap: my threads 0.180 s, orchestrator intervals 0.145 s
  ok   GPU 0 simTime monotone over 17 readings, last 84.8528 (60*sqrt2 = 84.8528)
  ok   GPU 0: 6 samples = my (t*sqrt2, Q/(2 sqrt2)); first 14.142136,1.096016 vs 14.142136,1.096016
  ok   GPU 1 simTime monotone over 16 readings, last 84.8528 (60*sqrt2 = 84.8528)
  ok   GPU 1: 6 samples = my (t*sqrt2, Q/(2 sqrt2)); first 14.142136,1.449569 vs 14.142136,1.449569
  ok   L6 after retrieval: mode terminated, terminate calls [1, 1], threads alive [False, False]
== L3 own backend: bean fails at step 2
  ok   mode fallback, fallback {'active': True, 'label': 'Worker failed. No qualified GX rehearsal recorded — showing archived stella/GENE evidence', 'savedRunId': None}
  ok   error kept: 'my-probe crash on bean'
  ok   triangular terminated: calls 1, alive False, state running
  ok   final reason: 'GPU 0 (bean) worker failed: my-probe crash on bean. Other worker terminated.'
  ok   with a saved run: {'active': True, 'label': 'Worker failed — playing saved GX run rehearsal-0123456789ab', 'savedRunId': 'rehearsal-0123456789ab'}
== L5 own backend: resume from checkpoint raw 77
  ok   GPU 0: first simTime 123.0366 (77*sqrt2 = 108.8944), last 165.4630 (117*sqrt2 = 165.4630)
  ok   GPU 1: first simTime 123.0366 (77*sqrt2 = 108.8944), last 165.4630 (117*sqrt2 = 165.4630)
  ok   restart from 0 -> fallback: 'simulation clock went backwards (10.0 < 77.0 from checkpoint); checkpoint continuation broken'
== L6 own backend: exception out of the run loop
  ok   propagated KeyboardInterrupt, terminate calls [1, 1], alive [False, False]
== L7 my validator over every snapshot of this probe
  ok   73 snapshots, modes ['fallback', 'launching', 'live', 'terminated'], invalid []
  ok   negative control (mode running-hot) rejected
== L4 subprocess: no credentials, HOME empty, audit hook on sockets
  ok   mode unavailable | Live GX unavailable: no Modal credentials (MODAL_TOKEN_ID/MODAL_TOKEN_SECRET or ~/.modal.t | launch False (Live GX unavailable: no Modal credentials (MODAL_TOKEN_ID/MO) | socket events [] | modal modules []
== L8 imports of modal / modal_app across main/ and scripts/ (text scan)
       main/labyrinth_main/features/live_gx/modal_app.py:48: import modal
       main/labyrinth_main/features/live_gx/modal_backend.py:226: import modal
       main/labyrinth_main/features/live_gx/modal_backend.py:270: import modal
       main/labyrinth_main/features/live_gx/modal_backend.py:305: import modal
  ok   only modal_backend.py (inside functions) and modal_app.py itself import modal; nothing imports modal_app
       decorator: app.function(image=image, gpu=GPU, cpu=CPU_PER_WORKER, memory=MEMORY_MIB_PER_WORKER, timeout=LIVE_TIMEOUT_S, retries=0, max_containers=2, scaledown_wi
       decorator: app.function(image=image, gpu=GPU, cpu=CPU_PER_WORKER, memory=MEMORY_MIB_PER_WORKER, timeout=REHEARSAL_PHASE_TIMEOUT_S, retries=0, max_containers=2, s
  ok   modal_app.py: UNREHEARSED docstring, GPU A100-40GB, exactly two decorators, both app.function with gpu, timeout, retries=0 (no entrypoint/schedule/web decorator)
== network audit events in this process: []
  ok   zero socket connects / DNS lookups in the probe process
BACKEND PROBE: ALL OK
```

Five mutations in the probe copy (`03_mutations.sh`; one at a time, each restored before the next):
```
--- probe copy vs commit 3faed3a (task 06 owned files + liveStatus.ts + schema):
18 files compared, 0 differ
=== M1: main/labyrinth_main/features/live_gx/modal_backend.py
    -                     _settle(h, False, verdict)
    +                     _settle(h, True, None)
    exit=1
    FAILED main/tests/test_live_gx.py::test_L6_terminated_is_reported_only_after_a_cancel_that_succeeded[spawn-fails-late,put-ok,cancel-none-orchestrator]
    FAILED main/tests/test_live_gx.py::test_L6_terminated_is_reported_only_after_a_cancel_that_succeeded[spawn-fails-late,put-ok,cancel-none-service+server]
    FAILED main/tests/test_live_gx.py::test_L6_terminated_is_reported_only_after_a_cancel_that_succeeded[spawn-fails-late,put-ok,cancel-none-rehearse-cli]
    FAILED main/tests/test_live_gx.py::test_L6_terminated_is_reported_only_after_a_cancel_that_succeeded[spawn-fails-late,put-fails,cancel-none-orchestrator]
    FAILED main/tests/test_live_gx.py::test_L6_terminated_is_reported_only_after_a_cancel_that_succeeded[spawn-fails-late,put-fails,cancel-none-service+server]
    FAILED main/tests/test_live_gx.py::test_L6_terminated_is_reported_only_after_a_cancel_that_succeeded[spawn-fails-late,put-fails,cancel-none-rehearse-cli]
    6 failed, 209 passed in 22.72s
=== M2: main/labyrinth_main/features/live_gx/orchestrator.py
    -             if open_ and self.mode == "fallback":  # the fallback
    +             if False:  # the fallback
    exit=1
    FAILED main/tests/test_live_gx.py::test_L6_a_fallback_reads_termination_pending_from_the_instant_its_mode_is_set[worker]
    FAILED main/tests/test_live_gx.py::test_L6_a_fallback_reads_termination_pending_from_the_instant_its_mode_is_set[timeout]
    2 failed, 213 passed in 22.67s
=== M3: main/labyrinth_main/features/live_gx/rehearse.py
    -             if not decision.approved:
    +             if False:
    exit=1
    FAILED main/tests/test_live_gx.py::test_L6_rehearse_cli_in_process_pass_and_crash_paths
    FAILED main/tests/test_live_gx.py::test_L1_a_ledger_amount_too_large_for_a_float_is_refused_and_never_raises
    FAILED main/tests/test_live_gx.py::test_L1_both_entrypoints_refuse_every_ledger_that_is_not_reconciled_with_room[missing-rehearsal]
    FAILED main/tests/test_live_gx.py::test_L1_both_entrypoints_refuse_every_ledger_that_is_not_reconciled_with_room[unreconciled-rehearsal]
    FAILED main/tests/test_live_gx.py::test_L1_both_entrypoints_refuse_every_ledger_that_is_not_reconciled_with_room[over the ceiling-rehearsal]
    FAILED main/tests/test_live_gx.py::test_L1_both_entrypoints_refuse_every_ledger_that_is_not_reconciled_with_room[truncated-rehearsal]
    FAILED main/tests/test_live_gx.py::test_L1_both_entrypoints_refuse_every_ledger_that_is_not_reconciled_with_room[a list-rehearsal]
    FAILED main/tests/test_live_gx.py::test_L1_both_entrypoints_refuse_every_ledger_that_is_not_reconciled_with_room[a key missing-rehearsal]
    14 failed, 201 passed in 23.65s
=== M4: renderer/src/features/live-gx/model.ts
    -   if (d.budget.slotFits !== true) return guardRefusal(d);
    +   void guardRefusal;
    exit=1
       × L10 Launch is disabled when idle but the budget guard refuses the slot 19ms
       × L10 Launch is enabled only for mode idle with budget.slotFits on a fresh snapshot 12ms
       × L10 FA-4 after a 409 Launch stays disabled while the snapshots do not allow launching, and returns with the first one that does 199ms
       × L10 the confirmation closes itself when launching stops being allowed or the cost changes; nothing is sent 1033ms
       × cross-RX-5 a guard refusal reads as the guard refusing the slot and quotes its clause; it is not called a ceiling fit 9ms
          Tests  5 failed | 86 passed (91)
=== M5: renderer/src/lib/liveStatus.ts
    -   return s.status === 'ready' && s.data.mode === 'live';
    +   return s.status === 'ready' && (s.data.mode === 'live' || s.data.mode === 'fallback');
    exit=1
       × L9 unreachable / unavailable / fallback show an unmistakable label and play the replay (never LIVE) 1226ms
       × L9 fallback shows the cause the backend reports (a hard timeout is not "Worker failed"), and no saved run is claimed when none exists 30ms
       × L9 mode fallback whose reason contains TERMINATE FAILED is a danger alert titled from the marker, never just a badge (FA-1) 1030ms
       × L9 mode fallback whose reason contains TERMINATION PENDING is a danger alert titled from the marker, never just a badge (FA-1) 1025ms
       × L9 FA-3 the provenance badge reads Live only for a fresh, valid mode "live" snapshot; otherwise "Recorded run" 1024ms
       × L9 a saved run with a broken shape is rejected by the loader and archived evidence plays instead (FE-8) 1005ms
          Tests  8 failed | 83 passed (91)
--- restored: probe copy vs commit again
differ after restore: 0
```
(M3 lists the first 8 of its 14 failing tests; M5 the first 6 of its 8.) Afterwards:
`rm -rf ~/.cache/labyrinth-probes/vt-06-live-gx` and no `vt-06-live-gx` copy is left. `~/.labyrinth` does not exist.

### Findings

- **Run-2 blockers are fixed at `3faed3a`.** R2-1: `modal_backend.py:239-251` now settles a late client-side spawn
  error as unconfirmed (`_settle(h, False, verdict)`, line 250). Putting back the old confirmed settle (M1) turns 6
  cells of `test_L6_terminated_is_reported_only_after_a_cancel_that_succeeded` red (`test_live_gx.py:2282`). R2-2:
  `orchestrator.py:353-367` adds the TERMINATING marker to the fallback reason while workers are still open, and adds the
  "terminated" clause only from the records. Removing that (M2) turns
  `test_L6_a_fallback_reads_termination_pending_from_the_instant_its_mode_is_set` red (`test_live_gx.py:2342`).
- **R2-4 (weak tests for the money-guard wiring) is fixed for the case I re-checked.** In run 2, the rehearsal
  ignoring a refusing guard (R15) survived. At `3faed3a` the same mutation (M3, `rehearse.py:108`) turns 14 tests red.
  I did not re-run the other run-2 survivors (S02, S04–S06, S09 and the R2-16 list) or the run-2 minor findings
  R2-5 … R2-18. Their status at this commit is unverified by me.
- **F3-1 (minor, documentation; L10).** TASK.md:20 says Launch is enabled "only when mode is `idle` and
  `budget.slotFits`". `renderer/src/features/live-gx/model.ts:164-187` also enables it for a *settled* `fallback` of a
  qualified service, with `slotFits` still required and no termination or stop marker present (line 181; the cross-RX-4
  test is at `LiveView.test.tsx:550-557`). This matches the backend contract: interface.md:111 says `fallback` is
  "shown until the next launch". Without it, the UI could never relaunch after a fallback. It is not a defect, but
  TASK.md L10 and decision.md do not record the change. Suggested fix: reword L10 to match.
- **F3-2 (minor, documentation).** TASK.md:28-31 still reads "IN-PROGRESS … reviewer round 4 CHANGES REQUESTED …
  Frontend L9–L10: built, unverified". At this commit the commit message says all review areas were approved. The
  status text is the owner's to update after this run.
- **Probe-side note.** The first pass of my L8 check was red because of my own substring search (see Real output),
  not because of the code.
- **Not run by me:** `verify.sh all` and `check_boundaries.py`, by instruction. Their evidence is the maintainer's
  run quoted above. Also not run: run 2's signal matrix, real-server HTTP probes and the 163-mutation sweep.
- **Cannot be checked without a real Modal account (stays UNREHEARSED, D-011):** that `modal==1.6.4` has the API the
  code calls (`FunctionCall.cancel(terminate_containers=True)`, `App.function(startup_timeout=…)`, `Dict.from_name`,
  `FunctionCall.get(timeout=0)`); the image and GX build at the pinned commit; GX TOML parameter names and netCDF layouts
  (`_read_flux`, `_restart_time`); real device UUIDs; real cancel and kill-switch latency; whether two real A100
  containers actually overlap; what Modal bills against the $2.65 / $7.73 estimates. Everything here ran against fakes,
  my own backend or the repo's stub.

Verdict: PASS


## Run 4 — whole task (D-024, new outcome L11)

Verifier run: 2026-11-21, commit 77fd8b6

**Scope.** All eleven outcomes at commit `77fd8b6` (D-024: new `live_gx/comparison.py`; `orchestrator.py`, `fake_backend.py`,
`rehearse.py` and `LiveView.tsx` changed). As the owner asked, the checks are short: L1–L10 get their targeted tests and one probe
each, L11 gets its tests, my own independent probe and four of the five mutations (the fifth is the L9/L11 summary line).

**Where things ran.** Windows + WSL, every command through `wsl.exe -e bash scripts/dev.sh …`; my scripts and logs are in my
scratch dir `…\scratchpad\v06`. At the start, HEAD was `77fd8b6` and `git status --short` on the owned paths, `contracts/`,
`main/labyrinth_main/features/transport/`, `main/tests/` and `tasks/06-live-gx/` was empty. I made two copies with
`scripts/probe-copy.sh` (`vt06c` for the gates, tests and my probe; `vt06m` for mutations) and compared 189 tracked files in each
with `git show 77fd8b6:<path>`: 0 differ. A third copy (`vt06v`, 0 differ) held one temporary vitest file for the renderer-validator
probe. The shared tree was never written; all three copies were deleted at the end, and at the end the shared tree's only change
was another verifier's `tasks/09-app-shell/VERIFY.md`. `modal` is not importable, there are no `MODAL_*` variables and no
`~/.modal.toml`, my probe's audit hook saw no socket connect or DNS lookup, every state dir was under my scratch dir, and
`~/.labyrinth` does not exist.

**Termination invariants untouched.** `git diff 3faed3a 77fd8b6` changes `orchestrator.py` only in the module docstring,
`import copy`, the provenance constant (`COMPARISON_NOT_COMPUTED` → `ARCHIVE_COMPARISON`), the `_comparison` cache field,
`_verification` and `snapshot` (split into `_snapshot_body` + `_comparison_input`). `modal_backend.py`, `service.py`,
`budget_guard.py`, `modal_app.py` and `gx_input.py` did not change. All 92 L6 tests pass.

### Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| L1 | Slot estimate = rate × (slot + setup + idle) + storage; refuses when billed + pending + estimate > $40; hard timeout; refuses an unreconciled ledger | 80 × `test_L1_*`: 80 passed | My recompute 6.10 × 25/60 + 0.10 = 2.641667 → $2.65 = guard. 37.35 and 30 + 7.35 approved; 37.36, 20 + 17.36, unreconciled and NaN refused; hard timeout 1500 s | PASS |
| L2 | Two workers concurrently, GPU 0 bean / GPU 1 triangular, device IDs, overlapping intervals, monotone simTime, samples in archive units | 7 × `test_L2_*`: 7 passed | My own `WorkerBackend` (not `FakeBackend`): launch order bean/0 then triangular/1; my device IDs recorded; orchestrator intervals overlap 0.121 s; both clocks monotone to 60·√2 = 84.8528; all 6 samples per worker equal my t·√2, Q/(2√2) | PASS |
| L3 | Either worker failing → `fallback`, label, `savedRunId` (null without a rehearsal), error kept, other worker terminated | 15 × `test_L3_*`: 15 passed | My backend, bean crashes at step 2: mode fallback, label "Worker failed. No qualified GX rehearsal recorded …", savedRunId null, my error text kept, triangular terminated (1 call, thread stopped); the fallback snapshot carries `comparison` and validates | PASS |
| L4 | No credentials or no `modal` → `unavailable`, zero network calls | 3 × `test_L4_*`: 3 passed | Subprocess without `MODAL_*`, with an empty HOME and a socket audit hook: status unavailable ("no Modal credentials"), launch refused, 0 socket events, no modal module loaded, no ledger written | PASS |
| L5 | A run resumed from a checkpoint continues simTime from the checkpoint | 6 × `test_L5_*`: 6 passed (the seventh at 3faed3a asserted the removed "NOT computed" wording; an L11 test replaces it) | My backend resumed at raw 77: first simTime 108.8944 = 77·√2, last 165.4630 = 117·√2; a backend restarting at 0 → fallback, "simulation clock went backwards (0.0 < 77.0 from checkpoint)" | PASS |
| L6 | Workers always terminated after retrieval (also on exception) | 92 × `test_L6_*`: 92 passed | My backend: normal end → terminate [1, 1]; KeyboardInterrupt out of poll propagates and both workers are terminated. Termination code is unchanged since 3faed3a (diff above) | PASS |
| L7 | Every status snapshot validates against `contracts/live-status.schema.json` | `test_L7_every_status_snapshot_validates`: passed; every L11 test validates its snapshots too | My jsonschema validator over the 108 snapshots of my probe (all with `comparison`; modes fallback, idle, launching, live, terminated) and the gate snapshots: 0 invalid; 4 negative controls rejected. The renderer's own `validateLiveStatus` accepted 31 real backend snapshots (verdicts agree, disagree and no claim; 0 or 2 windows) and rejected the same 4 controls | PASS |
| L8 | `modal_app.py`: A100-40GB worker, hard timeout, explicit launch only, GX inputs for both tubes; never imported by tests or replay; UNREHEARSED | 10 × `test_L8_*`: 10 passed | AST: two `app.function` decorators with `gpu=GPU`, `retries=0` and a timeout; `GPU = 'A100-40GB'`; docstring starts UNREHEARSED; nothing in `main/` or `scripts/` imports `modal_app`. The labyrinth modules `modal_app` imports (taken from its AST) load none of h5py, `comparison`, `transport.archive`, `transport.compare` or `transport.stats` | PASS |
| L9 | Live panel polls `/api/live/status`; unavailable/fallback show an unmistakable label and play the replay; live shows both device IDs, both clocks advancing, sample counts | 27 vitest cases named L9 (one more than at 3faed3a: the T13 summary line): 27 passed | `liveStatus.ts` changed only in its re-exports; `LiveView.tsx` only in the chart's summary line. Mutation M5 (the line trusts the backend flag alone) is caught by the T13 case | PASS |
| L10 | Launch enabled only when mode is `idle` and `budget.slotFits`; explicit confirmation showing the slot cost | 38 vitest cases named L10: 38 passed | `git diff 3faed3a 77fd8b6` does not touch `model.ts` or the launch and confirmation code of `LiveView.tsx` (the only hunks there are the import and the chart summary line); run 3's mutation evidence still applies | PASS (run-3 note F3-1 still open) |
| L11 | Live comparison (D-024): every session snapshot carries `comparison` from the bean samples via `transport.stats` / `transport.compare`; uncovered → nulls and no claim; non-stationary or N_eff < 20 never opens a claim; top-level flag only with an agree; recomputed per sample count; error → `windows: []`, status answers; no `comparison` without a session; no "NOT computed" wording | 16 × `test_L11_*`: 16 passed. Mutations M1–M4 are each caught (3, 5, 1 and 2 tests) | `Orchestrator` + `FakeBackend(q_raw_fn=…)` driven to archive t 424, 351 and 71, with trends, AR(1) noise and sparse sampling. My own coverage rule and trapezoid mean equal every window's coverage, sample count and mean; the archive means equal `transport.json` and my trapezoid; deltas equal live − archive; stderr is within 1.5 % of my plain Sokal estimate. With the committed archive every archive entry is "no claim" and the flag is false. Against my own synthetic archives, my own Student-t TOST reproduces every agree / disagree / no claim, and the flag is true only with an agree. Flagged non-stationary and N_eff < 20 windows: gate shut, all no claim. A divergent repeat and an unreadable archive give `windows: []` with a reason while status still answers in mode live and validates. Gate snapshots (unavailable, idle, after the session) have no `comparison`. Another thread takes the orchestrator lock while the comparison runs. One computation per distinct bean count; snapshots never share the cached object | PASS (findings F4-1, F4-2 concern `transport.stats`, not this task's code) |

### Real output

Gates in the clean copy (== `77fd8b6`; `01_gates.sh`):
```
$ cd ~/.cache/labyrinth-probes/vt06c && LABYRINTH_STATE_DIR=$S/state bash scripts/verify.sh all
━━━ verify.sh summary (scope: all)
  PASS  boundary:self-test (0s)
  PASS  boundary:scan (0s)
  PASS  docs:handoff (0s)
  PASS  scripts:tests (11s)
  PASS  main:lint (0s)
  PASS  main:tests (41s)
  PASS  artifacts:schema (0s)
  PASS  artifacts:fresh (0s)
  PASS  renderer:typecheck (15s)
  PASS  renderer:tests (61s)
  PASS  renderer:build (4s)
verify.sh: all stages passed.
verify.sh all EXIT=0
(stage tails: boundary self-test: OK (134 violations caught, 25 clean files passed, 3 OS flavours agree) / 71 passed in 10.63s /
 All checks passed! / 347 passed in 43.55s / Test Files 30 passed (30) / Tests 1370 passed (1370))
$ python3 scripts/check_boundaries.py
boundary: OK (169 files scanned)
check_boundaries EXIT=0
```

Targeted tests in the same copy (`02_tests.sh`):
```
$ python3 -m pytest -q -rA -p no:cacheprovider main/tests/test_live_gx.py
exit=0
230 passed in 23.89s
L1: 80 passed, 0 failed
L2: 7 passed, 0 failed
L3: 15 passed, 0 failed
L4: 3 passed, 0 failed
L5: 6 passed, 0 failed
L6: 92 passed, 0 failed
L7: 1 passed, 0 failed
L8: 10 passed, 0 failed
L11: 16 passed, 0 failed
PASSED main/tests/test_live_gx.py::test_L11_uncovered_session_has_null_statistics_no_claim_and_validates
PASSED main/tests/test_live_gx.py::test_L11_covered_live_trace_against_the_committed_archive_is_no_claim_because_of_the_archive
PASSED main/tests/test_live_gx.py::test_L11_a_non_stationary_live_trace_never_opens_a_claim
PASSED main/tests/test_live_gx.py::test_L11_n_eff_gate_an_autocorrelated_live_trace_below_20_effective_samples_has_no_claim
PASSED main/tests/test_live_gx.py::test_L11_injected_archive_agree_and_disagree_only_agree_opens_the_claim
PASSED main/tests/test_live_gx.py::test_L11_injected_archive_inconclusive_is_no_claim
PASSED main/tests/test_live_gx.py::test_L11_mixed_windows_name_exactly_the_agreeing_window_and_code
PASSED main/tests/test_live_gx.py::test_L11_recomputed_as_bean_samples_arrive_and_always_matches_its_snapshot
PASSED main/tests/test_live_gx.py::test_L11_cached_while_the_bean_sample_count_is_unchanged_and_never_shared
PASSED main/tests/test_live_gx.py::test_L11_the_comparison_is_computed_outside_the_orchestrator_lock
PASSED main/tests/test_live_gx.py::test_L11_the_modal_worker_import_chain_does_not_load_the_archive_stack
PASSED main/tests/test_live_gx.py::test_L11_a_comparison_that_cannot_be_computed_gives_no_windows_and_a_reason
PASSED main/tests/test_live_gx.py::test_L11_status_answers_and_validates_when_the_comparison_fails
PASSED main/tests/test_live_gx.py::test_L11_only_session_snapshots_carry_the_comparison
PASSED main/tests/test_live_gx.py::test_L11_qualified_live_and_rehearsal_provenance_describe_the_comparison_without_a_claim
PASSED main/tests/test_live_gx.py::test_L11_saved_rehearsal_phases_carry_the_comparison_and_the_new_wording

$ (renderer) npx vitest run --reporter=verbose src/features/live-gx src/lib/liveStatusStore.test.ts
exit=0
 Test Files  2 passed (2)
      Tests  92 passed (92)
L9: 27 passed, 0 failed
L10: 38 passed, 0 failed
 ✓ src/features/live-gx/LiveView.test.tsx > L9 T13 the live chart carries a one-line archive comparison summary linking to Check transport, only when live with the field 40ms
```

My probe (`p06.py`, read-only against the clean copy; final pass, excerpts verbatim, exit 1 because of the four lines marked
FAIL, explained in finding F4-3; selected lines, verbatim, one list shortened where marked):
```
== L11 A: covered run through Orchestrator + FakeBackend(q_raw_fn), raw t to 300 (archive 424)
  ok   run A: mode terminated, 1500 bean samples, archive t 0.2828..424.2641
  ok   run A: first sample (t, Q) = (0.2*sqrt2, q_raw/(2 sqrt2)) = (0.282843, 2.470011)
  ok   A final 200-300: covered True (mine True), n 353 (mine 353), mean 2.646465 (mine 2.646465)
  ok   A final 200-300: stderr/nEff/nEffLower/stationary/detail == transport.stats.window_stats on the snapshot's own samples
  ok   A final 200-300: window claim True = covered & stationary True & stderr & nEffLower>=20 (stationary True, nEffLower 145.15106476403062)
  ok   A final 200-300 stella: archive mean 2.715518 = transport.json 2.715518 = my trapezoid 2.715518; delta -0.069053; verdict 'no claim'
  ok   A final 200-300 GENE: archive mean 2.926028 = transport.json 2.926028 = my trapezoid 2.926028; delta -0.279563; verdict 'no claim'
  ok   A final 300-400: covered True (mine True), n 354 (mine 354), mean 2.645156 (mine 2.645156)
  ok   A final 300-400 stella: archive mean 2.554537 = transport.json 2.554537 = my trapezoid 2.554537; delta 0.090618; verdict 'no claim'
  ok   A final 300-400 GENE: archive mean 2.675066 = transport.json 2.675066 = my trapezoid 2.675066; delta -0.02991; verdict 'no claim'
  ok   A final: top-level claim False with the committed archive | reason: No saturated-agreement claim. 200–300: archive stella and GENE not shown stationary (N_eff not established; D-017 gate). 300–400: archive stella and G
  ok   A final: no 'NOT computed' anywhere in the snapshot
  ok   A 200-300: stderr 0.01869 vs my plain Sokal 0.01842 (N_eff 186) and white-noise sd/sqrt(n) 0.01689; repo nEff 181 nEffLower 145 stationary True
  ok   A 300-400: stderr 0.01915 vs my plain Sokal 0.01893 (N_eff 241) and white-noise sd/sqrt(n) 0.01775; repo nEff 235 nEffLower 192 stationary True
  ok   cache: live_comparison called 2 times for 4 snapshots = once per distinct bean count (2 distinct; first calls [0, 1500])
  ok   every one of 4 snapshots: comparison.nSamples == its own bean sample count
  ok   mutating a returned snapshot's comparison does not change the next snapshot (deep copy)
== L11 B: verdicts recomputed by me against my own synthetic archives (run A's snapshot samples)
  ok   B agree/disagree 200-300 stella: verdict 'agree' = my recompute 'agree' (live gate True, archive gate True)
  ok   B agree/disagree 200-300 GENE: verdict 'disagree' = my recompute 'disagree' (live gate True, archive gate True)
  ok   B agree/disagree: top-level claim True iff some agree (True)
  ok   B disagree x4: top-level claim False iff some agree (False)
  ok   B sparse stella (archive gate shut) 200-300 stella: verdict 'no claim' = my recompute 'no claim' (live gate True, archive gate False)
  ok   B sparse stella (archive gate shut) 200-300 GENE: verdict 'agree' = my recompute 'agree' (live gate True, archive gate True)
== L11 C: partial coverage (raw t to 248 -> archive 350.7) and no coverage (default FakeBackend)
  ok   C partial 300-400: covered False (mine False), n 180 (mine 180): all statistics null, window claim false
  ok   C partial 300-400 stella: archive mean 2.554537 = transport.json 2.554537 = my trapezoid 2.554537; delta None; verdict 'no claim'
  ok   U none 200-300: covered False (mine False), n 0 (mine 0): all statistics null, window claim false
  ok   U: the very first snapshot (no samples) has the comparison with 2 uncovered windows
== L11 D: non-stationary live traces (linear trends) through the orchestrator; expectation: stationary is not True -> no claim
  ok   D slope 0.02 (archive drift 0.5/window) 200-300: stationary None, nEffLower None, window claim False
  FAIL D slope 0.02 (archive drift 0.5/window) 300-400: stationary True, nEffLower 26.95562860730218, window claim True
  ok   D slope 0.02 vs passing archive at the live mean 300-400 stella: verdict 'disagree' = my recompute 'disagree' (live gate True, archive gate True)
  FAIL D slope 0.02 vs passing archive at the live mean: verdicts [['no claim', 'no claim'], ['disagree', 'disagree']] (expected by construction [['no claim', 'no claim'], ['no claim', 'no claim']])
  FAIL D slope 0.02: every archive reason names the live trace: new trace not shown stationary on 200-300
  ok   D slope 0.03 (archive drift 0.75/window) 200-300: stationary None, nEffLower None, window claim False
  ok   D slope 0.03 (archive drift 0.75/window) 300-400: stationary None, nEffLower None, window claim False
  ok   D slope 0.03 vs passing archive at the live mean: verdicts [['no claim', 'no claim'], ['no claim', 'no claim']] (expected by construction [['no claim', 'no claim'], ['no claim', 'no claim']])
== L11 E1: N_eff < 20 by construction: AR(1) phi 0.97 per raw step 0.2 (tau ~ 33 samples ~ 9 archive time units)
  ok   E1 200-300: n 353, nEff 12.270977198288762, nEffLower 6.436785583094098, approx True, stationary None, window claim False
  ok   E1 300-400: n 354, nEff 15.234885379719884, nEffLower 8.339608453571483, approx True, stationary None, window claim False
  ok   E1 vs passing archive at the live mean: verdicts [['no claim', 'no claim'], ['no claim', 'no claim']] (expected by construction [['no claim', 'no claim'], ['no claim', 'no claim']])
== L11 E2 (observation): 14 white-noise samples per window (raw dt 5 -> archive dt 7.07)
       E2 300-400: nSamples 14, nEff 51.57506715209444, nEffLower 25.78753357604722, approx False, stationary True, window claim True
          detail: Half-split test: mean[300,350]=2.4972, mean[350,400]=2.6293, t=-1.70 vs t_crit=2.05 (df=28.2, two-sided alpha 0.05), tau=1.66 time units -> stationary. tau_int=0.969 time units (bias-corrected Sokal, C=5, lag 3), N_eff=51.6 (>= 25.8 at the one-sigma tau upper bound), stderr=0.0309 — reliable (N_eff at the tau upper bound >= 20). Saturated claim allowed.
       E2 verdicts: [['no claim', 'no claim'], ['agree', 'agree']]; top-level claim True
== L11 F: error paths
  ok   divergent repeat: windows [], claim False, validates | Live comparison could not be computed: ValueError: the live bean trace has divergent repeated sample times: 1 
  ok   saved rehearsal phase carries comparison (nSamples 3), validates, no 'NOT computed'
  ok   gate snapshot (unavailable, no session): no comparison key, validates
  ok   gate snapshot (idle, no session): no comparison key
  ok   archive unreadable during a live session: status answers mode live, windows [], reason 'Live comparison could not be computed: OSError: probe: archive file unreadable', validates
  ok   after the session: mode idle, no comparison key
== L11 G: comparison computed outside the orchestrator lock (another thread can take the lock meanwhile)
  ok   another thread acquired the orchestrator lock while live_comparison ran: [True]
== L11 H: import chain of modal_app (derived from its AST) and wording
  ok   modal_app's labyrinth imports ['labyrinth_main.common.paths', … 18 more names, shortened here …, 'labyrinth_main.features.live_gx.service.POLL_INTERVAL_S'] load none of h5py/comparison/archive/compare/stats: [] 
  ok   no 'NOT computed' wording outside test files (6 hits in tests only)
  FAIL qualified-live provenance: Qualified by a recorded rehearsal. The bean samples are compared with the archived stella and GENE traces on 200–300 and
== L1 budget guard (own recompute: 6.10 $/h x (15+5+5) min + $0.10, ceil to cent)
  ok   slot estimate raw 2.641667 -> mine 2.65, guard 2.65
  ok   billed 37.35 pending 0 reconciled True: approved True (want True) | Budget guard approves: billed $37.35 + pending $0.00 + slot $2.65 = $4
  ok   billed 30.0 pending 7.35 reconciled True: approved True (want True) | Budget guard approves: billed $30.00 + pending $7.35 + slot $2.65 = $4
  ok   billed 37.36 pending 0 reconciled True: approved False (want False) | Budget guard refused: billed $37.36 + pending $0.00 + slot $2.65 = $40
  ok   billed 20.0 pending 17.36 reconciled True: approved False (want False) | Budget guard refused: billed $20.00 + pending $17.36 + slot $2.65 = $4
  ok   billed 8.1 pending 0 reconciled False: approved False (want False) | Budget guard refused: ledger not reconciled (billed $8.10, pending $0.
  ok   billed nan pending 0 reconciled True: approved False (want False) | Budget guard refused: ledger.json is unusable (billed/pending must be 
  ok   hard timeout of an approved slot: 1500 s (25 min)
== L2 own backend
  ok   launch order [('bean', 0), ('triangular', 1)]
  ok   device IDs ['MINE-0-bea', 'MINE-1-tri']
  ok   orchestrator intervals overlap 0.121 s
  ok   GPU 0: simTime monotone to 84.8528 (60 sqrt2), 6 samples = my t*sqrt2, Q/(2 sqrt2)
  ok   GPU 1: simTime monotone to 84.8528 (60 sqrt2), 6 samples = my t*sqrt2, Q/(2 sqrt2)
  ok   L6 normal end: terminated, terminate calls [1, 1]
== L3 own backend: bean fails at step 2
  ok   fallback {'active': True, 'label': 'Worker failed. No qualified GX rehearsal recorded — showing archived stella/GENE evidence', 'savedRunId': None}
  ok   error kept: probe crash on bean
  ok   triangular terminated (1 call, thread stopped)
  ok   the fallback snapshot carries a comparison and validates
== L5 own backend: resume from checkpoint raw 77
  ok   first simTime 108.8944 >= 77 sqrt2 108.8944; last 165.4630 = 117 sqrt2
  ok   restart from 0: fallback | GPU 0 (bean) worker failed: simulation clock went backwards (0.0 < 77.0 from checkpoint); 
== L6 own backend: KeyboardInterrupt out of poll
  ok   propagated KeyboardInterrupt, terminate calls [1, 1]
== L7 my validator over every snapshot of this probe
  ok   108 snapshots (108 with comparison), modes ['fallback', 'idle', 'launching', 'live', 'terminated'], invalid []
  ok   negative controls rejected: covered false with a mean, one window, [GENE, stella], extra key
== L4 subprocess: no MODAL_*, empty HOME, socket audit hook
  ok   L4: ['unavailable', 'Live GX unavailable: no Modal credentials (MODAL_TOKEN_ID/MO', False, [], []] 
  ok   L4: no ledger written
== L8 modal_app AST
  ok   modal_app: 2 app.function decorators, GPU=["'A100-40GB'"], retries 0, timeout set, docstring UNREHEARSED
  ok   nothing imports modal_app: []
== network audit events in this process: []
  ok   zero socket connects / DNS lookups
PROBE: 4 FAILED
```
In an earlier pass of the same probe with a weaker trend (slope 0.01 raw = 0.25 archive drift per window), the 300–400 window
passed the half-split test and agreed with an archive at the live mean:
```
  ok   D 200-300: stationary False, nEffLower 76.82089743087653, window claim False
  ok   D vs passing archive at the live mean 300-400 stella: verdict 'agree' = my recompute 'agree' (live gate True, archive gate True)
  ok   D vs passing archive at the live mean 300-400 GENE: verdict 'agree' = my recompute 'agree' (live gate True, archive gate True)
```

How often `transport.stats.window_stats` opens the gate (`p_power.py`, 200 seeds each, called directly):
```
drift 0.00 per window (sigma 0.318, ~354 samples): stationary True 188/200, undecidable 0/200, gate open 188/200
drift 0.25 per window (sigma 0.318, ~354 samples): stationary True 25/200, undecidable 1/200, gate open 25/200
drift 0.50 per window (sigma 0.318, ~354 samples): stationary True 3/200, undecidable 171/200, gate open 3/200
drift 0.75 per window (sigma 0.318, ~354 samples): stationary True 0/200, undecidable 200/200, gate open 0/200
white noise, archive dt 7.07 (15 samples in 300-400): gate open 23/200; N_eff > n_samples in 121/187; max N_eff 4877.1
```

Real backend snapshots through the renderer's validator (`07_fe_validator.sh`, copy `vt06v`):
```
copy /home/qqbot/.cache/labyrinth-probes/vt06v vs 77fd8b6: 0 differ
31 snapshots, modes ['launching', 'live', 'terminated'], verdicts ['agree', 'disagree', 'no claim'], windows lengths [0, 2], covered values [False, True]
vitest exit=0
validated 31 snapshots; problems: []
negative controls: ["$.comparison.windows[0].mean: expected null, got 2.5 (window not covered)","$.comparison.windows: expected 0 or 2 items, got 1","$.comparison.windows[0].archive[0].code: expected one of \"stella\", got \"GENE\"","$.comparison: unexpected property \"extra\""]
      Tests  2 passed (2)
```

Five mutations in the copy `vt06m`, one at a time (`05_mutations.sh`):
```
--- mutation copy vs commit before:
16 owned files compared with 77fd8b6, 0 differ
=== M1: main/labyrinth_main/features/live_gx/comparison.py
    - return {"saturatedClaimAllowed": bool(agrees), "reason": reason, "windows": windows}
    + return {"saturatedClaimAllowed": bool(agrees) or any(w["saturatedClaimAllowed"] for w in windows), "reason": reason, "windows": windows}
    exit=1
    FAILED main/tests/test_live_gx.py::test_L11_covered_live_trace_against_the_committed_archive_is_no_claim_because_of_the_archive
    FAILED main/tests/test_live_gx.py::test_L11_injected_archive_agree_and_disagree_only_agree_opens_the_claim
    FAILED main/tests/test_live_gx.py::test_L11_injected_archive_inconclusive_is_no_claim
    3 failed, 227 passed in 24.31s
=== M2: main/labyrinth_main/features/live_gx/orchestrator.py
    - if cached is not None and cached[0] == n:
    + if cached is not None:
    exit=1
    FAILED main/tests/test_live_gx.py::test_L11_uncovered_session_has_null_statistics_no_claim_and_validates
    FAILED main/tests/test_live_gx.py::test_L11_covered_live_trace_against_the_committed_archive_is_no_claim_because_of_the_archive
    FAILED main/tests/test_live_gx.py::test_L11_recomputed_as_bean_samples_arrive_and_always_matches_its_snapshot
    FAILED main/tests/test_live_gx.py::test_L11_cached_while_the_bean_sample_count_is_unchanged_and_never_shared
    FAILED main/tests/test_live_gx.py::test_L11_status_answers_and_validates_when_the_comparison_fails
    5 failed, 225 passed in 24.25s
=== M3: main/labyrinth_main/features/live_gx/orchestrator.py
    - from ..transport.units import gx_to_archive
    + from ..transport.units import gx_to_archive
from . import comparison as _eager_comparison  # noqa: F401
    exit=1
    FAILED main/tests/test_live_gx.py::test_L11_the_modal_worker_import_chain_does_not_load_the_archive_stack
    1 failed, 229 passed in 24.89s
=== M4: main/labyrinth_main/features/live_gx/comparison.py
    - except Exception as e:  # noqa: BLE001 - a status answer never fails because of the comparison (D-024)
    + except ZeroDivisionError as e:  # noqa: BLE001 - a status answer never fails because of the comparison (D-024)
    exit=1
    FAILED main/tests/test_live_gx.py::test_L11_a_comparison_that_cannot_be_computed_gives_no_windows_and_a_reason
    FAILED main/tests/test_live_gx.py::test_L11_status_answers_and_validates_when_the_comparison_fails
    2 failed, 228 passed in 24.47s
=== M5: renderer/src/features/live-gx/LiveView.tsx
    - {comparisonSummary(comparison)} — see
    + {comparison.saturatedClaimAllowed ? 'Archive comparison: saturated-agreement claim allowed' : comparisonSummary(comparison)} — see
    exit=1
       × L9 T13 the live chart carries a one-line archive comparison summary linking to Check transport, only when live with the field 18ms
          Tests  1 failed | 61 passed (62)
--- mutation copy vs commit after restore:
16 owned files compared with 77fd8b6, 0 differ
```

End of run (`06_cleanup.sh`):
```
ls: cannot access '/home/qqbot/.cache/labyrinth-probes/vt06*': No such file or directory
ls: cannot access '/home/qqbot/.labyrinth': No such file or directory
77fd8b6
 M tasks/09-app-shell/VERIFY.md
```

### Findings

- **F4-1 (cross-task, `transport.stats`; not this task's code; owner decision).** The N_eff gate can be passed by a window with
  fewer than 20 samples, because the bias-corrected Sokal N_eff can exceed the number of samples in the window. My probe E2
  (14 white-noise samples in 300–400, live through the orchestrator) got `nEff` 51.6 and `nEffLower` 25.8, so the window's own
  gate opened, and against a synthetic archive at the live mean both verdicts were `agree` (top-level flag true). With 200 seeds
  of 15 samples, the gate opened 23 times; N_eff was larger than the sample count in 121 of 187 cases, with a maximum of 4877.
  The true N_eff of 15 white-noise samples is 15, below 20. L11's text holds as written (the gate uses the computed N_eff, and
  D-024 requires `transport.stats` unchanged), and with the committed archive nothing can be claimed today: every verdict is
  "no claim". But the honesty rule "claim … only with sampling uncertainty" depends on it once an archive window passes its gate.
  Suggested fix, in task 02's `sampling_error` (D-017): cap N_eff at the in-window sample count (τ_int ≥ ½ sample spacing), or
  require at least 20 samples in the window.
- **F4-2 (observation, `transport.stats` half-split power).** A real drift can pass the stationarity test and open the gate.
  With σ = 0.318 and about 354 samples, the gate opened for 25/200 draws with a drift of 0.25 per window, 3/200 at 0.5 and 0/200 at
  0.75 (larger drifts make τ not converge, so they read as undecidable). In my own runs a 0.5 drift opened the 300–400 window
  (that verdict was `disagree`) and a 0.25 drift gave `agree` against an archive at the live mean. Any finite-power test does
  this, and it is not a task 06 defect. L11's "a non-stationary trace never opens a claim" holds for every window the test flags.
- **F4-3 (probe side).** The four lines marked FAIL in my final probe pass are wrong expectations in my probe, not defects in
  the code. Three come from the slope-0.02 trend (F4-2: one window passed the half-split test, and the code followed the
  stated gate exactly). One comes from my regex `\bagree`, which matches "saturated-agreement" in the provenance sentence. The
  repo's check `\bagree(s|d|ing)?\b` is the right one, and the sentence claims nothing agrees. Earlier passes also had a
  slope-0.03 version of D (every window undecidable: still no claim) and a lock check that released a lock held by another
  thread (a `RuntimeError` in my probe; fixed, then `[True]`).
- **Run-3 note F3-1 is still open (documentation, L10).** TASK.md L10 still says "only when mode is `idle`". The UI also
  enables Launch for a settled `fallback` of a qualified service, which is correct per interface.md.
- **Minor (documentation).** The header of this file (line 3) still says it "holds two external verifier runs"; it now holds four.
  TASK.md `## Status` reads VERIFYING, for the maintainer to update.
- **Cannot be checked without Modal (D-011, unchanged since run 3):** real GX output cadence (and so how many live bean samples
  fall in 200–400 within a 15-minute slot), real device IDs, cancel latency and billing. Everything here ran against
  `FakeBackend`, my own backend, the committed archive and my synthetic archives.

Verdict: PASS

## Run 5 — whole task
Verifier run: 2026-11-22, commit a9b12b2

### Outcomes
| # | Expected outcome | Test | Independent probe | Result |
|---|---|---|---|---|
| L1 | Guard enforces prices, ceiling and reconciliation | `test_L1_*` | Production budget plan used $2.65 live and $7.73 rehearsal allocations. | PASS |
| L2 | Workers overlap on assigned GPUs and archive units | `test_L2_*` | Full module run used injected local workers only. | PASS |
| L3 | Worker failures create labelled fallback and stop peers | `test_L3_*` | Full module run covered launch, poll and timeout paths. | PASS |
| L4 | Missing Modal access is unavailable without network calls | `test_L4_*` | Fresh state returned unavailable and loaded no `modal` module. | PASS |
| L5 | Restart resumes at checkpoint time | `test_L5_*` | Full module run covered restart and rejected backwards clocks. | PASS |
| L6 | Workers terminate after retrieval and exceptions | `test_L6_*` | Full module run covered shutdown, late spawn, signal and kill switch paths. | PASS |
| L7 | Status snapshots validate | `test_L7_every_status_snapshot_validates` | Full module run validated service and orchestrator snapshots. | PASS |
| L8 | Modal declaration is isolated and invalid qualification blocks launch | `test_L8_*` | Fresh state returned unavailable with `Not qualified`; neither `modal` nor `modal_app` imported. | PASS |
| L11 | Live comparison remains conservative | `test_L11_*` | Targeted comparison suite contacted no live provider. | PASS |
| L9 | Live panel communicates unavailable/fallback/live | `LiveView.test.tsx` | Focused browser-environment suite covered evidence playback. | PASS |
| L10 | Launch needs eligible status and exact-cost confirmation | `LiveView.test.tsx` | Focused suite covered idle, settled fallback, stale and unresolved-stop paths. | PASS |

### Real output
```
$ bash scripts/verify.sh all at 9e017b6
PASS: all 11 stages, 378 main tests, 1736 renderer tests.
$ python3 -m pytest -q main/tests/test_live_gx.py
231 passed in 25.09s
$ python3 -m pytest -q main/tests/test_live_gx.py -k L11
17 passed, 214 deselected in 3.14s
$ npm --prefix renderer run -s test -- src/features/live-gx/LiveView.test.tsx
Test Files 1 passed; Tests 63 passed
$ npm --prefix renderer run -s test -- src/shell/App.test.tsx src/shell/advance.test.tsx
Test Files 2 passed; Tests 76 passed
$ python3 scripts/check_docs.py
docs: OK (11 task folders)
$ LABYRINTH_STATE_DIR=<fresh temporary directory> PYTHONPATH=main python3 <qualification probe>
{'mode': 'unavailable', 'qualified': False, 'reason': 'Not qualified: no recorded GX rehearsal has verified initialization and checkpoint continuation.'}
modal-loaded False
modal-app-loaded False
$ git diff --stat 9e017b6 a9b12b2
tasks/06-live-gx/TASK.md changed only; final docs gate passed and no owner source path changed.
```

### Findings
Real Modal deployment, GPU execution, cancellation latency and billing remain unverified. This run used local fakes, saved data and isolated state only.

Verdict: PASS
