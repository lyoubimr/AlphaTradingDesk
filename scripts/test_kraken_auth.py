#!/usr/bin/env python3
"""
Quick Kraken Futures auth test — run locally (NOT in Docker).

Usage:
    python scripts/test_kraken_auth.py <api_key> <api_secret> [--live]

By default tests against demo-futures.kraken.com.
With --live tests against futures.kraken.com (real money — be careful).

This script bypasses the app entirely to test the raw auth algorithm.
"""

import argparse
import base64
import hashlib
import hmac
import time
from urllib.parse import urlencode

import httpx


def _sign(api_secret: str, endpoint_path: str, post_data: str, nonce: str) -> str:
    # Strip /derivatives prefix only → "/api/v3/sendorder"
    signed_path = endpoint_path.removeprefix("/derivatives")
    message = post_data + nonce + signed_path
    sha256_hash = hashlib.sha256(message.encode("utf-8")).digest()
    raw_sig = hmac.new(
        base64.b64decode(api_secret),
        sha256_hash,
        hashlib.sha512,
    ).digest()
    return base64.b64encode(raw_sig).decode()


def _auth_headers(api_key: str, api_secret: str, path: str, post_data: str = "") -> dict:
    nonce = str(int(time.time() * 1000))
    return {
        "APIKey": api_key,
        "Nonce": nonce,
        "Authent": _sign(api_secret, path, post_data, nonce),
    }


def test_auth(api_key: str, api_secret: str, base_url: str) -> None:
    print(f"\n🔑 Testing auth against: {base_url}")
    print(f"   APIKey: {api_key[:6]}...{api_key[-4:]}")

    path = "/derivatives/api/v3/openorders"

    with httpx.Client(base_url=base_url, timeout=10.0) as client:
        resp = client.get(path, headers=_auth_headers(api_key, api_secret, path))

    print(f"\n📡 HTTP status: {resp.status_code}")
    data = resp.json()
    print(f"📦 Response: {data}")

    if data.get("result") == "success":
        orders = data.get("openOrders", [])
        print(f"\n✅ AUTH OK — {len(orders)} open orders")
    else:
        print(f"\n❌ AUTH FAILED — error: {data.get('error')}")
        print("\nPossible causes:")
        print("  1. Keys generated on kraken.com (Spot) — need demo-futures.kraken.com")
        print("  2. API key permissions: need 'General API > Full Access'")
        print("  3. IP restriction on the key")

    # Also test a send_order (dry-run with invalid symbol to check auth separately)
    print("\n--- Testing POST sendorder (auth only, invalid symbol) ---")
    send_path = "/derivatives/api/v3/sendorder"
    payload = {"orderType": "mkt", "symbol": "INVALID_TEST", "side": "buy", "size": "0.001"}
    encoded = urlencode(payload)
    with httpx.Client(base_url=base_url, timeout=10.0) as client:
        resp2 = client.post(
            send_path,
            content=encoded,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                **_auth_headers(api_key, api_secret, send_path, encoded),
            },
        )
    data2 = resp2.json()
    print(f"📡 HTTP status: {resp2.status_code}")
    print(f"📦 Response: {data2}")
    if data2.get("result") == "error" and data2.get("error") == "authenticationError":
        print("❌ POST auth FAILED — same auth error on sendorder")
    elif data2.get("result") == "error":
        print(f"✅ POST auth OK — order rejected for business reason: {data2.get('error')}")
    else:
        print(f"📊 POST result: {data2.get('result')}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test Kraken Futures auth")
    parser.add_argument("api_key", help="Kraken Futures API key")
    parser.add_argument("api_secret", help="Kraken Futures API secret (base64)")
    parser.add_argument("--live", action="store_true", help="Use live futures (default: demo)")
    args = parser.parse_args()

    base_url = "https://futures.kraken.com" if args.live else "https://demo-futures.kraken.com"
    test_auth(args.api_key, args.api_secret, base_url)
