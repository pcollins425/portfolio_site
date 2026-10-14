"""Monitor-only door in front of Dozzle.

Checks the DGS login, then streams the log UI. The Docker socket is not
mounted here. Dozzle is reached over the Docker network.
"""

from __future__ import annotations

import asyncio
import os
import time

import aiohttp
import jwt
from aiohttp import WSMsgType, web

READ_LEVELS = frozenset(
    {"READ_ONLY", "UPDATES_ONLY", "ADDS_ONLY", "ADDS_AND_UPDATES", "ALL_CHANGES"}
)
AREA = os.environ.get("LOGS_AREA", "dgs_container_logs")
COOKIE = os.environ.get("LOGS_COOKIE", "dgs_logs")
PREFIX = "/api/container-logs"
DOZZLE = os.environ["DOZZLE_URL"].rstrip("/")
SECRET = os.environ["EMAINT_DEMO_JWT_SECRET"].strip()
_HOP = {
    "content-length",
    "transfer-encoding",
    "connection",
    "keep-alive",
    "te",
    "trailer",
    "upgrade",
    "host",
    "cookie",
}

DENIED_HTML = """<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Container logs</title></head>
<body><p>You do not have access to container logs.</p></body>
</html>
"""


def _claims(token: str) -> dict | None:
    if not token:
        return None
    try:
        return jwt.decode(token, SECRET, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None


def _allowed(claims: dict | None) -> bool:
    if not claims:
        return False
    permissions = claims.get("permissions") or {}
    if not isinstance(permissions, dict):
        return False
    return permissions.get(AREA) in READ_LEVELS


def _denied() -> web.Response:
    return web.Response(status=403, text=DENIED_HTML, content_type="text/html")


async def _session(request: web.Request) -> web.Response:
    form = await request.post()
    token = (form.get("token") or "").strip()
    claims = _claims(token)
    if not _allowed(claims):
        return _denied()
    max_age = max(60, int(claims["exp"]) - int(time.time()))
    response = web.HTTPFound(PREFIX + "/")
    response.set_cookie(
        COOKIE,
        token,
        max_age=max_age,
        httponly=True,
        secure=True,
        samesite="None",
        path=PREFIX,
    )
    return response


async def _proxy_http(request: web.Request) -> web.StreamResponse:
    if not _allowed(_claims(request.cookies.get(COOKIE, ""))):
        return _denied()
    headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in _HOP
    }
    timeout = aiohttp.ClientTimeout(total=None, sock_connect=10, sock_read=None)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.request(
            request.method,
            DOZZLE + request.path_qs,
            headers=headers,
            data=await request.read(),
            allow_redirects=False,
        ) as upstream:
            response = web.StreamResponse(
                status=upstream.status,
                headers={
                    key: value
                    for key, value in upstream.headers.items()
                    if key.lower() not in _HOP
                },
            )
            await response.prepare(request)
            async for chunk in upstream.content.iter_chunked(65536):
                await response.write(chunk)
            await response.write_eof()
            return response


async def _proxy_ws(request: web.Request) -> web.StreamResponse:
    if not _allowed(_claims(request.cookies.get(COOKIE, ""))):
        return _denied()
    client = web.WebSocketResponse(heartbeat=30)
    await client.prepare(request)
    target = DOZZLE.replace("http://", "ws://", 1).replace("https://", "wss://", 1)
    timeout = aiohttp.ClientTimeout(total=None, sock_connect=10, sock_read=None)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.ws_connect(target + request.path_qs) as upstream:
            async def client_to_upstream() -> None:
                async for message in client:
                    if message.type == WSMsgType.TEXT:
                        await upstream.send_str(message.data)
                    elif message.type == WSMsgType.BINARY:
                        await upstream.send_bytes(message.data)
                    else:
                        break
                await upstream.close()

            async def upstream_to_client() -> None:
                async for message in upstream:
                    if message.type == WSMsgType.TEXT:
                        await client.send_str(message.data)
                    elif message.type == WSMsgType.BINARY:
                        await client.send_bytes(message.data)
                    else:
                        break
                await client.close()

            await asyncio.gather(client_to_upstream(), upstream_to_client())
    return client


async def handle(request: web.Request) -> web.StreamResponse:
    if request.method == "POST" and request.path.rstrip("/") == PREFIX + "/dgs-session":
        return await _session(request)
    if request.headers.get("Upgrade", "").lower() == "websocket":
        return await _proxy_ws(request)
    return await _proxy_http(request)


def main() -> None:
    app = web.Application(client_max_size=1024 * 1024)
    app.router.add_route("*", PREFIX, handle)
    app.router.add_route("*", PREFIX + "/{tail:.*}", handle)
    web.run_app(app, host="0.0.0.0", port=8080)


if __name__ == "__main__":
    main()
