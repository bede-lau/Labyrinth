"""Labyrinth main-process HTTP API (stdlib `http.server` only).

  GET  /api/health            {"ok": true, "version": ...}
  GET  /api/live/status       live status (contracts/live-status.schema.json)
  GET  /api/live/stream       Server-Sent Events: `data: <status json>\\n\\n` per snapshot
  POST /api/live/launch       {"confirmCostUsd": <current slot estimate, to the cent>} -> 202, else 409
                              {"ok": false, "reason", "status"} for every refusal (nothing launched or reserved)
  POST /api/live/terminate    always allowed -> 200 when every worker's termination is confirmed (a cancel
                              succeeded), 502 {"ok": false, "reason": "TERMINATE FAILED ..." | "TERMINATION
                              PENDING ..."} otherwise (retry it). A kill-switch-only stop is a 502.
  GET  /api/live/runs/<id>    a saved, verified rehearsal run (strict id; from the state dir) or 404
  GET  /artifacts/<file>      files under artifacts/ only (resolved path must stay inside; else 404)

Binds 127.0.0.1 only. Requests whose Host/Origin is not loopback get 403 (DNS-rebinding / CSRF guard),
and launch additionally requires `Content-Type: application/json` (no simple cross-site form POST).
No CORS headers are sent: the UI reaches the API through its dev-server proxy or same origin.
Only GET and POST exist: any other method (PUT, DELETE, PATCH, OPTIONS, HEAD, TRACE, CONNECT, or any other
token) gets 405 with an `Allow` header naming what the path does accept — never the stdlib's 501 page.
A connection that stops sending is dropped after `request_timeout_s`, and terminate never waits for a body.
"""
from __future__ import annotations

import json
import re
import threading
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from .. import __version__
from ..common.paths import ARTIFACTS
from ..features.live_gx.service import LiveService

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8787
MAX_BODY = 4096
MAX_STREAMS = 8
REQUEST_TIMEOUT_S = 15.0  # a client that announces a body (or headers) and stops sending holds a thread this long
RUN_PATH = re.compile(r"^/api/live/runs/((?:rehearsal|live)-[0-9a-f]{12})$")
GET_ROUTES = {"/api/health", "/api/live/status", "/api/live/stream"}
POST_ROUTES = {"/api/live/launch", "/api/live/terminate"}
LOOPBACK = re.compile(r"^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$", re.I)
LOOPBACK_ORIGIN = re.compile(r"^https?://(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$", re.I)
CONTENT_TYPES = {".json": "application/json", ".txt": "text/plain; charset=utf-8", ".png": "image/png",
                 ".svg": "image/svg+xml", ".csv": "text/csv; charset=utf-8"}


class LabyrinthServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, addr, *, service: LiveService, artifacts_dir: Path = ARTIFACTS, stream_interval_s: float = 1.0,
                 max_streams: int = MAX_STREAMS, request_timeout_s: float = REQUEST_TIMEOUT_S):
        self.service = service
        self.artifacts_dir = artifacts_dir.resolve()
        self.stream_interval_s = stream_interval_s
        self.request_timeout_s = request_timeout_s
        self.stream_slots = threading.BoundedSemaphore(max_streams)
        self.stopping = threading.Event()
        super().__init__(addr, Handler)

    def shutdown(self, on_unconfirmed: Callable[[str], None] | None = None) -> bool:
        """Terminate any GPU workers (never leave them billing), then stop the streams and stop serving.
        -> whether every termination is confirmed. The API keeps answering while the workers are being
        terminated — however long that takes — so /api/live/status goes on saying TERMINATE FAILED /
        TERMINATION PENDING instead of timing out (a UI that cannot reach the API shows "replay")."""
        confirmed = self.service.shutdown(on_unconfirmed)
        self.stopping.set()
        super().shutdown()
        return confirmed


