"""
Seed: test profiles + strategies + trades + goals + market analysis sessions.

Creates TWO realistic profiles:
  1. "🧪 Crypto Trader (Test)"  — Kraken, swing/day_trading goals, Crypto MA sessions
  2. "🧪 CFD Trader (Test)"     — Vantage, swing goals, Gold MA sessions

Features covered:
  Trades   : open / partial+BE / closed-win / closed-loss / pending LIMIT
  Goals    : daily + weekly + monthly goals per style (active + inactive)
  MA       : 3 sessions per profile — fresh / stale / old — with all answers filled

Idempotent: cleans test profiles by name before re-inserting.
Safe to re-run at any time.

Usage:
    python -m database.migrations.seeds.seed_test_data
    # or via Makefile:
    make db-seed-test
"""
from __future__ import annotations

import logging
import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from src.core.database import get_session_factory
from src.core.models.broker import Broker, Instrument, Profile, TradingStyle
from src.core.models.goals import ProfileGoal
from src.core.models.market_analysis import (
    MarketAnalysisAnswer,
    MarketAnalysisIndicator,
    MarketAnalysisModule,
    MarketAnalysisSession,
)
from src.core.models.trade import Position, Strategy, Trade

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)-8s %(name)s — %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

SessionLocal = get_session_factory()

# ── Profile names — used to detect existing data and clean up ─────────────────
CRYPTO_PROFILE_NAME = "🧪 Crypto Trader (Test)"
CFD_PROFILE_NAME    = "🧪 CFD Trader (Test)"


def _clean_existing(session) -> None:
    """
    Remove ALL data that belongs to test profiles, but KEEP the profile rows
    themselves so their IDs stay stable across re-seeds.

    Deletes (in FK order):
      MA answers → MA sessions → goals → positions → trades → strategies
    The profile row is then reset to its initial values (capital, counters…).
    """
    for name in (CRYPTO_PROFILE_NAME, CFD_PROFILE_NAME):
        p = session.query(Profile).filter(Profile.name == name).first()
        if not p:
            continue
        pid = p.id

        # MA answers → MA sessions
        for ms in session.query(MarketAnalysisSession).filter(
            MarketAnalysisSession.profile_id == pid
        ).all():
            session.query(MarketAnalysisAnswer).filter(
                MarketAnalysisAnswer.session_id == ms.id
            ).delete()
            session.delete(ms)

        # Goals
        session.query(ProfileGoal).filter(ProfileGoal.profile_id == pid).delete()

        # Positions → Trades → Strategies
        for trade in session.query(Trade).filter(Trade.profile_id == pid).all():
            session.query(Position).filter(Position.trade_id == trade.id).delete()
            session.delete(trade)
        session.query(Strategy).filter(Strategy.profile_id == pid).delete()

        session.flush()
        logger.info("Cleaned data for test profile id=%d '%s' (profile row kept)", pid, name)


def _get_broker(session, name: str) -> Broker:
    b = session.query(Broker).filter(Broker.name == name).first()
    if not b:
        raise RuntimeError(f"Broker '{name}' not found — run make db-seed first.")
    return b


def _get_instrument(session, symbol: str) -> Instrument:
    i = session.query(Instrument).filter(Instrument.symbol == symbol).first()
    if not i:
        raise RuntimeError(f"Instrument '{symbol}' not found — run make db-seed first.")
    return i


def _get_style(session, name: str) -> TradingStyle:
    s = session.query(TradingStyle).filter(TradingStyle.name == name).first()
    if not s:
        raise RuntimeError(f"TradingStyle '{name}' not found — run make db-seed first.")
    return s


def _make_trade(
    profile_id: int,
    instrument_id: int | None,
    strategy_id: int | None,
    pair: str,
    direction: str,
    order_type: str,
    asset_class: str,
    entry_price: Decimal,
    stop_loss: Decimal,
    risk_amount: Decimal,
    potential_profit: Decimal,
    status: str,
    current_risk: Decimal,
    realized_pnl: Decimal | None,
    entry_date: datetime,
    closed_at: datetime | None,
    notes: str | None,
    confidence_score: int | None,
    session_tag: str | None,
    analyzed_timeframe: str | None,
) -> Trade:
    return Trade(
        profile_id=profile_id,
        instrument_id=instrument_id,
        strategy_id=strategy_id,
        pair=pair,
        direction=direction,
        order_type=order_type,
        asset_class=asset_class,
        analyzed_timeframe=analyzed_timeframe,
        entry_price=entry_price,
        entry_date=entry_date,
        stop_loss=stop_loss,
        nb_take_profits=1,          # updated per trade below
        risk_amount=risk_amount,
        potential_profit=potential_profit,
        status=status,
        current_risk=current_risk,
        realized_pnl=realized_pnl,
        session_tag=session_tag,
        notes=notes,
        confidence_score=confidence_score,
        closed_at=closed_at,
    )


