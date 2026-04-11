"""
One-shot patch: fix strategy trades_count/win_count for BE trades.

Context
-------
Before the BE filter formula fix (commit b68518a), trades closed at near-BE
were NOT filtered from WR stats.  The old formula used pnl/risk*100 compared
against a % threshold, making the filter essentially a no-op.

Trades #5 (ONDO) and #44 (PYTH) are confirmed BE trades (|pnl_r| < 0.20R).
They were already removed from profile-level counters via manual SQL.
This script corrects the linked strategy counters accordingly.

Logic
-----
For each trade in BE_TRADE_IDS:
  - Both trades were LOSSES (pnl_r < 0) → they only incremented trades_count
    on their linked strategies, NOT win_count.
  - Fix: trades_count -= 1 for each linked strategy (win_count unchanged).
  - Guard: trades_count never goes below 0.

Run: APP_ENV=prod python scripts/fix_strategy_be_stats.py
(or pipe through make psql if you prefer raw SQL)
"""

import os
import sys

os.environ.setdefault("APP_ENV", "prod")

from decimal import Decimal

from sqlalchemy.orm import Session

from src.core.database import get_session_factory
from src.core.models.trade import Strategy, Trade, TradeStrategy

# ── Config ────────────────────────────────────────────────────────────────────
BE_TRADE_IDS = [5, 44]   # ONDO #5, PYTH #44 — confirmed BE (|R| < 0.20)
DRY_RUN      = "--dry-run" in sys.argv


def main() -> None:
    db: Session = get_session_factory()()
    try:
        print(f"{'[DRY RUN] ' if DRY_RUN else ''}BE strategy stats fix\n")

        for trade_id in BE_TRADE_IDS:
            trade = db.query(Trade).filter(Trade.id == trade_id).first()
            if not trade:
                print(f"  Trade #{trade_id} NOT FOUND — skip")
                continue

            pnl_r = (
                (trade.realized_pnl or Decimal("0")) / trade.risk_amount
            ).quantize(Decimal("0.001")) if trade.risk_amount and trade.risk_amount > 0 else Decimal("0")

            print(f"  Trade #{trade_id} {trade.instrument_id}  pnl_r={pnl_r:+.3f}R  status={trade.status}")

            # Find linked strategies via junction table
            rows = (
                db.query(TradeStrategy.strategy_id)
                .filter(TradeStrategy.trade_id == trade_id)
                .all()
            )
            linked_ids = [r[0] for r in rows]

            if not linked_ids:
                print(f"    → no strategies linked, nothing to fix")
                continue

            strategies = (
                db.query(Strategy)
                .filter(Strategy.id.in_(linked_ids))
                .all()
            )

            for s in strategies:
                old_tc = s.trades_count
                old_wc = s.win_count
                new_tc = max(0, s.trades_count - 1)
                # Trade was a loss → win_count was NOT incremented → do not touch it
                print(f"    Strategy #{s.id} '{s.name}': "
                      f"trades_count {old_tc} → {new_tc}  win_count {old_wc} (unchanged)")
                if not DRY_RUN:
                    s.trades_count = new_tc

        if not DRY_RUN:
            db.commit()
            print("\n✅  Committed.")
        else:
            print("\n⚠️  Dry run — no changes written.  Re-run without --dry-run to apply.")

    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
