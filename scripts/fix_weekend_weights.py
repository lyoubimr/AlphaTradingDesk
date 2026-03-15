"""
Fix existing volatility_settings rows: update market_vi.tf_weights.weekend
to the new default (75% 15m / 25% 1h) in all rows that still carry the old values.

Usage:
    APP_ENV=dev python scripts/fix_weekend_weights.py
    APP_ENV=prod python scripts/fix_weekend_weights.py  # on Dell
"""
from __future__ import annotations

import logging
import sys

from src.core.database import get_session_factory
from src.volatility.models import VolatilitySettings

logging.basicConfig(level=logging.INFO, format="%(levelname)-8s %(message)s", stream=sys.stdout)
log = logging.getLogger(__name__)

NEW_WEEKEND = {"15m": 0.75, "1h": 0.25, "4h": 0.00, "1d": 0.00}

db = get_session_factory()()
try:
    rows = db.query(VolatilitySettings).all()
    if not rows:
        log.info("No volatility_settings rows found — nothing to do")
        sys.exit(0)

    updated = 0
    for row in rows:
        cfg: dict = dict(row.market_vi or {})
        tf_weights: dict = cfg.get("tf_weights", {})
        current_weekend: dict = tf_weights.get("weekend", {})

        if current_weekend == NEW_WEEKEND:
            log.info("profile_id=%s — already up to date, skip", row.profile_id)
            continue

        log.info(
            "profile_id=%s — updating weekend weights: %s → %s",
            row.profile_id, current_weekend, NEW_WEEKEND,
        )
        # Deep-copy to trigger JSONB change detection in SQLAlchemy
        new_cfg = dict(cfg)
        new_tf_weights = dict(tf_weights)
        new_tf_weights["weekend"] = NEW_WEEKEND
        new_cfg["tf_weights"] = new_tf_weights
        row.market_vi = new_cfg
        updated += 1

    if updated:
        db.commit()
        log.info("✅  %d row(s) updated and committed", updated)
    else:
        log.info("Nothing to update")

except Exception as exc:
    db.rollback()
    log.error("❌  Error: %s", exc)
    raise
finally:
    db.close()
