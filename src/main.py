"""
AlphaTradingDesk — FastAPI application entry point
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.brokers.router import router as brokers_router
from src.core.config import settings
from src.goals.router import router as goals_router
from src.market_analysis.router import ma_router, profiles_ma_router
from src.profiles.router import router as profiles_router
from src.stats.router import router as stats_router
from src.trades.router import router as trades_router

app = FastAPI(
    title="AlphaTradingDesk",
    version="0.1.0",
    description="Multi-asset trading platform — risk management, trade journal, market analysis",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API routers ───────────────────────────────────────────────────
API_PREFIX = "/api"

app.include_router(brokers_router, prefix=API_PREFIX)
app.include_router(profiles_router, prefix=API_PREFIX)
app.include_router(goals_router, prefix=API_PREFIX)
app.include_router(trades_router, prefix=API_PREFIX)
app.include_router(ma_router, prefix=API_PREFIX)
app.include_router(profiles_ma_router, prefix=API_PREFIX)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "environment": settings.environment}