class Handler(BaseHTTPRequestHandler):
    server: LabyrinthServer
    server_version = "labyrinth"
    sys_version = ""
    # HTTP/1.0: one request per connection, so an unread body can never bleed into a next request.

    def log_message(self, fmt, *args):  # quiet by default; errors still go to the JSON body
        pass

    def setup(self) -> None:
        self.timeout = self.server.request_timeout_s  # socket timeout: a stalled client cannot hold a thread for ever
        super().setup()

    def __getattr__(self, name: str):
        # BaseHTTPRequestHandler answers a method it finds no `do_<METHOD>` for with its own 501 HTML page
        # (TRACE, CONNECT, "get", any token): every method other than GET and POST is a 405 here instead.
        if name.startswith("do_"):
            return self._refuse_method
        raise AttributeError(name)

    # ---- helpers -------------------------------------------------------
    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code: int, obj: dict, extra: dict | None = None) -> None:
        self._send(code, (json.dumps(obj, allow_nan=False) + "\n").encode(), "application/json", extra)

    def _error(self, code: int, reason: str, extra: dict | None = None) -> None:
        self._json(code, {"ok": False, "reason": reason}, extra)

    def _path(self) -> str:
        return urlsplit(self.path).path

    def _origin_ok(self) -> bool:
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin")
        return bool(LOOPBACK.match(host)) and (origin is None or bool(LOOPBACK_ORIGIN.match(origin)))

    def _read_json(self) -> tuple[dict | None, str | None]:
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None, "invalid Content-Length"
        if n < 0 or n > MAX_BODY:
            return None, f"body must be at most {MAX_BODY} bytes"
        raw = self.rfile.read(n) if n else b""
        if len(raw) < n:
            return None, "body ended before its Content-Length"
        try:
            obj = json.loads(raw or b"{}")
        except (ValueError, RecursionError):  # RecursionError: "[[[[…" nested deeper than the parser's limit
            return None, "body is not valid JSON"
        return (obj, None) if isinstance(obj, dict) else (None, "body must be a JSON object")

    # ---- methods -------------------------------------------------------
    def do_GET(self) -> None:
        if not self._origin_ok():
            return self._error(403, "non-loopback Host/Origin refused")
        path = self._path()
        if path in POST_ROUTES:
            return self._error(405, "use POST", {"Allow": "POST"})
        if path == "/api/health":
            return self._json(200, {"ok": True, "version": __version__})
        if path == "/api/live/status":
            return self._json(200, self.server.service.status())
        if path == "/api/live/stream":
            return self._stream()
        if path.startswith("/api/live/runs/"):
            m = RUN_PATH.match(path)
            run = self.server.service.saved_run(m.group(1)) if m else None
            return self._json(200, run) if run is not None else self._error(404, "no such saved run")
        if path.startswith("/artifacts/"):
            return self._artifact(path[len("/artifacts/"):])
        return self._error(404, "not found")

    def do_POST(self) -> None:
        if not self._origin_ok():
            return self._error(403, "non-loopback Host/Origin refused")
        path = self._path()
        if path in GET_ROUTES or path.startswith("/artifacts/"):
            return self._error(405, "use GET", {"Allow": "GET"})
        if path not in POST_ROUTES:
            return self._error(404, "not found")
        svc = self.server.service
        if path == "/api/live/terminate":  # the body is ignored, so it is never waited for: terminate comes first
            confirmed, message = svc.terminate()
            return self._json(200 if confirmed else 502, {"ok": confirmed, "reason": message, "status": svc.status()})

        def refuse(reason: str) -> None:  # every refusal: 409 with the reason and the current status
            self._json(409, {"ok": False, "reason": f"launch refused: {reason}", "status": svc.status()})

        body, err = self._read_json()  # (bounded: MAX_BODY bytes within request_timeout_s) read even when refused
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            return refuse("Content-Type must be application/json")
        if err:
            return refuse(err)
        if "confirmCostUsd" not in body:
            return refuse("body must be {\"confirmCostUsd\": <current slot estimate>}")
        accepted, reason = svc.launch(body["confirmCostUsd"])
        if not accepted:
            return refuse(reason)
        return self._json(202, {"ok": True, "reason": reason, "status": svc.status()})

    def _refuse_method(self) -> None:
        if not self._origin_ok():
            return self._error(403, "non-loopback Host/Origin refused")
        path = self._path()
        if path in POST_ROUTES:
            allow = "POST"
        elif path in GET_ROUTES or path.startswith(("/api/live/runs/", "/artifacts/")):
            allow = "GET"
        else:
            allow = "GET, POST"
        self._error(405, f"method {self.command[:32]} not allowed; this API answers only GET and POST", {"Allow": allow})

    do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_HEAD = do_TRACE = do_CONNECT = _refuse_method

    # ---- routes --------------------------------------------------------
    def _artifact(self, rel: str) -> None:
        rel = unquote(rel)
        root = self.server.artifacts_dir
        if not rel or "\x00" in rel or rel.startswith(("/", "\\")):
            return self._error(404, "not found")
        try:
            target = (root / rel).resolve()
        except (OSError, ValueError):
            return self._error(404, "not found")
        if not target.is_relative_to(root) or not target.is_file():
            return self._error(404, "not found")
        ctype = CONTENT_TYPES.get(target.suffix.lower(), "application/octet-stream")
        self._send(200, target.read_bytes(), ctype)

    def _stream(self) -> None:
        if not self.server.stream_slots.acquire(blocking=False):
            return self._error(503, f"too many live streams (max {MAX_STREAMS}); poll /api/live/status instead")
        try:
            self._stream_events()
        finally:
            self.server.stream_slots.release()

    def _stream_events(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        try:
            while not self.server.stopping.is_set():
                event = "data: " + json.dumps(self.server.service.status(), allow_nan=False) + "\n\n"
                self.wfile.write(event.encode())
                self.wfile.flush()
                if self.server.stopping.wait(self.server.stream_interval_s):
                    break
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError):  # the client went away
            pass


def make_server(port: int = DEFAULT_PORT, *, service: LiveService | None = None, artifacts_dir: Path = ARTIFACTS,
                stream_interval_s: float = 1.0, max_streams: int = MAX_STREAMS,
                request_timeout_s: float = REQUEST_TIMEOUT_S) -> LabyrinthServer:
    return LabyrinthServer((DEFAULT_HOST, port), service=service or LiveService(), artifacts_dir=artifacts_dir,
                           stream_interval_s=stream_interval_s, max_streams=max_streams, request_timeout_s=request_timeout_s)
