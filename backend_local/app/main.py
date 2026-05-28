from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import settings as app_settings
from app.routers import emaint_demo, field, master_revenue
from app.routers.v1 import health as v1_health

app_settings.load_local_env()

app = FastAPI(title="Portfolio API (local)", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(master_revenue.router)
app.include_router(field.router)
app.include_router(emaint_demo.router)
app.include_router(v1_health.router, prefix="/api/v1", tags=["v1"])
# Legacy paths kept for tunnel tests / curl
app.include_router(v1_health.router, prefix="/v1", tags=["v1"])


@app.get("/health")
def health_probe():
    """Lightweight probe; full DB status lives at GET /api/health."""
    return {"ok": True, "environment": "local"}
