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

    @property
    def allowed_origins(self) -> list[str]:
        if self.environment == "production":
            return ["http://alphatradingdesk.local"]
        return ["http://localhost:5173", "http://127.0.0.1:5173"]

    @property
    def is_dev(self) -> bool:
        return self.environment == "development"


settings = Settings()  # type: ignore[call-arg]
