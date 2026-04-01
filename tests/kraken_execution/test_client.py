"""
tests/kraken_execution/test_client.py

Unit tests for KrakenExecutionClient — fully offline (no real API calls).

Strategy:
  - _sign() and _auth_headers() are tested with known inputs.
  - HTTP methods are tested by patching httpx.Client via unittest.mock.
  - KrakenAPIError is raised on non-2xx responses.
"""

from __future__ import annotations

import base64
import hashlib
import hmac as _hmac
from unittest.mock import MagicMock, patch

import pytest

from src.kraken_execution import KrakenAPIError
from src.kraken_execution.client import KrakenExecutionClient

# ── Test fixtures ─────────────────────────────────────────────────────────────

# These are intentionally fake credentials used for offline HMAC tests only.
_FAKE_API_KEY = "fake_api_key_for_tests"
# Fernet-style 32-byte base64 key used as a stand-in API secret for HMAC
_FAKE_API_SECRET = base64.b64encode(b"a" * 64).decode()  # 64 bytes → valid HMAC key

_BASE_URL = "https://test.kraken.local"


@pytest.fixture()
def client() -> KrakenExecutionClient:
    return KrakenExecutionClient(
        api_key=_FAKE_API_KEY,
        api_secret=_FAKE_API_SECRET,
        base_url=_BASE_URL,
    )


# ── _sign() ───────────────────────────────────────────────────────────────────

class TestSign:
    def test_signature_is_deterministic_for_same_inputs(self, client: KrakenExecutionClient):
        """Same inputs always produce the same HMAC-SHA512 signature."""
        sig1 = client._sign("/derivatives/api/v3/sendorder", "size=1&symbol=PF_XBTUSD", "123456")
        sig2 = client._sign("/derivatives/api/v3/sendorder", "size=1&symbol=PF_XBTUSD", "123456")
        assert sig1 == sig2

    def test_signature_differs_when_nonce_changes(self, client: KrakenExecutionClient):
        """Different nonce → different signature."""
        sig1 = client._sign("/path", "post_data", "111111")
        sig2 = client._sign("/path", "post_data", "222222")
        assert sig1 != sig2

    def test_signature_differs_when_post_data_changes(self, client: KrakenExecutionClient):
        """Different post_data → different signature."""
        sig1 = client._sign("/path", "a=1", "999")
        sig2 = client._sign("/path", "a=2", "999")
        assert sig1 != sig2

    def test_signature_matches_manual_computation(self, client: KrakenExecutionClient):
        """Manually compute the expected signature and compare."""
        path = "/derivatives/api/v3/openorders"
        post_data = ""
        nonce = "1700000000000"

        # Kraken Futures strips the /derivatives prefix before hashing.
        signed_path = path.removeprefix("/derivatives")  # → "/api/v3/openorders"
        message = post_data + nonce + signed_path
        sha256 = hashlib.sha256(message.encode("utf-8")).digest()
        expected = base64.b64encode(
            _hmac.new(base64.b64decode(_FAKE_API_SECRET), sha256, hashlib.sha512).digest()
        ).decode()

        assert client._sign(path, post_data, nonce) == expected

    def test_get_uses_empty_post_data_in_message(self, client: KrakenExecutionClient):
        """GET auth: post_data is empty string → signature still valid (not None)."""
        sig = client._sign("/derivatives/api/v3/openorders", "", "999999")
        assert isinstance(sig, str)
        assert len(sig) > 0


# ── _auth_headers() ───────────────────────────────────────────────────────────

class TestAuthHeaders:
    def test_auth_headers_contain_required_keys(self, client: KrakenExecutionClient):
        headers = client._auth_headers("/derivatives/api/v3/openorders")
        assert "APIKey" in headers
        assert "Nonce" in headers
        assert "AuthTime" in headers
        assert "Authent" in headers

    def test_api_key_is_injected_unchanged(self, client: KrakenExecutionClient):
        headers = client._auth_headers("/some/path")
        assert headers["APIKey"] == _FAKE_API_KEY

    def test_nonce_equals_auth_time(self, client: KrakenExecutionClient):
        headers = client._auth_headers("/some/path")
        assert headers["Nonce"] == headers["AuthTime"]


