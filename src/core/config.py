"""
Application configuration — loaded from environment variables / .env.dev
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env.dev",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database
    database_url: str

    # Security
    secret_key: str
    encryption_key: str

    # App
    environment: str = "development"

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
