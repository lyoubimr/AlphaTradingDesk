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

from pydantic import Field
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

    # Redis — used by Celery (Phase 2+)
    redis_url: str = Field("redis://localhost:6379/0", alias="REDIS_URL")

    # Security
    secret_key: str
    encryption_key: str

    # App — reads APP_ENV directly (same var used to select the .env file)
    # Values: "dev" | "test" | "prod"
    environment: str = Field("dev", alias="APP_ENV")

    # Uploads — absolute path to the uploads directory
    # In Docker: mount a named volume here so uploads survive container restarts
    uploads_dir: str = "/app/uploads"

    # Logging
    # LOG_LEVEL: DEBUG | INFO | WARNING | ERROR  (default: DEBUG in dev, INFO elsewhere)
    log_level: str = Field("INFO", alias="LOG_LEVEL")
    # LOG_DIR: directory for log files — prod only, ignored in dev (stdout only)
    # In prod Docker: bind-mounted to /srv/atd/logs/app on the Dell
    log_dir: str = Field("/app/logs", alias="LOG_DIR")

    # App version — injected at Docker build time via APP_VERSION build-arg
    # In dev: defaults to "dev" | In prod: set to the git semver tag (e.g. "v2.0.0")
    app_version: str = Field("dev", alias="APP_VERSION")

    # CORS — comma-separated list of allowed origins
    # Override via ALLOWED_ORIGINS env var for any deployment
    # e.g. ALLOWED_ORIGINS=https://myapp.example.com,https://app2.example.com
    allowed_origins_raw: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins_raw.split(",") if o.strip()]

    # XAU (Gold) live price — Twelve Data API
    # XAU_API_KEY: set in .env.dev / .env.prod — leave empty to disable XAU fetch
    # XAU_API_PROVIDER: only "twelve_data" supported in Phase 2
    xau_api_key: str = Field("", alias="XAU_API_KEY")
    xau_api_provider: str = Field("twelve_data", alias="XAU_API_PROVIDER")

    @property
    def is_dev(self) -> bool:
        return self.environment == "dev"


settings = Settings()  # type: ignore[call-arg]