def seed_crypto_profile(session) -> Profile:
    """Create or update Kraken / Crypto test profile with realistic trades."""
    broker   = _get_broker(session, "Kraken")
    btc_inst = _get_instrument(session, "PF_XBTUSD")
    eth_inst = _get_instrument(session, "PF_ETHUSD")
    sol_inst = _get_instrument(session, "PF_SOLUSD")

    # Upsert — keep existing row to preserve stable ID
    profile = session.query(Profile).filter(Profile.name == CRYPTO_PROFILE_NAME).first()
    if profile:
        profile.broker_id               = broker.id
        profile.market_type             = "Crypto"
        profile.capital_start           = Decimal("10000.00")
        profile.capital_current         = Decimal("10480.00")
        profile.currency                = "USD"
        profile.risk_percentage_default = Decimal("1.00")
        profile.max_concurrent_risk_pct = Decimal("4.00")
        profile.trades_count            = 3
        profile.win_count               = 2
    else:
        profile = Profile(
            name=CRYPTO_PROFILE_NAME,
            broker_id=broker.id,
            market_type="Crypto",
            capital_start=Decimal("10000.00"),
            capital_current=Decimal("10480.00"),
            currency="USD",
            risk_percentage_default=Decimal("1.00"),
            max_concurrent_risk_pct=Decimal("4.00"),
            trades_count=3,
            win_count=2,
        )
        session.add(profile)
    session.flush()

    # Strategies
    strat_trend = Strategy(
        profile_id=profile.id,
        name="BTC Trend Follow",
        description="Follow higher timeframe trend with tight stops",
        trades_count=2,
        win_count=1,
    )
    strat_range = Strategy(
        profile_id=profile.id,
        name="ETH Range Fade",
        description="Fade extremes of weekly range",
        trades_count=1,
        win_count=1,
    )
    session.add_all([strat_trend, strat_range])
    session.flush()

    now = datetime.utcnow()

    # ── Trade 1: OPEN MARKET — BTC Long, 2 TPs (1% risk) ──────────────────────
    t1 = Trade(
        profile_id=profile.id,
        instrument_id=btc_inst.id,
        strategy_id=strat_trend.id,
        pair="PF_XBTUSD",
        direction="long",
        order_type="MARKET",
        asset_class="Crypto",
        analyzed_timeframe="4h",
        entry_price=Decimal("86500.00"),
        entry_date=now - timedelta(hours=5),
        stop_loss=Decimal("85200.00"),
        nb_take_profits=2,
        risk_amount=Decimal("100.00"),
        potential_profit=Decimal("310.00"),
        status="open",
        current_risk=Decimal("100.00"),
        realized_pnl=None,
        session_tag="London",
        notes="Clean break above 86k resistance. Structure is bullish on 4H.",
        confidence_score=75,
        closed_at=None,
    )
    session.add(t1)
    session.flush()
    session.add_all([
        Position(trade_id=t1.id, position_number=1, take_profit_price=Decimal("88000.00"), lot_percentage=Decimal("60"), status="open"),
        Position(trade_id=t1.id, position_number=2, take_profit_price=Decimal("90000.00"), lot_percentage=Decimal("40"), status="open"),
    ])

    # ── Trade 2: PARTIAL — ETH Long, TP1 hit + BE moved ───────────────────────
    # This is the trade that tests the BE bug fix:
    # current_risk must be 0, not the original risk_amount
    t2 = Trade(
        profile_id=profile.id,
        instrument_id=eth_inst.id,
        strategy_id=strat_range.id,
        pair="PF_ETHUSD",
        direction="long",
        order_type="MARKET",
        asset_class="Crypto",
        analyzed_timeframe="1d",
        entry_price=Decimal("2200.00"),
        entry_date=now - timedelta(days=2),
        stop_loss=Decimal("2200.00"),   # ← SL at entry = BE already moved
        nb_take_profits=3,
        risk_amount=Decimal("100.00"),
        potential_profit=Decimal("250.00"),
        status="partial",
        current_risk=Decimal("0.00"),   # ← 0 because BE is set
        realized_pnl=None,
        session_tag="New York",
        notes="TP1 hit at 2350. Moved SL to BE. Letting runners go to TP2/TP3.",
        confidence_score=80,
        closed_at=None,
    )
    session.add(t2)
    session.flush()
    session.add_all([
        Position(trade_id=t2.id, position_number=1, take_profit_price=Decimal("2350.00"), lot_percentage=Decimal("40"), status="closed",
                 exit_price=Decimal("2350.00"), exit_date=now - timedelta(days=1),
                 realized_pnl=Decimal("60.00")),
        Position(trade_id=t2.id, position_number=2, take_profit_price=Decimal("2480.00"), lot_percentage=Decimal("35"), status="open"),
        Position(trade_id=t2.id, position_number=3, take_profit_price=Decimal("2600.00"), lot_percentage=Decimal("25"), status="open"),
    ])

    # ── Trade 3: CLOSED WIN — SOL Long ────────────────────────────────────────
    t3 = Trade(
        profile_id=profile.id,
        instrument_id=sol_inst.id,
        strategy_id=strat_trend.id,
        pair="PF_SOLUSD",
        direction="long",
        order_type="MARKET",
        asset_class="Crypto",
        analyzed_timeframe="4h",
        entry_price=Decimal("145.00"),
        entry_date=now - timedelta(days=5),
        stop_loss=Decimal("138.00"),
        nb_take_profits=1,
        risk_amount=Decimal("100.00"),
        potential_profit=Decimal("200.00"),
        status="closed",
        current_risk=Decimal("0.00"),
        realized_pnl=Decimal("205.00"),
        session_tag="London",
        notes="Perfect breakout trade. Held to full TP.",
        confidence_score=85,
        closed_at=now - timedelta(days=3),
    )
    session.add(t3)
    session.flush()
    session.add(Position(trade_id=t3.id, position_number=1, take_profit_price=Decimal("159.00"),
                         lot_percentage=Decimal("100"), status="closed",
                         exit_price=Decimal("159.05"), exit_date=now - timedelta(days=3),
                         realized_pnl=Decimal("205.00")))

    # ── Trade 4: CLOSED LOSS — BTC Short ──────────────────────────────────────
    t4 = Trade(
        profile_id=profile.id,
        instrument_id=btc_inst.id,
        strategy_id=strat_trend.id,
        pair="PF_XBTUSD",
        direction="short",
        order_type="MARKET",
        asset_class="Crypto",
        analyzed_timeframe="4h",
        entry_price=Decimal("89000.00"),
        entry_date=now - timedelta(days=8),
        stop_loss=Decimal("90200.00"),
        nb_take_profits=1,
        risk_amount=Decimal("100.00"),
        potential_profit=Decimal("180.00"),
        status="closed",
        current_risk=Decimal("0.00"),
        realized_pnl=Decimal("-100.00"),
        session_tag="New York",
        notes="Fakeout above resistance. Got stopped out. Structure remains ambiguous.",
        confidence_score=55,
        closed_at=now - timedelta(days=7),
    )
    session.add(t4)
    session.flush()
    session.add(Position(trade_id=t4.id, position_number=1, take_profit_price=Decimal("87300.00"),
                         lot_percentage=Decimal("100"), status="closed",
                         exit_price=Decimal("90200.00"), exit_date=now - timedelta(days=7),
                         realized_pnl=Decimal("-100.00")))

    # ── Trade 5: CLOSED WIN — ETH Short ───────────────────────────────────────
    t5 = Trade(
        profile_id=profile.id,
        instrument_id=eth_inst.id,
        strategy_id=strat_range.id,
        pair="PF_ETHUSD",
        direction="short",
        order_type="MARKET",
        asset_class="Crypto",
        analyzed_timeframe="1d",
        entry_price=Decimal("2500.00"),
        entry_date=now - timedelta(days=12),
        stop_loss=Decimal("2580.00"),
        nb_take_profits=1,
        risk_amount=Decimal("100.00"),
        potential_profit=Decimal("175.00"),
        status="closed",
        current_risk=Decimal("0.00"),
        realized_pnl=Decimal("175.00"),
        session_tag="New York",
        notes="Weekly resistance rejection. Clean R:R 1.75.",
        confidence_score=78,
        closed_at=now - timedelta(days=10),
    )
    session.add(t5)
    session.flush()
    session.add(Position(trade_id=t5.id, position_number=1, take_profit_price=Decimal("2360.00"),
                         lot_percentage=Decimal("100"), status="closed",
                         exit_price=Decimal("2360.00"), exit_date=now - timedelta(days=10),
                         realized_pnl=Decimal("175.00")))

    # ── Trade 6: PENDING LIMIT — BTC Long ─────────────────────────────────────
    t6 = Trade(
        profile_id=profile.id,
        instrument_id=btc_inst.id,
        strategy_id=strat_trend.id,
        pair="PF_XBTUSD",
        direction="long",
        order_type="LIMIT",
        asset_class="Crypto",
        analyzed_timeframe="4h",
        entry_price=Decimal("84000.00"),
        entry_date=now - timedelta(hours=1),
        stop_loss=Decimal("82500.00"),
        nb_take_profits=1,
        risk_amount=Decimal("100.00"),
        potential_profit=Decimal("200.00"),
        status="pending",
        current_risk=Decimal("0.00"),    # LIMIT orders don't reserve risk yet
        realized_pnl=None,
        session_tag="London",
        notes="Waiting for retest of 84k support level before entering.",
        confidence_score=70,
        closed_at=None,
    )
    session.add(t6)
    session.flush()
    session.add(Position(trade_id=t6.id, position_number=1, take_profit_price=Decimal("87000.00"),
                         lot_percentage=Decimal("100"), status="open"))

    session.flush()
    logger.info("Crypto profile seeded: %s (id=%d) — 6 trades", profile.name, profile.id)
    return profile


