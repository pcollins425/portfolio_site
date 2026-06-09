#!/usr/bin/env python3
"""Minimal GitHub push webhook → deploy backend_live via Docker Compose.

Requires GITHUB_WEBHOOK_SECRET (same value as the GitHub webhook "Secret").

Example:
  export GITHUB_WEBHOOK_SECRET='...'
  python3 scripts/github-webhook-listener.py --host 127.0.0.1 --port 9009

Point GitHub → Settings → Webhooks → Payload URL at your reverse proxy, e.g.:
  https://deploy.example.com/hooks/portfolio-backend

Only push events on DEPLOY_BRANCH (default main) that touch backend_live/ or
docker-compose.yml trigger a deploy.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEPLOY_SCRIPT = ROOT / "scripts" / "deploy-backend-docker.sh"
DEPLOY_BRANCH = os.environ.get("DEPLOY_BRANCH", "main")
WEBHOOK_SECRET = os.environ.get("GITHUB_WEBHOOK_SECRET", "")
DEPLOY_PATHS = tuple(
    p.strip()
    for p in os.environ.get(
        "BACKEND_DEPLOY_PATHS", "backend_live/ docker-compose.yml"
    ).split()
    if p.strip()
)
HOOK_PATH = os.environ.get("GITHUB_WEBHOOK_PATH", "/hooks/portfolio-backend")


def _log(msg: str) -> None:
    print(msg, flush=True)


def _verify_signature(body: bytes, header: str | None) -> bool:
    if not WEBHOOK_SECRET:
        _log("GITHUB_WEBHOOK_SECRET is not set; rejecting request.")
        return False
    if not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(
        WEBHOOK_SECRET.encode("utf-8"), body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", header)


def _touches_backend(payload: dict[str, Any]) -> bool:
    for commit in payload.get("commits") or []:
        paths = (commit.get("added") or []) + (commit.get("modified") or []) + (
            commit.get("removed") or []
        )
        for path in paths:
            for prefix in DEPLOY_PATHS:
                if path == prefix.rstrip("/") or path.startswith(prefix):
                    return True
    return False


def _run_deploy() -> None:
    subprocess.Popen(
        ["bash", str(DEPLOY_SCRIPT)],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        _log(f"{self.address_string()} - {fmt % args}")

    def do_POST(self) -> None:
        if self.path.rstrip("/") != HOOK_PATH.rstrip("/"):
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)

        event = self.headers.get("X-GitHub-Event", "")
        if event == "ping":
            if _verify_signature(body, self.headers.get("X-Hub-Signature-256")):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"ok")
            else:
                self.send_error(401)
            return

        if event != "push":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ignored")
            return

        if not _verify_signature(body, self.headers.get("X-Hub-Signature-256")):
            self.send_error(401)
            return

        payload = json.loads(body.decode("utf-8"))
        ref = payload.get("ref", "")
        if ref != f"refs/heads/{DEPLOY_BRANCH}":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ignored branch")
            return

        if not _touches_backend(payload):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ignored paths")
            return

        _log(f"Push on {DEPLOY_BRANCH} touches backend; starting deploy.")
        _run_deploy()
        self.send_response(202)
        self.end_headers()
        self.wfile.write(b"deploy started")

    def do_GET(self) -> None:
        if self.path in ("/health", "/"):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok")
            return
        self.send_error(404)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9009)
    args = parser.parse_args()

    if not DEPLOY_SCRIPT.is_file():
        print(f"Missing deploy script: {DEPLOY_SCRIPT}", file=sys.stderr)
        return 1

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    _log(f"Listening on http://{args.host}:{args.port}{HOOK_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
