"""`python3 -m labyrinth_main.server [--port N]` — serve the API on 127.0.0.1 (default port 8787).

On SIGINT (Ctrl-C) or SIGTERM the process stops serving and terminates any running GPU workers
before exiting (LiveService.shutdown); it never relies on daemon threads dying with the process.
"""
from __future__ import annotations

import argparse
import signal
import sys

from ..features.live_gx.service import LiveService
from .app import DEFAULT_HOST, DEFAULT_PORT, make_server


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(prog="python3 -m labyrinth_main.server", description=__doc__)
    ap.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"TCP port on {DEFAULT_HOST} (0 = ephemeral)")
    return ap.parse_args(argv)


def _interrupt(signum, frame):  # SIGTERM -> same clean path as Ctrl-C
    raise KeyboardInterrupt(f"signal {signum}")


def main(argv: list[str] | None = None, *, service: LiveService | None = None) -> int:
    """`service` is a programmatic hook for tests only; the command line cannot set it."""
    args = parse_args(argv)
    srv = make_server(args.port, service=service)
    previous = signal.signal(signal.SIGTERM, _interrupt)
    host, port = srv.server_address[:2]
    print(f"Labyrinth API listening on http://{host}:{port}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)  # a second signal must not interrupt the termination itself
        previous_int = signal.signal(signal.SIGINT, signal.SIG_IGN)
        srv.stopping.set()
        confirmed = srv.service.shutdown()
        srv.server_close()
        signal.signal(signal.SIGTERM, previous)
        signal.signal(signal.SIGINT, previous_int)
        print("Labyrinth API stopped; workers " + ("terminated." if confirmed else "NOT confirmed terminated — check Modal."),
              flush=True)
    return 0 if confirmed else 2


if __name__ == "__main__":
    sys.exit(main())
