from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import settings as app_settings
from app.routers import analyst, assistant, assets, auth, commerce, commission_contract, contracts, documents, emaint_demo, expenses, field, master_revenue, media, parts_inventory, slot_master, software_vault, warehouse_inventory
from app.routers.v1 import health as v1_health

app_settings.load_local_env()

import logging
import os

_log = logging.getLogger("app.startup")
_media_mode = (os.environ.get("NAS_MEDIA_MODE") or "").replace("\r", "").strip() or "filesystem"
_log.info("NAS_MEDIA_MODE=%s", _media_mode)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    paths = sorted(
        {getattr(r, "path", "") for r in app.routes if "analyst" in getattr(r, "path", "")}
    )
    _log.info("analyst routes: %s", paths)
    yield
    from app import mssql

    mssql.close_pools()


app = FastAPI(title="Portfolio API (live)", version="0.1.0", lifespan=_lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(master_revenue.router)
app.include_router(analyst.router)
app.include_router(commission_contract.router)
app.include_router(field.router)
app.include_router(auth.router)
app.include_router(emaint_demo.router)
app.include_router(warehouse_inventory.router)
app.include_router(contracts.router)
app.include_router(commerce.casinos_router)
app.include_router(commerce.vendors_router)
app.include_router(assets.router)
app.include_router(media.router)
app.include_router(documents.router)
app.include_router(slot_master.router)
app.include_router(software_vault.router)
app.include_router(parts_inventory.router)
app.include_router(expenses.router)
app.include_router(assistant.router)
app.include_router(v1_health.router, prefix="/api/v1", tags=["v1"])
app.include_router(v1_health.router, prefix="/v1", tags=["v1"])


@app.get("/health")
def health_probe():
    """Lightweight probe; full DB status lives at GET /api/health."""
    return {"ok": True, "environment": "live"}
