"""Temporary debug script — not a real test."""
import os

os.environ["APP_ENV"] = "test"

from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from src.core.config import settings
from src.core.database import Base, _normalise_db_url
from src.core.deps import get_db
from src.core.models.broker import Profile
from src.main import app

engine = create_engine(_normalise_db_url(settings.database_url), pool_pre_ping=True)
Base.metadata.create_all(bind=engine)

connection = engine.connect()
transaction = connection.begin()
session = Session(bind=connection, join_transaction_mode="create_savepoint")

p = Profile(
    name="test",
    market_type="Crypto",
    capital_start=Decimal("10000"),
    capital_current=Decimal("10000"),
    risk_percentage_default=Decimal("2.0"),
    max_concurrent_risk_pct=Decimal("2.0"),
    status="active",
)
session.add(p)
session.flush()
print(f"Profile ID after flush: {p.id}")

found = session.query(Profile).filter(Profile.id == p.id).first()
print(f"Direct query (same session): {found}")


def override_get_db():
    yield session


app.dependency_overrides[get_db] = override_get_db
with TestClient(app) as c:
    url = "/api/profiles/" + str(p.id) + "/ritual/settings"
    print(f"Calling: GET {url}")
    resp = c.get(url)
    print("Status:", resp.status_code)
    print("Body:", resp.text)
app.dependency_overrides.clear()

session.close()
transaction.rollback()
connection.close()
engine.dispose()
print("Done.")