def seed_cfd_profile(session) -> Profile:
    """Create or update Vantage / CFD test profile with realistic trades."""
    broker   = _get_broker(session, "Vantage")
    xau_inst = _get_instrument(session, "XAUUSD")
    eur_inst = _get_instrument(session, "EURUSD")

    # Upsert — keep existing row to preserve stable ID
    profile = session.query(Profile).filter(Profile.name == CFD_PROFILE_NAME).first()
    if profile:
        profile.broker_id               = broker.id
        profile.market_type             = "CFD"
        profile.capital_start           = Decimal("5000.00")
        profile.capital_current         = Decimal("5230.00")
        profile.currency                = "EUR"
        profile.risk_percentage_default = Decimal("1.00")
        profile.max_concurrent_risk_pct = Decimal("4.00")
        profile.trades_count            = 3
        profile.win_count               = 2
    else:
        profile = Profile(
            name=CFD_PROFILE_NAME,
            broker_id=broker.id,
            market_type="CFD",
            capital_start=Decimal("5000.00"),
            capital_current=Decimal("5230.00"),
            currency="EUR",
            risk_percentage_default=Decimal("1.00"),
            max_concurrent_risk_pct=Decimal("4.00"),
            trades_count=3,
            win_count=2,
        )
        session.add(profile)
    session.flush()

    strat_gold = Strategy(
        profile_id=profile.id,
        name="Gold H1 Structure",
        description="Trade H1 market structure breaks on XAUUSD",
        trades_count=2,
        win_count=1,
    )
    strat_fx = Strategy(
        profile_id=profile.id,
        name="EUR/USD London Breakout",
        description="Fade/follow London open breakouts on EURUSD",
        trades_count=1,
        win_count=1,
    )
    session.add_all([strat_gold, strat_fx])
    session.flush()

    now = datetime.utcnow()

    # ── Trade 1: OPEN — Gold Long, 2 TPs ──────────────────────────────────────
    t1 = Trade(
        profile_id=profile.id,
        instrument_id=xau_inst.id,
        strategy_id=strat_gold.id,
        pair="XAUUSD",
        direction="long",
        order_type="MARKET",
        asset_class="Commodities",
        analyzed_timeframe="1h",
        entry_price=Decimal("2650.00"),
        entry_date=now - timedelta(hours=3),
        stop_loss=Decimal("2638.00"),
        nb_take_profits=2,
        risk_amount=Decimal("50.00"),
        potential_profit=Decimal("120.00"),
        status="open",
        current_risk=Decimal("50.00"),
        realized_pnl=None,
        session_tag="London",
        notes="Break of Asian range high. London continuation setup.",
        confidence_score=72,
        closed_at=None,
    )
    session.add(t1)
    session.flush()
    session.add_all([
        Position(trade_id=t1.id, position_number=1, take_profit_price=Decimal("2662.00"), lot_percentage=Decimal("50"), status="open"),
        Position(trade_id=t1.id, position_number=2, take_profit_price=Decimal("2678.00"), lot_percentage=Decimal("50"), status="open"),
    ])

    # ── Trade 2: PARTIAL — EUR/USD Short, TP1 hit + BE ────────────────────────
    t2 = Trade(
        profile_id=profile.id,
        instrument_id=eur_inst.id,
        strategy_id=strat_fx.id,
        pair="EURUSD",
        direction="short",
        order_type="MARKET",
        asset_class="Forex",
        analyzed_timeframe="15m",
        entry_price=Decimal("1.08500"),
        entry_date=now - timedelta(days=1),
        stop_loss=Decimal("1.08500"),   # SL at entry = BE
        nb_take_profits=2,
        risk_amount=Decimal("50.00"),
        potential_profit=Decimal("100.00"),
        status="partial",
        current_risk=Decimal("0.00"),   # BE moved
        realized_pnl=None,
        session_tag="London",
        notes="TP1 at 1.0820 hit. Runner targeting London low at 1.0800.",
        confidence_score=65,
        closed_at=None,
    )
    session.add(t2)
    session.flush()
    session.add_all([
        Position(trade_id=t2.id, position_number=1, take_profit_price=Decimal("1.08200"), lot_percentage=Decimal("60"), status="closed",
                 exit_price=Decimal("1.08200"), exit_date=now - timedelta(hours=20),
                 realized_pnl=Decimal("36.00")),
        Position(trade_id=t2.id, position_number=2, take_profit_price=Decimal("1.08000"), lot_percentage=Decimal("40"), status="open"),
    ])

    # ── Trade 3: CLOSED WIN — Gold Long ───────────────────────────────────────
    t3 = Trade(
        profile_id=profile.id,
        instrument_id=xau_inst.id,
        strategy_id=strat_gold.id,
        pair="XAUUSD",
        direction="long",
        order_type="MARKET",
        asset_class="Commodities",
        analyzed_timeframe="1h",
        entry_price=Decimal("2610.00"),
        entry_date=now - timedelta(days=4),
        stop_loss=Decimal("2598.00"),
        nb_take_profits=1,
        risk_amount=Decimal("50.00"),
        potential_profit=Decimal("100.00"),
        status="closed",
        current_risk=Decimal("0.00"),
        realized_pnl=Decimal("102.00"),
        session_tag="New York",
        notes="Clean 2R trade. Gold reclaimed 2610 after CPI data.",
        confidence_score=80,
        closed_at=now - timedelta(days=3),
    )
    session.add(t3)
    session.flush()
    session.add(Position(trade_id=t3.id, position_number=1, take_profit_price=Decimal("2630.00"),
                         lot_percentage=Decimal("100"), status="closed",
                         exit_price=Decimal("2630.40"), exit_date=now - timedelta(days=3),
                         realized_pnl=Decimal("102.00")))

    # ── Trade 4: CLOSED LOSS — EUR/USD Long ───────────────────────────────────
    t4 = Trade(
        profile_id=profile.id,
        instrument_id=eur_inst.id,
        strategy_id=strat_fx.id,
        pair="EURUSD",
        direction="long",
        order_type="MARKET",
        asset_class="Forex",
        analyzed_timeframe="15m",
        entry_price=Decimal("1.09200"),
        entry_date=now - timedelta(days=6),
        stop_loss=Decimal("1.09000"),
        nb_take_profits=1,
        risk_amount=Decimal("50.00"),
        potential_profit=Decimal("80.00"),
        status="closed",
        current_risk=Decimal("0.00"),
        realized_pnl=Decimal("-50.00"),
        session_tag="New York",
        notes="Stopped out by news spike. Avoided afterward.",
        confidence_score=50,
        closed_at=now - timedelta(days=6) + timedelta(hours=2),
    )
    session.add(t4)
    session.flush()
    session.add(Position(trade_id=t4.id, position_number=1, take_profit_price=Decimal("1.09600"),
                         lot_percentage=Decimal("100"), status="closed",
                         exit_price=Decimal("1.09000"), exit_date=now - timedelta(days=6) + timedelta(hours=2),
                         realized_pnl=Decimal("-50.00")))

    # ── Trade 5: CLOSED WIN — Gold Short ──────────────────────────────────────
    t5 = Trade(
        profile_id=profile.id,
        instrument_id=xau_inst.id,
        strategy_id=strat_gold.id,
        pair="XAUUSD",
        direction="short",
        order_type="MARKET",
        asset_class="Commodities",
        analyzed_timeframe="1h",
        entry_price=Decimal("2695.00"),
        entry_date=now - timedelta(days=9),
        stop_loss=Decimal("2706.00"),
        nb_take_profits=1,
        risk_amount=Decimal("50.00"),
        potential_profit=Decimal("125.00"),
        status="closed",
        current_risk=Decimal("0.00"),
        realized_pnl=Decimal("128.00"),
        session_tag="London",
        notes="Rejection from HTF resistance at 2700. Clean R:R 2.56.",
        confidence_score=82,
        closed_at=now - timedelta(days=8),
    )
    session.add(t5)
    session.flush()
    session.add(Position(trade_id=t5.id, position_number=1, take_profit_price=Decimal("2670.00"),
                         lot_percentage=Decimal("100"), status="closed",
                         exit_price=Decimal("2669.75"), exit_date=now - timedelta(days=8),
                         realized_pnl=Decimal("128.00")))

    session.flush()
    logger.info("CFD profile seeded: %s (id=%d) — 5 trades", profile.name, profile.id)
    return profile


