"""
Application configuration — loaded from environment variables.

Priority order (highest → lowest):
  1. Real environment variables  ← always wins (prod / CI / Docker)
  2. .env file on disk           ← dev convenience only, never in prod container
  3. Class defaults              ← safe fallbacks

Which .env file is loaded is controlled by APP_ENV (default: "dev"):
  APP_ENV=dev   → .env.dev    (local development)
  APP_ENV=test  → .env.test   (pytest / CI — can be absent)
  APP_ENV=prod  → .env.prod   (local prod test — absent in Docker)

In Docker (prod), no .env file is present → env vars come from the container
environment only (docker-compose env_file / Kubernetes secrets / etc.).
env_file_required=False ensures the app starts cleanly without a file.
"""

import os

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve which .env file to load based on APP_ENV.
# Real env vars always take precedence over the file (pydantic-settings default).
_APP_ENV = os.getenv("APP_ENV", "dev")
_ENV_FILE = f".env.{_APP_ENV}"  # e.g. .env.dev / .env.test / .env.prod


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        env_file_required=False,  # type: ignore[typeddict-unknown-key]  # prod containers have no .env file — that's fine
        extra="ignore",
    )

    # Database — always from env, no default (fails fast if missing)
    database_url: str

    # Security
    secret_key: str
    encryption_key: str

    # App
    environment: str = "development"

    # Uploads — absolute path to the uploads directory
    # In Docker: mount a named volume here so uploads survive container restarts
    uploads_dir: str = "/app/uploads"

    # CORS — comma-separated list of allowed origins
    # Override via ALLOWED_ORIGINS env var for any deployment
    # e.g. ALLOWED_ORIGINS=https://myapp.example.com,https://app2.example.com
    allowed_origins_raw: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins_raw.split(",") if o.strip()]

    @property
    def is_dev(self) -> bool:
        return self.environment == "development"


settings = Settings()  # type: ignore[call-arg]
