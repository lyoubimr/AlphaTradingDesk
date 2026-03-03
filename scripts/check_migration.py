"""Quick script to verify migration state and schema."""
import os
os.environ.setdefault("APP_ENV", "dev")

from src.core.database import get_engine  # noqa: E402
from sqlalchemy import text

engine = get_engine()

with engine.connect() as conn:
    ver = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    print(f"Migration HEAD: {ver}")

    col = conn.execute(text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name='trades' AND column_name='order_type'"
    )).fetchone()
    print(f"order_type column: {'EXISTS ✓' if col else 'MISSING ✗'}")

    chk = conn.execute(text(
        "SELECT constraint_name FROM information_schema.check_constraints "
        "WHERE constraint_name IN ('ck_trades_status', 'ck_trades_order_type')"
    )).fetchall()
    print(f"CHECK constraints: {[r[0] for r in chk]}")