# ── Goals ─────────────────────────────────────────────────────────────────────

def seed_goals(session, profile: Profile, style_names: list[str]) -> None:
    """
    Insert goals for a profile covering all combinations:
      - daily / weekly / monthly periods
      - multiple trading styles
      - mix of active / inactive

    Exercises: goal_progress_pct, risk_progress_pct, goal_hit, limit_hit.
    """
    goals: list[tuple] = []
    # (style_name, period, goal_pct, limit_pct, is_active)
    for style_name in style_names:
        style = session.query(TradingStyle).filter(TradingStyle.name == style_name).first()
        if not style:
            continue
        goals += [
            (style.id, "daily",   Decimal("0.50"),  Decimal("-0.30"), True),
            (style.id, "weekly",  Decimal("2.00"),  Decimal("-1.00"), True),
            (style.id, "monthly", Decimal("6.00"),  Decimal("-3.00"), True),
        ]

    # Add one inactive goal using a style NOT in the list, to avoid unique conflicts
    # This tests the inactive-goal filter in the UI
    if len(style_names) > 0:
        extra_style = session.query(TradingStyle).filter(
            TradingStyle.name.notin_(style_names)
        ).first()
        if extra_style:
            goals.append((extra_style.id, "monthly", Decimal("10.00"), Decimal("-5.00"), False))

    for style_id, period, goal_pct, limit_pct, is_active in goals:
        session.add(ProfileGoal(
            profile_id=profile.id,
            style_id=style_id,
            period=period,
            goal_pct=goal_pct,
            limit_pct=limit_pct,
            is_active=is_active,
        ))

    session.flush()
    logger.info("Goals seeded for profile %s — %d goals", profile.name, len(goals))


