"""Diagnostic script — tests alembic env.py import chain step by step."""
import sys
import os

os.environ.setdefault("APP_ENV", "dev")
sys.path.insert(0, "/app")

print("1. importing models...")
from src.core.models import Base  # noqa: E402
print(f"2. models OK, tables: {len(Base.metadata.tables)}")

from src.core.config import settings  # noqa: E402
print(f"3. settings OK — DATABASE_URL: {settings.database_url[:30]}...")

from src.core.database import _normalise_db_url  # noqa: E402
url = _normalise_db_url(settings.database_url)
print(f"4. URL normalised: {url[:50]}")

from sqlalchemy import create_engine, text, pool  # noqa: E402
print("5. creating engine...")
engine = create_engine(url, poolclass=pool.NullPool)
print("6. engine created (no connection yet)")

print("7. connecting...")
with engine.connect() as conn:
    ver = conn.execute(text("SELECT * FROM alembic_version")).fetchone()
    print(f"8. alembic_version: {ver}")

print("9. ALL OK")
