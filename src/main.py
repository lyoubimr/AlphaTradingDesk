"""
AlphaTradingDesk — FastAPI application entry point
"""

import os
import time

import httpx
import redis as redis_lib
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from src.analytics.router import router as analytics_router
from src.brokers.router import router as brokers_router
from src.ritual.router import router as ritual_router
from src.brokers.router import styles_router
from src.core.celery_app import celery_app
from src.core.config import settings
from src.core.database import get_engine
from src.core.logging_config import setup_logging
from src.goals.router import router as goals_router
from src.kraken_execution.router import router as kraken_execution_router
from src.market_analysis.router import ma_router, profiles_ma_router
from src.profiles.router import router as profiles_router
from src.risk_management.router import router as risk_router
from src.stats.router import router as stats_router
from src.strategies.router import router as strategies_router
from src.trades.router import router as trades_router
from src.volatility.router import router as volatility_router

app = FastAPI(
    title="AlphaTradingDesk",
    version=settings.app_version,
    description="Multi-asset trading platform — risk management, trade journal, market analysis",
)

# ── Logging — configure before anything else ──────────────────────
setup_logging(
    level=settings.log_level,
    log_dir=settings.log_dir,
    environment=settings.environment,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static files — uploaded images ────────────────────────────────
# Mount BEFORE api routers so /uploads/* is served directly.
# In Docker: uploads_dir is a named volume → survives container restarts.
_uploads_dir = settings.uploads_dir
try:
    os.makedirs(_uploads_dir, exist_ok=True)
except OSError:
    # Fallback to a local directory when the configured path is read-only
    # (e.g. pytest on macOS where /app doesn't exist outside Docker).
    import tempfile

    _uploads_dir = os.path.join(tempfile.gettempdir(), "atd_uploads")
    os.makedirs(_uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_uploads_dir), name="uploads")

# ── API routers ───────────────────────────────────────────────────
API_PREFIX = "/api"

app.include_router(brokers_router, prefix=API_PREFIX)
app.include_router(styles_router, prefix=API_PREFIX)
app.include_router(profiles_router, prefix=API_PREFIX)
app.include_router(goals_router, prefix=API_PREFIX)
app.include_router(trades_router, prefix=API_PREFIX)
app.include_router(stats_router, prefix=API_PREFIX)
app.include_router(strategies_router, prefix=API_PREFIX)
app.include_router(ma_router, prefix=API_PREFIX)
app.include_router(profiles_ma_router, prefix=API_PREFIX)
app.include_router(volatility_router, prefix=API_PREFIX)
app.include_router(risk_router, prefix=API_PREFIX)
app.include_router(kraken_execution_router, prefix=API_PREFIX)
app.include_router(analytics_router, prefix=API_PREFIX)
app.include_router(ritual_router, prefix=API_PREFIX)


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "environment": settings.environment,
        "version": settings.app_version,
    }


@app.get("/api/system/status")
def system_status() -> dict:
    """
    Live health check for all system dependencies.
    Returns {status: ok|degraded, services: {name: {status, detail?, latency_ms?}}}
    """
    services: dict = {}

    # ── PostgreSQL ────────────────────────────────────────────────────────
    try:
        t0 = time.monotonic()
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        services["postgres"] = {"status": "ok", "latency_ms": round((time.monotonic() - t0) * 1000)}
    except Exception as exc:
        services["postgres"] = {"status": "error", "detail": str(exc)[:120]}

    # ── Redis ─────────────────────────────────────────────────────────────
    try:
        t0 = time.monotonic()
        r = redis_lib.from_url(str(settings.redis_url), socket_connect_timeout=2, decode_responses=True)
        r.ping()
        services["redis"] = {"status": "ok", "latency_ms": round((time.monotonic() - t0) * 1000)}
    except Exception as exc:
        services["redis"] = {"status": "error", "detail": str(exc)[:120]}

    # ── Celery worker ─────────────────────────────────────────────────────
    try:
        t0 = time.monotonic()
        insp = celery_app.control.inspect(timeout=2.0)
        active = insp.ping()
        if active:
            worker_names = list(active.keys())
            services["celery"] = {
                "status": "ok",
                "detail": f"{len(worker_names)} worker(s)",
                "latency_ms": round((time.monotonic() - t0) * 1000),
            }
        else:
            services["celery"] = {"status": "error", "detail": "no workers responding"}
    except Exception as exc:
        services["celery"] = {"status": "error", "detail": str(exc)[:120]}

    # ── Binance API ───────────────────────────────────────────────────────
    try:
        t0 = time.monotonic()
        resp = httpx.get("https://api.binance.com/api/v3/time", timeout=4.0)
        resp.raise_for_status()
        services["binance"] = {"status": "ok", "latency_ms": round((time.monotonic() - t0) * 1000)}
    except Exception as exc:
        services["binance"] = {"status": "error", "detail": str(exc)[:120]}

    # ── Kraken API ────────────────────────────────────────────────────────
    try:
        t0 = time.monotonic()
        resp = httpx.get("https://api.kraken.com/0/public/Time", timeout=4.0)
        resp.raise_for_status()
        data = resp.json()
        if data.get("error"):
            services["kraken"] = {"status": "error", "detail": str(data["error"])[:120]}
        else:
            services["kraken"] = {"status": "ok", "latency_ms": round((time.monotonic() - t0) * 1000)}
    except Exception as exc:
        services["kraken"] = {"status": "error", "detail": str(exc)[:120]}

    overall = "ok" if all(s["status"] == "ok" for s in services.values()) else "degraded"
    return {"status": overall, "version": settings.app_version, "services": services}