# ── Market Analysis sessions ───────────────────────────────────────────────────

def _make_session(
    session,
    profile_id: int,
    module: MarketAnalysisModule,
    indicators: list[MarketAnalysisIndicator],
    analyzed_at: datetime,
    scores: dict[str, int],   # indicator.key → score (+1 bull / -1 bear / 0 neutral)
    notes: str | None = None,
) -> MarketAnalysisSession:
    """
    Insert one MarketAnalysisSession + all answers.

    scores dict maps indicator key → integer score:
      +1 = bullish answer, 0 = neutral/partial, -1 = bearish
    Missing keys default to 0 (neutral).
    """
    # Compute per-timeframe scores from answers
    htf_inds = [i for i in indicators if i.timeframe_level == "htf"]
    mtf_inds = [i for i in indicators if i.timeframe_level == "mtf"]
    ltf_inds = [i for i in indicators if i.timeframe_level == "ltf"]

    def _avg(inds: list) -> Decimal | None:
        if not inds:
            return None
        total = sum(scores.get(i.key, 0) for i in inds)
        return Decimal(str(round(total / len(inds), 2)))

    htf_score = _avg(htf_inds)
    mtf_score = _avg(mtf_inds)
    ltf_score = _avg(ltf_inds) if ltf_inds else None

    bias_map = {1: "bullish", -1: "bearish", 0: "neutral"}

    def _bias(score: Decimal | None) -> str | None:
        if score is None:
            return None
        return "bullish" if score > 0 else ("bearish" if score < 0 else "neutral")

    ms = MarketAnalysisSession(
        profile_id=profile_id,
        module_id=module.id,
        score_htf_a=htf_score,
        score_mtf_a=mtf_score,
        score_ltf_a=ltf_score,
        bias_htf_a=_bias(htf_score),
        bias_mtf_a=_bias(mtf_score),
        bias_ltf_a=_bias(ltf_score),
        notes=notes,
        analyzed_at=analyzed_at,
        created_at=analyzed_at,
    )
    session.add(ms)
    session.flush()

    for ind in indicators:
        sc = scores.get(ind.key, 0)
        if sc > 0:
            answer_label = ind.answer_bullish
        elif sc < 0:
            answer_label = ind.answer_bearish
        else:
            answer_label = ind.answer_partial
        session.add(MarketAnalysisAnswer(
            session_id=ms.id,
            indicator_id=ind.id,
            score=sc,
            answer_label=answer_label,
        ))

    session.flush()
    return ms


