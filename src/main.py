"""
AlphaTradingDesk — FastAPI application entry point
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from src.brokers.router import router as brokers_router
from src.brokers.router import styles_router
from src.core.config import settings
from src.core.logging_config import setup_logging
from src.goals.router import router as goals_router
from src.market_analysis.router import ma_router, profiles_ma_router
from src.profiles.router import router as profiles_router
from src.stats.router import router as stats_router
from src.strategies.router import router as strategies_router
from src.trades.router import router as trades_router

app = FastAPI(
    title="AlphaTradingDesk",
    version="0.1.0",
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


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "environment": settings.environment}
