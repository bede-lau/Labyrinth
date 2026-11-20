# 07 · Main-process HTTP API

## Owner
backend: backend-engineer (`main/labyrinth_main/server/`)

## Expected outcome
- H1. `python3 -m labyrinth_main.server` serves on 127.0.0.1:8787 (stdlib only).
- H2. `GET /api/health` → `{"ok": true, "version": ...}`.
- H3. `GET /api/live/status` → schema-valid live status (unavailable without credentials).
- H4. `GET /api/live/stream` → Server-Sent Events of status snapshots.
- H5. `POST /api/live/launch` requires JSON `{"confirmCostUsd": <slot estimate>}` matching the current estimate and a passing budget guard; else 409 with reason. `POST /api/live/terminate` always allowed.
- H6. `GET /artifacts/<file>` serves artifacts/ with path-traversal protection (`/artifacts/../data/raw/...` → 404).

## Tests
| # | Test |
|---|---|
| H1–H6 | `main/tests/test_server.py` (real server on an ephemeral port) |

## Status
DONE

Verified at commit 3faed3a: tasks/07-server/VERIFY.md final run, `Verdict: PASS` (external verifier, 2026-11-20). Reviewer APPROVE in the 2026-11-20 review round (status.md, Session 3).
