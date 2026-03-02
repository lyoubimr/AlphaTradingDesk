"""
Broker router — read-only endpoints for reference data.

Routes:
  GET /api/brokers                      → list all active brokers
  GET /api/brokers/{broker_id}/instruments → list active instruments for a broker
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.brokers.schemas import BrokerOut, InstrumentOut
from src.core.deps import get_db
from src.core.models.broker import Broker, Instrument

router = APIRouter(prefix="/brokers", tags=["brokers"])


@router.get("", response_model=list[BrokerOut])
def list_brokers(db: Session = Depends(get_db)) -> list[Broker]:
    """Return all active brokers (predefined + any user-added custom brokers)."""
    return db.query(Broker).filter(Broker.status == "active").order_by(Broker.name).all()


@router.get("/{broker_id}/instruments", response_model=list[InstrumentOut])
def list_instruments(
    broker_id: int,
    db: Session = Depends(get_db),
) -> list[Instrument]:
    """
    Return all active instruments for a given broker.

    Used to populate the instrument dropdown in the trade form,
    filtered to the broker linked to the active profile.
    """
    broker = db.query(Broker).filter(Broker.id == broker_id).first()
    if not broker:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Broker {broker_id} not found.",
        )

    return (
        db.query(Instrument)
        .filter(Instrument.broker_id == broker_id, Instrument.is_active.is_(True))
        .order_by(Instrument.asset_class, Instrument.display_name)
        .all()
    )
