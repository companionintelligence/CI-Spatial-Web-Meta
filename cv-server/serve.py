"""Run the CV server. It listens on 127.0.0.1 unless you ask for another address.

    python serve.py                          # http://127.0.0.1:8000
    CV_HOST=192.168.1.50 python serve.py     # a specific LAN address, on purpose

The API needs its bearer token on every /v1 request, whatever address it listens on.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000


def parse_args(argv=None, env=os.environ) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Companion Scan CV server.")
    parser.add_argument("--host", default=env.get("CV_HOST") or DEFAULT_HOST,
                        help="address to listen on (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=int(env.get("CV_PORT") or DEFAULT_PORT),
                        help="port to listen on (default: 8000)")
    return parser.parse_args(argv)


def main(argv=None) -> None:
    import uvicorn

    args = parse_args(argv)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    uvicorn.run("main:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