# ── HTTP methods ──────────────────────────────────────────────────────────────

def _mock_response(status_code: int = 200, json_body: dict | None = None):
    """Return a mock httpx.Response."""
    mock = MagicMock()
    mock.status_code = status_code
    mock.is_success = 200 <= status_code < 300
    mock.text = str(json_body)
    mock.json.return_value = json_body or {}
    return mock


class TestGetMethod:
    def test_get_returns_json_on_success(self, client: KrakenExecutionClient):
        mock_resp = _mock_response(200, {"openOrders": [{"order_id": "abc"}]})
        with patch.object(client._http, "get", return_value=mock_resp) as mock_get:
            result = client.get_open_orders()
        assert result == [{"order_id": "abc"}]
        mock_get.assert_called_once()

    def test_get_raises_kraken_api_error_on_4xx(self, client: KrakenExecutionClient):
        mock_resp = _mock_response(401, {"error": "unauthorized"})
        with patch.object(client._http, "get", return_value=mock_resp):
            with pytest.raises(KrakenAPIError) as exc_info:
                client._get("/derivatives/api/v3/openorders")
        assert exc_info.value.status_code == 401

    def test_get_raises_kraken_api_error_on_5xx(self, client: KrakenExecutionClient):
        mock_resp = _mock_response(503, {"error": "service unavailable"})
        with patch.object(client._http, "get", return_value=mock_resp):
            with pytest.raises(KrakenAPIError) as exc_info:
                client._get("/some/path")
        assert exc_info.value.status_code == 503


class TestPostMethod:
    def test_post_sends_url_encoded_content_type(self, client: KrakenExecutionClient):
        mock_resp = _mock_response(200, {"sendStatus": {"status": "placed"}})
        with patch.object(client._http, "post", return_value=mock_resp) as mock_post:
            client._post("/derivatives/api/v3/sendorder", {"size": "1", "symbol": "PF_XBTUSD"})
        _, kwargs = mock_post.call_args
        headers = kwargs.get("headers", {})
        assert headers.get("Content-Type") == "application/x-www-form-urlencoded"

    def test_post_raises_kraken_api_error_on_non_2xx(self, client: KrakenExecutionClient):
        mock_resp = _mock_response(400, {"error": "invalid order"})
        with patch.object(client._http, "post", return_value=mock_resp):
            with pytest.raises(KrakenAPIError) as exc_info:
                client._post("/path", {})
        assert exc_info.value.status_code == 400


# ── send_order() ──────────────────────────────────────────────────────────────

class TestSendOrder:
    def test_send_order_passes_core_fields(self, client: KrakenExecutionClient):
        mock_resp = _mock_response(200, {"result": "success", "sendStatus": {"orderId": "ord1", "status": "placed"}})
        with patch.object(client._http, "post", return_value=mock_resp) as mock_post:
            result = client.send_order("mkt", "PF_XBTUSD", "buy", "0.1")
        assert result["sendStatus"]["orderId"] == "ord1"
        # Verify the encoded body was passed as content
        call_kwargs = mock_post.call_args[1]
        content: str = call_kwargs.get("content", "")
        assert "orderType=mkt" in content
        assert "symbol=PF_XBTUSD" in content
        assert "side=buy" in content
        assert "size=0.1" in content

    def test_send_order_passes_reduce_only_when_true(self, client: KrakenExecutionClient):
        mock_resp = _mock_response(200, {"result": "success", "sendStatus": {"status": "placed"}})
        with patch.object(client._http, "post", return_value=mock_resp) as mock_post:
            client.send_order("stp", "PF_XBTUSD", "sell", "0.1", reduce_only=True)
        content: str = mock_post.call_args[1].get("content", "")
        assert "reduceOnly=true" in content

    def test_send_order_passes_limit_price_when_provided(self, client: KrakenExecutionClient):
        mock_resp = _mock_response(200, {"result": "success", "sendStatus": {"status": "placed"}})
        with patch.object(client._http, "post", return_value=mock_resp) as mock_post:
            client.send_order("lmt", "PF_XBTUSD", "buy", "0.5", limit_price="50000")
        content: str = mock_post.call_args[1].get("content", "")
        assert "limitPrice=50000" in content

    def test_send_order_passes_stop_price_when_provided(self, client: KrakenExecutionClient):
        mock_resp = _mock_response(200, {"result": "success", "sendStatus": {"status": "placed"}})
        with patch.object(client._http, "post", return_value=mock_resp) as mock_post:
            client.send_order("stp", "PF_XBTUSD", "sell", "0.5", stop_price="49000")
        content: str = mock_post.call_args[1].get("content", "")
        assert "stopPrice=49000" in content


