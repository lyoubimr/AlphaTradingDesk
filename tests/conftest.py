"""
Pytest fixtures shared across all tests.

Strategy: use the real Postgres dialect (atd_test DB) to avoid SQLite
incompatibilities (ARRAY, JSONB, etc.).  Each test runs inside a nested
transaction (SQLAlchemy begin_nested → SAVEPOINT) that is rolled back at the
end, so tests are fully isolated without truncating tables.

The key insight: service code calls db.commit().  In the test fixture the
session is joined to an outer connection-level transaction.  We use
Session(join_transaction_mode="create_savepoint") so that every db.commit()
inside the service merely releases-and-recreates the inner savepoint rather
than committing to the database.  The outer transaction is always rolled back
after the test.

Requires: docker compose -f docker-compose.dev.yml up -d db
          APP_ENV=test (loads .env.test → DATABASE_URL points to atd_test)
"""

from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from src.core.config import settings
from src.core.database import Base, _normalise_db_url
from src.core.deps import get_db
from src.main import app

# ── Engine pointed at the test DB ────────────────────────────────────────────
_test_engine = create_engine(
    _normalise_db_url(settings.database_url),
    pool_pre_ping=True,
)


@pytest.fixture(scope="session", autouse=True)
def create_tables():
    """Create all tables once per test session, drop them at the end."""
    Base.metadata.create_all(bind=_test_engine)
    yield
    Base.metadata.drop_all(bind=_test_engine)


@pytest.fixture()
def db_session(create_tables) -> Generator[Session, None, None]:  # noqa: ANN001
    """
    Yield a DB session joined to an outer transaction.

    join_transaction_mode="create_savepoint" means every Session.commit()
    issued by the service layer only commits the inner savepoint — the outer
    connection-level transaction is never committed and is rolled back here
    after each test, giving complete isolation.
    """
    connection = _test_engine.connect()
    transaction = connection.begin()

    session = Session(
        bind=connection,
        join_transaction_mode="create_savepoint",
    )

    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture()
def client(db_session: Session) -> Generator[TestClient, None, None]:
    """
    Return a FastAPI TestClient with `get_db` overridden to use the
    per-test transactional session.
    """

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
