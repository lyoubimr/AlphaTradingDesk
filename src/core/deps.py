"""
FastAPI dependencies — shared across all routers.
"""
from __future__ import annotations

from collections.abc import Generator

from sqlalchemy.orm import Session

from src.core.database import get_session_factory


def get_db() -> Generator[Session, None, None]:
    """
    Yield a SQLAlchemy session, ensuring it is closed after the request.

    Usage in a route:
        def my_route(db: Session = Depends(get_db)): ...
    """
    db = get_session_factory()()
    try:
        yield db
    finally:
        db.close()
