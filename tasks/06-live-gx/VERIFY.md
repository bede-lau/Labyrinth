# Verify: 06-live-gx (backend L1–L8 only)
Verifier run: 2026-11-19/20, commit 60a9dee at start, fcf812d at end, plus working tree (all task 06 backend files are still uncommitted: `features/live_gx/{budget_guard,orchestrator,fake_backend,modal_backend,modal_app,gx_input,service,rehearse}.py`, `main/tests/test_live_gx.py`). Before and after every probe I checked the files under test byte for byte against my mutation copy, and they did not change.

**Scope.** This file covers the backend only (L1–L8). The frontend outcomes L9–L10 (`renderer/src/features/live-gx/`) are **not yet built** and were not verified. A `LiveView.tsx` appeared there while this run was in progress, and it was not examined. **Task 06 stays not-DONE until a verifier has checked the frontend L9–L10 as well**, whatever the backend verdict below says.

Safety: I did not install `modal` (`python3 -c "import modal"` → `ModuleNotFoundError`), set no Modal credentials (`~/.modal.toml` absent, no `MODAL_*` env) and made no outbound calls. All state went to `LABYRINTH_STATE_DIR=/tmp/claude-0/-home-user-Labyrinth/7ab7c93d-a99a-5137-bbf3-e77ff0f80ade/scratchpad/v06/state`, which was still empty at the end, so no ledger was ever written.

## Outcomes
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
| L9 | Frontend live panel | — | not yet built | NOT VERIFIED |
| L10 | Frontend launch button + confirmation | — | not yet built | NOT VERIFIED |

## Real output
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

## Findings
- **F1 (defect, L3; causes the FAIL): a malformed backend report ends the session without fallback.** In `main/labyrinth_main/features/live_gx/orchestrator.py:204-213` the `try` covers only `self.backend.poll(...)` (line 205). `apply_poll(...)` (line 210) runs outside it, and so do the `result.get` calls, the `for pair in new` loop and the `ck.get` call. A poll result that is not a dict, a `checkpoint` that is not a dict, or a `new_samples_raw` that is not iterable raises AttributeError or TypeError. That exception escapes `run()`, whose `finally` sets mode `terminated` with "Session ended abnormally" (line 245): `fallback.active False`, empty label, no worker error recorded. Inside `LiveService` the exception dies silently in the daemon thread. The workers are still terminated, so there is no cost leak, but the PRD rule "if either worker fails, label and play the saved run" is broken on this path. It is also inconsistent with `apply_poll` itself, which already turns a malformed *sample pair* into a failure. The shipped `ModalBackend.poll` normally returns well-formed dicts, so in practice this needs a corrupt or foreign progress-Dict entry. No test covers it. Suggested fix: move `apply_poll` inside the `try` (or check `isinstance(result, dict)` and the field types) so the failure goes through `_fail`.
- **F2 (medium): a failed `terminate()` can leave a worker running with nothing more than an error string.** `orchestrator.py:249-263` marks the record `terminated=True` before calling `backend.terminate`. If that call raises (probe 5: the thread is still alive), the error is appended to the worker but nothing retries and nothing escalates. In production the in-container deadline bounds it (`modal_app.py:106`, guard timeout − 60 s, counted from container start), and so does Modal's absolute `timeout` of 4800 s (`modal_app.py:35`). Worst case if the worker loop hangs: 80 min × $6.10/h ≈ $8.13, against $2.65 reserved.
- **F3 (low, design): a hard timeout before both workers finish is reported as `terminated`, not `fallback`.** See `orchestrator.py:231-233`. The fallback label is empty, so the UI cannot tell "finished" from "cut off" except by reading `reason`. A worker reporting `error` text together with a non-`failed` state is ignored (probe 7, `orchestrator.py:106`).
- **F4 (low): the budget guard tolerates going up to half a cent over the ceiling.** `budget_guard.py:106` compares `round(total, 2) > ceiling_usd`, so billed 37.354 + 2.65 = 40.004 is approved, and 37.3549 too. TASK L1 says "refuses when … > $40". Ledger values entered by a human are in cents, so the real-world effect is negligible.
- **F5 (weak test): mutation D survives.** `test_L3_*` passes even when `_fail` no longer terminates the other worker, because the `finally` in `run()` terminates it a moment later. Today the two behave the same, but the "terminated on failure" part of L3 is in effect tested through L6's `finally`, not through `_fail`.
- Not verifiable here (D-011): real GX on Modal, the CUDA image build, GX TOML parameter names, `_read_flux` netCDF layouts and real device UUIDs. All of these are UNREHEARSED, and the code says so.
- verify.sh: the first run exited 2 only because of `renderer:typecheck` errors in `renderer/src/design/components/*` (another agent's in-flight work, not task 06 files). The final re-run exited 0.

Backend verdict FAIL because of F1 (L3: a failure path that ends without fallback). Task 06 stays not-DONE in any case until the frontend L9–L10 are built and verified.

Verdict: FAIL
