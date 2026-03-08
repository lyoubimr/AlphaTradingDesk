"""Debug 500 on /api/profiles."""
import os, traceback
os.environ.setdefault("APP_ENV", "dev")

from src.main import app  # noqa: E402
from fastapi.testclient import TestClient

client = TestClient(app, raise_server_exceptions=True)
try:
    r = client.get("/api/profiles")
    print("STATUS:", r.status_code)
    print("BODY:", r.text[:2000])
except Exception:
    traceback.print_exc()
