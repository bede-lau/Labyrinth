"""`python3 -m labyrinth_main.server [--port N]` — serve the API on 127.0.0.1 (default port 8787).

On SIGINT (Ctrl-C), SIGTERM or SIGHUP the process terminates any running GPU workers and then stops serving
(LabyrinthServer.shutdown); it never relies on daemon threads dying with the process. The first stop signal
makes every later one ignored, so a second signal cannot interrupt that shutdown.
A signal that was ignored when the process started (nohup, a shell's background job) stays ignored.

The API is served by its own thread and the main thread only waits for a stop signal, so /api/health and
/api/live/status keep answering during the whole shutdown — a termination that is not confirmed stays visible
as TERMINATE FAILED / TERMINATION PENDING until the process exits. If the stop is not confirmed, the reason
is printed BEFORE anything is waited for, and the exit code is 2 with "NOT confirmed terminated — check Modal".
"""
from __future__ import annotations

import argparse
import signal
import sys
import threading

from ..features.live_gx.service import LiveService
from .app import DEFAULT_HOST, DEFAULT_PORT, make_server

STOP_SIGNALS = tuple(getattr(signal, name) for name in ("SIGINT", "SIGTERM", "SIGHUP") if hasattr(signal, name))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(prog="python3 -m labyrinth_main.server", description=__doc__)
    ap.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"TCP port on {DEFAULT_HOST} (0 = ephemeral)")
    return ap.parse_args(argv)


def _interrupt(signum, frame):
    """Every stop signal takes the same clean path as Ctrl-C — once: all of them are ignored from here on,
    so a second signal can never raise into the shutdown that the first one started."""
    for s in STOP_SIGNALS:
        signal.signal(s, signal.SIG_IGN)
    raise KeyboardInterrupt(f"signal {signum}")


def _say(line: str, *, to_stderr: bool = False) -> None:
    """Print, but never let a dead terminal (hangup, closed pipe) break the exit path."""
    try:
        print(line, file=sys.stderr if to_stderr else sys.stdout, flush=True)
    except (OSError, ValueError):
        pass


def _warn_unconfirmed(reason: str) -> None:
    """Called by the shutdown as soon as a stop is unconfirmed, before it waits for anything."""
    for to_stderr in (False, True):
        _say(f"Termination not confirmed yet — check the Modal dashboard now. {reason}", to_stderr=to_stderr)


def main(argv: list[str] | None = None, *, service: LiveService | None = None) -> int:
    """`service` is a programmatic hook for tests only; the command line cannot set it."""
    args = parse_args(argv)
    srv = make_server(args.port, service=service)
    host, port = srv.server_address[:2]
    previous = {s: signal.getsignal(s) for s in STOP_SIGNALS}
    # poll_interval: how long the final "stop serving" may take once the workers have been dealt with
    serving = threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.05}, name="labyrinth-api", daemon=True)
    confirmed = False
    try:
        for s, old in previous.items():
            if old is not signal.SIG_IGN:  # ignored at start-up (nohup, background job): stays ignored
                signal.signal(s, _interrupt)
        serving.start()
        _say(f"Labyrinth API listening on http://{host}:{port}")
        while serving.is_alive():  # the stop signal raises KeyboardInterrupt here, in the main thread
            serving.join(0.2)
    except KeyboardInterrupt:
        pass
    finally:
        for s in STOP_SIGNALS:  # also when serving ended some other way: nothing may interrupt the termination
            signal.signal(s, signal.SIG_IGN)
        if serving.ident is not None:  # the API thread is (or was) serving: it answers during the termination
            confirmed = srv.shutdown(_warn_unconfirmed)
        else:
            confirmed = srv.service.shutdown(_warn_unconfirmed)
        srv.server_close()
        for s, old in previous.items():
            if old is not None:
                signal.signal(s, old)
        _say("Labyrinth API stopped; workers " + ("terminated." if confirmed else "NOT confirmed terminated — check Modal."))
    return 0 if confirmed else 2


if __name__ == "__main__":
    sys.exit(main())
