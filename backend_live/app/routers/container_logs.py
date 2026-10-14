"""Forward the container-log UI to the monitor-only gate.

This process does not mount the Docker socket. The gate on the Docker
network checks the DGS session and streams Dozzle.
"""

from __future__ import annotations

import asyncio

import httpx
import websockets
from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

router = APIRouter()

_GATE = "dgs_container_logs_gate:8080"
_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


def _forward_headers(headers) -> dict[str, str]:
    return {key: value for key, value in headers.items() if key.lower() not in _HOP}


def _target(request: Request) -> str:
    url = f"http://{_GATE}{request.url.path}"
    if request.url.query:
        url += "?" + request.url.query
    return url


@router.api_route("/api/container-logs", methods=["GET", "POST", "HEAD", "OPTIONS"])
@router.api_route("/api/container-logs/", methods=["GET", "POST", "HEAD", "OPTIONS"])
@router.api_route(
    "/api/container-logs/{path:path}",
    methods=["GET", "POST", "HEAD", "PUT", "DELETE", "PATCH", "OPTIONS"],
)
async def proxy_http(request: Request, path: str = ""):
    del path
    client = httpx.AsyncClient(timeout=None)
    upstream = await client.send(
        client.build_request(
            request.method,
            _target(request),
            headers=_forward_headers(request.headers),
            content=await request.body(),
        ),
        stream=True,
    )

    async def chunks():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        chunks(),
        status_code=upstream.status_code,
        headers=_forward_headers(upstream.headers),
        background=None,
    )


def _ws_header_kw(headers: dict[str, str]) -> dict:
    params = websockets.connect.__wrapped__ if hasattr(websockets.connect, "__wrapped__") else websockets.connect
    try:
        import inspect

        names = inspect.signature(websockets.connect).parameters
    except (TypeError, ValueError):
        names = {}
    if "additional_headers" in names:
        return {"additional_headers": headers}
    return {"extra_headers": headers}


@router.websocket("/api/container-logs/{path:path}")
async def proxy_ws(websocket: WebSocket, path: str):
    await websocket.accept()
    query = websocket.url.query
    url = f"ws://{_GATE}/api/container-logs/{path}"
    if query:
        url += "?" + query
    headers = {}
    cookie = websocket.headers.get("cookie")
    if cookie:
        headers["Cookie"] = cookie
    try:
        async with websockets.connect(url, **_ws_header_kw(headers)) as upstream:
            async def client_to_upstream():
                try:
                    while True:
                        message = await websocket.receive()
                        if message.get("type") == "websocket.disconnect":
                            return
                        if message.get("text") is not None:
                            await upstream.send(message["text"])
                        elif message.get("bytes") is not None:
                            await upstream.send(message["bytes"])
                except WebSocketDisconnect:
                    return

            async def upstream_to_client():
                async for message in upstream:
                    if isinstance(message, bytes):
                        await websocket.send_bytes(message)
                    else:
                        await websocket.send_text(message)

            tasks = {
                asyncio.create_task(client_to_upstream()),
                asyncio.create_task(upstream_to_client()),
            }
            _done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
    except Exception:
        pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
