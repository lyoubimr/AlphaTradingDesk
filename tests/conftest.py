"""
Pytest fixtures shared across all tests.

Strategy: use the real Postgres dialect (atd_test DB) to avoid SQLite
incompatibilities (ARRAY, JSONB, etc.).  Each test runs inside a savepoint
that is rolled back at the end, so tests are isolated without needing to
truncate tables.

Requires: docker compose -f docker-compose.dev.yml up -d db
          APP_ENV=test (loads .env.test → DATABASE_URL points to atd_test)
"""
from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from src.core.database import Base, _normalise_db_url
from src.core.config import settings
from src.core.deps import get_db
from src.main import app

# ── Engine pointed at the test DB ────────────────────────────────────────────
_test_engine = create_engine(
    _normalise_db_url(settings.database_url),
    pool_pre_ping=True,
)
_TestingSessionLocal = sessionmaker(bind=_test_engine, autocommit=False, autoflush=False)


@pytest.fixture(scope="session", autouse=True)
def create_tables():
    """Create all tables once per test session, drop them at the end."""
    Base.metadata.create_all(bind=_test_engine)
    yield
    Base.metadata.drop_all(bind=_test_engine)


@pytest.fixture()
def db_session(create_tables) -> Generator[Session, None, None]:  # noqa: ANN001
    """
    Yield a DB session wrapped in a SAVEPOINT.
    After each test the savepoint is rolled back → full isolation, no truncation.
    """
    connection = _test_engine.connect()
    transaction = connection.begin()
    session = _TestingSessionLocal(bind=connection)

    # Nested savepoint so each test is isolated
    connection.execute(text("SAVEPOINT test_sp"))

    try:
        yield session
    finally:
        session.close()
        connection.execute(text("ROLLBACK TO SAVEPOINT test_sp"))
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
