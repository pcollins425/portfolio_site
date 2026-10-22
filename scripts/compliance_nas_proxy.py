#!/usr/bin/env python3
"""Host-side Compliance file server for Theme Hub (files stay on Analytics NAS).

Docker Desktop on the Slot Server cannot reach //192.168.1.99 from inside the
container (SMB/CIFS timeout). This process runs on Windows with the share
mapped (X:\\Compliance or UNC) and serves bytes to the API over
host.docker.internal.

  set COMPLIANCE_NAS_ROOT=X:\\Compliance
  python scripts/compliance_nas_proxy.py

API .env:
  COMPLIANCE_HTTP_BASE=http://host.docker.internal:9124
"""

from __future__ import annotations

import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import unquote


def _root() -> Path:
    raw = (
        os.environ.get("COMPLIANCE_NAS_ROOT")
        or r"X:\Compliance"
    ).strip()
    root = Path(raw)
    if not root.is_dir():
        alt = Path(r"\\192.168.1.99\DGS_Analytics\Compliance")
        if alt.is_dir():
            return alt
        raise SystemExit(f"Compliance root not found: {raw}")
    return root


ROOT = _root()
HOST = (os.environ.get("COMPLIANCE_PROXY_HOST") or "127.0.0.1").strip()
PORT = int((os.environ.get("COMPLIANCE_PROXY_PORT") or "9124").strip())


class Handler(BaseHTTPRequestHandler):
    server_version = "ComplianceNasProxy/1.0"

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_GET(self) -> None:  # noqa: N802
        if self.path in {"/", "/health"}:
            body = b'{"ok":true,"root":"Compliance"}\n'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        rel = unquote(self.path.lstrip("/"))
        if not rel or ".." in PurePosixPath(rel).parts:
            self.send_error(400, "invalid path")
            return
        full = (ROOT.joinpath(*PurePosixPath(rel).parts)).resolve()
        try:
            full.relative_to(ROOT.resolve())
        except ValueError:
            self.send_error(400, "invalid path")
            return
        if not full.is_file():
            self.send_error(404, "not found")
            return
        data = full.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "private, max-age=300")
        self.end_headers()
        self.wfile.write(data)


def main() -> None:
    print(f"Serving {ROOT} on http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
