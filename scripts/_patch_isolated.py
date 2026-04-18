"""One-shot patch: rewrite service.py pre-flight to use isolated margin via leveragepreferences."""
import re, sys
from pathlib import Path

svc = Path("src/kraken_execution/service.py")
content = svc.read_text(encoding="utf-8")

# Locate the block from "# Kraken Portfolio Margin" to "max_leverage=int(trade.leverage or 10),"
START = "        # Kraken Portfolio Margin (PF_) check:"
END_MARKER = "            max_leverage=int(trade.leverage or 10),\n        )"

start_idx = content.find(START)
end_idx = content.find(END_MARKER)
if start_idx == -1 or end_idx == -1:
    print(f"FAIL: start={start_idx}, end={end_idx}")
    sys.exit(1)

end_idx += len(END_MARKER)
old_block = content[start_idx:end_idx]

NEW_BLOCK = '''\
        # -- Step 1: configure isolated margin for this contract ---------------
        # All ATD orders use isolated margin -- each position has its own collateral
        # pocket, independent of other open positions. Must be set BEFORE the order
        # via PUT /leveragepreferences.
        leverage = Decimal(str(trade.leverage or 10))
        try:
            client.set_leverage_preferences(
                symbol=instrument.symbol,
                max_leverage=int(leverage),
                margin_mode="isolated",
            )
            logger.info(
                "kraken_leverage_preferences_set",
                trade_id=trade_id,
                symbol=instrument.symbol,
                max_leverage=int(leverage),
                margin_mode="isolated",
            )
        except KrakenAPIError:
            raise

        # -- Step 2: pre-flight margin check (isolated) ------------------------
        # With isolated margin each position has its own collateral pocket.
        # Required = IM_new only -- other open positions do NOT affect this check.
        entry_price = trade.entry_price or Decimal(limit_price or "0")
        initial_margin = (lot_size * entry_price / leverage).quantize(Decimal("0.01"))
        try:
            acct = client.get_accounts_summary()
            flex = acct.get("accounts", {}).get("flex", {})
            available = Decimal(str(flex.get("availableMargin", -1)))
            required_margin = initial_margin
            logger.info(
                "kraken_preflight",
                trade_id=trade_id,
                symbol=instrument.symbol,
                side=_entry_side(trade),
                lot_size=float(lot_size),
                entry_price=float(entry_price),
                leverage=int(leverage),
                notional=float(lot_size * entry_price),
                atd_initial_margin=float(initial_margin),
                atd_required_margin=float(required_margin),
                margin_mode="isolated",
                kraken_available_margin=float(available) if available >= 0 else "N/A",
                kraken_portfolio_value=flex.get("portfolioValue", "N/A"),
            )
            # Check for open orders for the same symbol -- they lock margin.
            open_orders = client.get_open_orders()
            conflicting = [
                o for o in open_orders
                if o.get("symbol") == instrument.symbol
            ]
            if conflicting:
                logger.warning(
                    "kraken_preflight_open_orders_exist",
                    trade_id=trade_id,
                    symbol=instrument.symbol,
                    open_orders_count=len(conflicting),
                    open_orders=[{"order_id": o.get("order_id"), "side": o.get("side"), "size": o.get("size")} for o in conflicting],
                )
                raise KrakenAPIError(
                    0,
                    f"You already have {len(conflicting)} open order(s) for {instrument.symbol} on Kraken "
                    f"that are locking margin. Cancel them first before placing a new automated order.",
                )
            # Check for an existing open POSITION -- isolated mode does not allow
            # two separate isolated positions on the same symbol.
            try:
                open_positions = client.get_open_positions()
                conflicting_pos = [
                    p for p in open_positions
                    if p.get("symbol") == instrument.symbol
                ]
                if conflicting_pos:
                    pos_sides = ", ".join(
                        f"{p.get('side')} {p.get('size')} @ {p.get('price')}"
                        for p in conflicting_pos
                    )
                    logger.warning(
                        "kraken_preflight_open_position_exists",
                        trade_id=trade_id,
                        symbol=instrument.symbol,
                        positions=conflicting_pos,
                    )
                    raise KrakenAPIError(
                        0,
                        f"You already have an open position for {instrument.symbol} on Kraken "
                        f"({pos_sides}). Close it first before opening a new isolated position.",
                    )
            except KrakenAPIError:
                raise
            except Exception as pos_err:  # noqa: BLE001
                logger.warning(
                    "kraken_preflight_position_check_failed",
                    trade_id=trade_id,
                    error=str(pos_err),
                )
            if available >= 0 and available < required_margin:
                shortfall = (required_margin - available).quantize(Decimal("0.01"))
                raise KrakenAPIError(
                    0,
                    f"Insufficient Kraken margin for this trade: "
                    f"you have {float(available):.2f} USD available, "
                    f"but {float(required_margin):.2f} USD are required "
                    f"(isolated IM: {float(initial_margin):.2f} -- "
                    f"x{int(leverage)} leverage, {float(lot_size):.4f} units at {float(entry_price):.2f}). "
                    f"Add at least {float(shortfall):.2f} USD to your Kraken account, "
                    f"or reduce risk % to lower position size.",
                )
        except KrakenAPIError:
            raise
        except Exception as preflight_err:  # noqa: BLE001
            logger.warning(
                "kraken_preflight_check_failed",
                trade_id=trade_id,
                error=str(preflight_err),
            )

        result = client.send_order(
            order_type=kraken_type,
            symbol=instrument.symbol,
            side=_entry_side(trade),
            size=str(lot_size),
            limit_price=limit_price,
        )'''

new_content = content[:start_idx] + NEW_BLOCK + content[end_idx:]
svc.write_text(new_content, encoding="utf-8")
print(f"OK: replaced {len(old_block)} bytes with {len(NEW_BLOCK)} bytes")
