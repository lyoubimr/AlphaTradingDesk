"""
Broker router — reference data endpoints.

Routes:
  GET    /api/brokers                          → list all active brokers
  GET    /api/brokers/{broker_id}/instruments  → list active instruments for a broker
  POST   /api/brokers/{broker_id}/instruments  → add a custom instrument
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.brokers.schemas import BrokerOut, InstrumentCreate, InstrumentOut
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


@router.post(
    "/{broker_id}/instruments",
    response_model=InstrumentOut,
    status_code=status.HTTP_201_CREATED,
)
def create_instrument(
    broker_id: int,
    data: InstrumentCreate,
    db: Session = Depends(get_db),
) -> Instrument:
    """
    Add a custom instrument to a broker's list.

    Use this when the pair you want to trade is not in the predefined list.
    The new instrument is created with is_predefined=False so it can be
    identified and optionally cleaned up separately.

    Required for CFD position-size accuracy: tick_value must be provided.
    """
    broker = db.query(Broker).filter(Broker.id == broker_id).first()
    if not broker:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Broker {broker_id} not found.",
        )

    # Enforce unique (broker_id, symbol)
    existing = (
        db.query(Instrument)
        .filter(Instrument.broker_id == broker_id, Instrument.symbol == data.symbol)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Instrument '{data.symbol}' already exists for broker {broker_id}.",
        )

    instrument = Instrument(
        broker_id=broker_id,
        symbol=data.symbol,
        display_name=data.display_name,
        asset_class=data.asset_class,
        base_currency=data.base_currency,
        quote_currency=data.quote_currency,
        pip_size=data.pip_size,
        tick_value=data.tick_value,
        min_lot=data.min_lot,
        max_leverage=data.max_leverage,
        is_predefined=False,
        is_active=True,
    )
    db.add(instrument)
    db.commit()
    db.refresh(instrument)
    return instrument
