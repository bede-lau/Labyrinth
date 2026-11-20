"""`python3 -m labyrinth_main.server [--port N]` — serve the API on 127.0.0.1 (default port 8787).

On SIGINT (Ctrl-C), SIGTERM or SIGHUP the process stops serving and terminates any running GPU workers
before exiting (LiveService.shutdown); it never relies on daemon threads dying with the process. The
first stop signal makes every later one ignored, so a second signal cannot interrupt that shutdown.
A signal that was ignored when the process started (nohup, a shell's background job) stays ignored.
"""
from __future__ import annotations

import argparse
import signal
import sys

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


def main(argv: list[str] | None = None, *, service: LiveService | None = None) -> int:
    """`service` is a programmatic hook for tests only; the command line cannot set it."""
    args = parse_args(argv)
    srv = make_server(args.port, service=service)
    host, port = srv.server_address[:2]
    previous = {s: signal.getsignal(s) for s in STOP_SIGNALS}
    try:
        for s, old in previous.items():
            if old is not signal.SIG_IGN:  # ignored at start-up (nohup, background job): stays ignored
                signal.signal(s, _interrupt)
        print(f"Labyrinth API listening on http://{host}:{port}", flush=True)
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        for s in STOP_SIGNALS:  # also when serving ended some other way: nothing may interrupt the termination
            signal.signal(s, signal.SIG_IGN)
        srv.stopping.set()
        confirmed = srv.service.shutdown()
        srv.server_close()
        for s, old in previous.items():
            if old is not None:
                signal.signal(s, old)
        print("Labyrinth API stopped; workers " + ("terminated." if confirmed else "NOT confirmed terminated — check Modal."),
              flush=True)
    return 0 if confirmed else 2


if __name__ == "__main__":
    sys.exit(main())
