from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import settings as app_settings
from app.routers import assistant, auth, contracts, emaint_demo, expenses, field, master_revenue, slot_master, warehouse_inventory
from app.routers.v1 import health as v1_health

app_settings.load_local_env()

app = FastAPI(title="Portfolio API (live)", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(master_revenue.router)
app.include_router(field.router)
app.include_router(auth.router)
app.include_router(emaint_demo.router)
app.include_router(warehouse_inventory.router)
app.include_router(contracts.router)
app.include_router(slot_master.router)
app.include_router(expenses.router)
app.include_router(assistant.router)
app.include_router(v1_health.router, prefix="/api/v1", tags=["v1"])
app.include_router(v1_health.router, prefix="/v1", tags=["v1"])


@app.get("/health")
def health_probe():
    """Lightweight probe; full DB status lives at GET /api/health."""
    return {"ok": True, "environment": "live"}