def seed_market_analysis(session, profile: Profile, module_name: str) -> None:
    """
    Insert 3 MA sessions for a profile:
      1. Fresh  — analyzed today         → score strongly bullish
      2. Stale  — analyzed 2 days ago    → score mixed/neutral
      3. Old    — analyzed 8 days ago    → score bearish

    Covers: fresh badge, stale badge, history list, score ring display.
    """
    module = session.query(MarketAnalysisModule).filter(
        MarketAnalysisModule.name == module_name
    ).first()
    if not module:
        raise RuntimeError(f"MA module '{module_name}' not found — run make db-seed first.")

    indicators = (
        session.query(MarketAnalysisIndicator)
        .filter(MarketAnalysisIndicator.module_id == module.id)
        .order_by(MarketAnalysisIndicator.sort_order)
        .all()
    )
    keys = [i.key for i in indicators]

    now = datetime.now(tz=timezone.utc)

    # ── Session 1: Fresh — strong bull ────────────────────────────────────────
    _make_session(
        session, profile.id, module, indicators,
        analyzed_at=now - timedelta(hours=2),
        scores={k: 1 for k in keys},   # all bullish
        notes="Structure bullish across all timeframes. Clear trend continuation.",
    )

    # ── Session 2: Stale — mixed ──────────────────────────────────────────────
    mixed = {k: (1 if i % 2 == 0 else -1) for i, k in enumerate(keys)}
    _make_session(
        session, profile.id, module, indicators,
        analyzed_at=now - timedelta(days=2, hours=4),
        scores=mixed,
        notes="Mixed signals. HTF bullish but MTF shows distribution. Wait for confirmation.",
    )

    # ── Session 3: Old — bear ─────────────────────────────────────────────────
    _make_session(
        session, profile.id, module, indicators,
        analyzed_at=now - timedelta(days=8),
        scores={k: -1 for k in keys},   # all bearish
        notes="Bearish breakdown. Avoid longs until structure repairs.",
    )

    session.flush()
    logger.info(
        "MA sessions seeded for profile %s — module '%s' — 3 sessions",
        profile.name, module_name,
    )


# ── Orchestrator ──────────────────────────────────────────────────────────────

def run_test_seed() -> None:
    logger.info("=== Starting test data seed ===")
    with SessionLocal() as session:
        try:
            _clean_existing(session)

            # ── Crypto profile ──────────────────────────────────────────────
            crypto_profile = seed_crypto_profile(session)
            seed_goals(session, crypto_profile, ["swing", "day_trading"])
            seed_market_analysis(session, crypto_profile, "Crypto")

            # ── CFD profile ─────────────────────────────────────────────────
            cfd_profile = seed_cfd_profile(session)
            seed_goals(session, cfd_profile, ["swing"])
            seed_market_analysis(session, cfd_profile, "Gold")

            session.commit()
            logger.info(
                "=== Test data seed complete — crypto id=%d, cfd id=%d ===",
                crypto_profile.id, cfd_profile.id,
            )
        except Exception:
            session.rollback()
            logger.exception("Test data seed FAILED — rolled back.")
            raise


if __name__ == "__main__":
    run_test_seed()
