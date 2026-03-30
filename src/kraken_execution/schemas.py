"""
src/kraken_execution/schemas.py

Phase 5 — Pydantic schemas for the Kraken Execution API.

Security rule: API keys (kraken_api_key_enc, kraken_api_secret_enc) MUST NEVER
appear in any output schema. Input schemas accept plaintext keys for write-only
operations; the service layer encrypts them immediately.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

# ── Automation Settings ───────────────────────────────────────────────────────

class AutomationConfigOut(BaseModel):
    """Safe view of automation config — never includes encrypted key fields."""

    enabled: bool = False
    pnl_status_interval_minutes: int = 60
    max_leverage_override: int | None = None


class AutomationSettingsOut(BaseModel):
    """Response schema for GET /settings/{profile_id}."""

    profile_id: int
    has_api_keys: bool = Field(
        description="True if Kraken API keys are configured for this profile."
    )
    config: AutomationConfigOut
    updated_at: datetime

    model_config = {"from_attributes": True}


class AutomationSettingsUpdateIn(BaseModel):
    """Request body for PUT /settings/{profile_id}.

    Send kraken_api_key + kraken_api_secret to store/update API keys.
    Omit them to update other settings without touching stored keys.
    All fields are optional — only provided fields are merged.
    """

    enabled: bool | None = None
    pnl_status_interval_minutes: int | None = Field(None, ge=1, le=1440)
    max_leverage_override: int | None = Field(None, ge=1, le=100)
    # Write-only — never returned in responses
    kraken_api_key: str | None = Field(None, description="Plaintext API key (write-only).")
    kraken_api_secret: str | None = Field(
        None, description="Plaintext API secret (write-only)."
    )


class ConnectionTestOut(BaseModel):
    """Response for POST /settings/{profile_id}/test-connection."""

    connected: bool
    demo: bool
    base_url: str
    error: str | None = None


# ── Kraken Orders ─────────────────────────────────────────────────────────────

class KrakenOrderOut(BaseModel):
    """Single Kraken order row — safe to expose publicly."""

    id: int
    trade_id: int
    kraken_order_id: str
    role: str
    status: str
    order_type: str
    symbol: str
    side: str
    size: float
    limit_price: float | None = None
    filled_price: float | None = None
    filled_size: float | None = None
    error_message: str | None = None
    sent_at: datetime
    filled_at: datetime | None = None
    cancelled_at: datetime | None = None

    model_config = {"from_attributes": True}
