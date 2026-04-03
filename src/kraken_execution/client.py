"""
src/kraken_execution/client.py

Authenticated Kraken Futures REST client.

Authentication: HMAC-SHA512 (Kraken Futures scheme, different from Spot API).
  - Decrypted API keys injected at construction time by the caller.
  - Keys are NEVER logged, NEVER returned by any API response.

Demo mode: reads settings.kraken_futures_base_url → demo-futures.kraken.com or
futures.kraken.com based on KRAKEN_DEMO env var and APP_ENV.
"""

from __future__ import annotations

import base64
import hashlib
import hmac as _hmac
import time
from typing import Any
from urllib.parse import urlencode

import httpx
import structlog

from src.core.config import settings
from src.kraken_execution import KrakenAPIError

logger = structlog.get_logger()


class KrakenExecutionClient:
    """Authenticated Kraken Futures REST client.

    Usage — context manager (preferred):
        with KrakenExecutionClient(api_key, api_secret) as client:
            result = client.send_order(...)

    Usage — manual:
        client = KrakenExecutionClient(api_key, api_secret)
        try:
            result = client.send_order(...)
        finally:
            client.close()
    """

    def __init__(
        self,
        api_key: str,
        api_secret: str,
        base_url: str | None = None,
        timeout: float = 10.0,
    ) -> None:
        self._api_key = api_key
        self._api_secret = api_secret
        self._base_url = base_url or settings.kraken_futures_base_url
        self._http = httpx.Client(base_url=self._base_url, timeout=timeout)

    def __enter__(self) -> KrakenExecutionClient:
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    def close(self) -> None:
        self._http.close()

    # ── Authentication ────────────────────────────────────────────────────────

    def _sign(self, endpoint_path: str, post_data: str, nonce: str) -> str:
        """Compute Kraken Futures HMAC-SHA512 signature.

        Algorithm (Kraken Futures API docs):
          signed_path = endpoint_path without /derivatives prefix → "/api/v3/sendorder"
          message     = post_data + nonce + signed_path
          sha256      = SHA256(message.encode('utf-8')).digest()
          signature   = base64( HMAC-SHA512(base64decode(api_secret), sha256) )

        For GET requests: post_data is an empty string.
        For POST requests: post_data is the URL-encoded request body.
        """
        signed_path = endpoint_path.removeprefix("/derivatives")
        message = post_data + nonce + signed_path
        sha256_hash = hashlib.sha256(message.encode("utf-8")).digest()
        raw_sig = _hmac.new(
            base64.b64decode(self._api_secret),
            sha256_hash,
            hashlib.sha512,
        ).digest()
        return base64.b64encode(raw_sig).decode()

    def _auth_headers(self, endpoint_path: str, post_data: str = "") -> dict[str, str]:
        nonce = str(int(time.time() * 1000))
        return {
            "APIKey": self._api_key,
            "Nonce": nonce,
            "AuthTime": nonce,
            "Authent": self._sign(endpoint_path, post_data, nonce),
        }

    # ── Private HTTP helpers ──────────────────────────────────────────────────

    def _get(self, path: str, params: dict[str, str] | None = None) -> dict:
        start = time.monotonic()
        resp = self._http.get(path, params=params, headers=self._auth_headers(path))
        latency_ms = int((time.monotonic() - start) * 1000)
        logger.debug(
            "kraken_exec_get",
            path=path,
            status=resp.status_code,
            latency_ms=latency_ms,
        )
        if not resp.is_success:
            raise KrakenAPIError(resp.status_code, resp.text)
        return resp.json()  # type: ignore[no-any-return]

    def _post(self, path: str, data: dict[str, Any] | None = None) -> dict:
        encoded = urlencode(data or {})
        start = time.monotonic()
        resp = self._http.post(
            path,
            content=encoded,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                **self._auth_headers(path, encoded),
            },
        )
        latency_ms = int((time.monotonic() - start) * 1000)
        logger.debug(
            "kraken_exec_post",
            path=path,
            status=resp.status_code,
            latency_ms=latency_ms,
        )
        if not resp.is_success:
            raise KrakenAPIError(resp.status_code, resp.text)
        return resp.json()  # type: ignore[no-any-return]

    # ── Public API methods ────────────────────────────────────────────────────
    def get_accounts_summary(self) -> dict:
        """Fetch portfolio margin summary from Kraken Futures.

        Returns the full accounts payload. Key fields:
          accounts["flex"]["availableMargin"] — free margin ready for new positions
          accounts["flex"]["initialMargin"]   — margin locked by open positions
          accounts["flex"]["portfolioValue"]  — total account equity
        """
        return self._get("/derivatives/api/v3/accounts")

    def send_order(
        self,
        order_type: str,
        symbol: str,
        side: str,
        size: str,
        limit_price: str | None = None,
        stop_price: str | None = None,
        reduce_only: bool = False,
        max_leverage: int | None = None,
        raise_on_rejection: bool = True,
    ) -> dict:
        """Place an order on Kraken Futures.

        Args:
            order_type:        "mkt" | "lmt" | "stp" | "take_profit"
            symbol:            instrument symbol (e.g. "PF_XBTUSD")
            side:              "buy" | "sell"
            size:              lot size as decimal string — never float repr
            limit_price:       required for "lmt" and "take_profit" orders
            stop_price:        required for "stp" orders
            reduce_only:       True for all SL/TP orders (close-only protection)
            max_leverage:      leverage multiplier for PF_ (Portfolio Margin) instruments.
                               If None, Kraken uses the account default (typically ×1).
                               Always pass this for entry orders to ensure the correct
                               margin is used — otherwise Kraken may reject with
                               wouldCauseLiquidation.
            raise_on_rejection: True (default) for entry orders — raises KrakenAPIError if
                               Kraken rejects. Pass False for SL/TP orders so that
                               place_sl_tp_orders can handle failures gracefully.

        Returns:
            Kraken API response dict. The "sendStatus.orderId" field holds the
            order ID needed for tracking in kraken_orders.
        """
        payload: dict[str, Any] = {
            "orderType": order_type,
            "symbol": symbol,
            "side": side,
            "size": size,
        }
        if limit_price is not None:
            payload["limitPrice"] = limit_price
        if stop_price is not None:
            payload["stopPrice"] = stop_price
        if reduce_only:
            payload["reduceOnly"] = "true"
        if max_leverage is not None:
            payload["maxLeverage"] = max_leverage

        result = self._post("/derivatives/api/v3/sendorder", payload)
        logger.info("kraken_sendorder_raw", payload=payload, raw=result)
        if result.get("result") != "success":
            raise KrakenAPIError(0, str(result))
        # Guard against Kraken returning result="success" with a rejected sendStatus
        # (e.g. insufficientFunds, invalidArgument, wouldNotReducePosition)
        send_status = result.get("sendStatus", {})
        placement_status = send_status.get("status", "")
        if placement_status != "placed":
            if raise_on_rejection:
                raise KrakenAPIError(
                    0,
                    f"Order rejected by Kraken — sendStatus.status={placement_status!r} | "
                    f"order_id={send_status.get('order_id')!r} | symbol={symbol} side={side} size={size}",
                )
            logger.warning(
                "kraken_order_rejected",
                symbol=symbol, side=side, order_type=order_type, size=size,
                placement_status=placement_status,
            )
        else:
            logger.info(
                "kraken_order_placed",
                symbol=symbol, side=side, order_type=order_type, size=size,
                status=placement_status, order_id=send_status.get("order_id"),
            )
        return result

    def cancel_order(self, order_id: str) -> dict:
        """Cancel an open order by Kraken order ID.

        Returns:
            Kraken API response dict — "cancelStatus" field indicates result.
        """
        result = self._post("/derivatives/api/v3/cancelorder", {"order_id": order_id})
        logger.info(
            "kraken_order_cancelled",
            order_id=order_id,
            status=result.get("cancelStatus", {}).get("status"),
        )
        return result

    def get_open_orders(self) -> list[dict]:
        """Return all open orders for the authenticated account.

        Returns:
            List of open order dicts (see Kraken Futures API docs for shape).
        """
        data = self._get("/derivatives/api/v3/openorders")
        return data.get("openOrders", [])  # type: ignore[return-value]

    def get_fills(self, last_fill_time: str | None = None) -> list[dict]:
        """Return recent fills, optionally since a cursor timestamp.

        Args:
            last_fill_time: ISO-8601 timestamp (exclusive lower bound).
                            Pass the lastFillTime from the previous call for
                            efficient pagination.

        Returns:
            List of fill dicts sorted newest-first by Kraken.
        """
        params: dict[str, str] = {}
        if last_fill_time:
            params["lastFillTime"] = last_fill_time
        data = self._get("/derivatives/api/v3/fills", params=params)
        return data.get("fills", [])  # type: ignore[return-value]

    def get_open_positions(self) -> list[dict]:
        """Return all current open positions.

        Returns:
            List of position dicts from Kraken. Each dict includes:
            side, symbol, price (avg entry), fillTime, size, unrealisedFunding, pnlCurrency.
            NOTE: does NOT include markPrice or unrealisedPnl — use get_tickers() for that.
        """
        data = self._get("/derivatives/api/v3/openpositions")
        return data.get("openPositions", [])  # type: ignore[return-value]

    def get_tickers(self) -> dict[str, dict]:
        """Return current market data for all instruments, keyed by symbol.

        Calls the public /tickers endpoint (auth headers accepted but not required).
        Each ticker dict includes: markPrice, bid, ask, last, vol24h, etc.

        Returns:
            Dict mapping symbol (e.g. "PF_TAOUSD") → ticker dict.
        """
        data = self._get("/derivatives/api/v3/tickers")
        return {t["symbol"]: t for t in data.get("tickers", [])}

    def ping(self) -> tuple[bool, str | None]:
        """Test API connectivity by calling GET /openorders.

        Returns (True, None) if authenticated connection works.
        Returns (False, error_message) on any error — never raises.
        """
        try:
            data = self._get("/derivatives/api/v3/openorders")
            if data.get("result") not in ("success", None):
                return False, data.get("error", "unknown error")
            return True, None
        except KrakenAPIError as exc:
            return False, str(exc)
        except Exception as exc:
            return False, str(exc)