# ── cancel_order() ────────────────────────────────────────────────────────────

class TestCancelOrder:
    def test_cancel_order_sends_correct_order_id(self, client: KrakenExecutionClient):
        mock_resp = _mock_response(200, {"cancelStatus": {"status": "cancelled"}})
        with patch.object(client._http, "post", return_value=mock_resp) as mock_post:
            result = client.cancel_order("ORDER-XYZ")
        content: str = mock_post.call_args[1].get("content", "")
        assert "ORDER-XYZ" in content
        assert result["cancelStatus"]["status"] == "cancelled"


# ── get_fills() ───────────────────────────────────────────────────────────────

class TestGetFills:
    def test_get_fills_returns_list(self, client: KrakenExecutionClient):
        mock_resp = _mock_response(200, {"fills": [{"order_id": "abc", "price": 50000}]})
        with patch.object(client._http, "get", return_value=mock_resp):
            fills = client.get_fills()
        assert fills == [{"order_id": "abc", "price": 50000}]

    def test_get_fills_passes_last_fill_time_param(self, client: KrakenExecutionClient):
        mock_resp = _mock_response(200, {"fills": []})
        with patch.object(client._http, "get", return_value=mock_resp) as mock_get:
            client.get_fills(last_fill_time="2024-01-01T00:00:00Z")
        _, kwargs = mock_get.call_args
        assert kwargs.get("params", {}).get("lastFillTime") == "2024-01-01T00:00:00Z"


# ── get_open_positions() ──────────────────────────────────────────────────────

class TestGetOpenPositions:
    def test_returns_open_positions(self, client: KrakenExecutionClient):
        mock_resp = _mock_response(200, {"openPositions": [{"instrument": "PF_XBTUSD"}]})
        with patch.object(client._http, "get", return_value=mock_resp):
            positions = client.get_open_positions()
        assert positions == [{"instrument": "PF_XBTUSD"}]


# ── ping() ────────────────────────────────────────────────────────────────────

class TestPing:
    def test_ping_returns_true_on_success(self, client: KrakenExecutionClient):
        mock_resp = _mock_response(200, {"openOrders": []})
        with patch.object(client._http, "get", return_value=mock_resp):
            ok, error = client.ping()
        assert ok is True
        assert error is None

    def test_ping_returns_false_on_kraken_api_error(self, client: KrakenExecutionClient):
        mock_resp = _mock_response(401, {"error": "unauthorized"})
        with patch.object(client._http, "get", return_value=mock_resp):
            ok, error = client.ping()
        assert ok is False
        assert error is not None

    def test_ping_returns_false_on_network_error(self, client: KrakenExecutionClient):
        import httpx as _httpx

        with patch.object(client._http, "get", side_effect=_httpx.ConnectError("timeout")):
            ok, error = client.ping()
        assert ok is False
        assert error is not None


# ── Context manager ───────────────────────────────────────────────────────────

class TestContextManager:
    def test_context_manager_calls_close(self):
        c = KrakenExecutionClient(
            api_key=_FAKE_API_KEY,
            api_secret=_FAKE_API_SECRET,
            base_url=_BASE_URL,
        )
        with patch.object(c, "close") as mock_close:
            with c:
                pass
        mock_close.assert_called_once()
