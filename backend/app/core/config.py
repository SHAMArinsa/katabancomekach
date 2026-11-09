"""Environment-based configuration.

All secrets come from environment variables (or a .env file during local
development). Nothing here is ever sent to the frontend.
"""
from functools import lru_cache
from pathlib import Path

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]

INSECURE_SECRET = "replace_with_a_secure_random_secret"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"), env_file_encoding="utf-8-sig", extra="ignore"
    )

    APP_ENV: str = "development"  # development | test | production
    APP_NAME: str = "Glass Luxury Store"
    SECRET_KEY: str = INSECURE_SECRET
    LOG_LEVEL: str = "INFO"

    DATABASE_URL: str = "postgresql+psycopg://postgres:password@localhost:5432/glass_store"
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 10

    FRONTEND_URL: str = "http://localhost:5173"
    CORS_ORIGINS: str = "http://localhost:5173"
    PUBLIC_API_URL: str = "http://127.0.0.1:8000"

    ACCESS_TOKEN_MINUTES: int = 15
    REFRESH_TOKEN_DAYS: int = 14
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "lax"  # lax | strict | none
    COOKIE_DOMAIN: str | None = None

    PAYMENT_PROVIDER: str = "mock"  # mock | razorpay
    RAZORPAY_KEY_ID: str = ""
    RAZORPAY_KEY_SECRET: str = ""
    RAZORPAY_WEBHOOK_SECRET: str = ""
    # Live payment mode can only be switched on in the admin portal when the
    # deployment explicitly allows it.
    PAYMENT_LIVE_ALLOWED: bool = False
    ALLOW_MOCK_IN_PRODUCTION: bool = False

    STORAGE_PROVIDER: str = "local"  # local | vercel_blob
    LOCAL_UPLOAD_DIR: str = "./uploads"
    PRIVATE_UPLOAD_DIR: str = "./private_uploads"
    BLOB_READ_WRITE_TOKEN: str = ""
    MAX_UPLOAD_MB: int = 5

    EMAIL_PROVIDER: str = "console"  # console | smtp
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_USE_TLS: bool = True
    EMAIL_FROM: str = ""

    SHIPPING_PROVIDER: str = "mock"
    SHIPPING_API_KEY: str = ""

    RESERVATION_MINUTES: int = 30
    RATE_LIMIT_ENABLED: bool = True

    @field_validator("DATABASE_URL")
    @classmethod
    def normalise_db_url(cls, v: str) -> str:
        # Render provides postgres:// or postgresql:// URLs; force psycopg3 driver.
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://"):]
        if v.startswith("postgresql://"):
            v = "postgresql+psycopg://" + v[len("postgresql://"):]
        return v

    @model_validator(mode="after")
    def production_guards(self):
        if self.APP_ENV == "production":
            if self.SECRET_KEY == INSECURE_SECRET or len(self.SECRET_KEY) < 32:
                raise ValueError("SECRET_KEY must be a strong random value (>=32 chars) in production")
            if self.PAYMENT_PROVIDER == "mock" and not self.ALLOW_MOCK_IN_PRODUCTION:
                raise ValueError("Mock payment provider is not allowed in production")
            if not self.COOKIE_SECURE:
                raise ValueError("COOKIE_SECURE must be true in production")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"

    @property
    def local_upload_path(self) -> Path:
        p = Path(self.LOCAL_UPLOAD_DIR)
        return p if p.is_absolute() else (BACKEND_DIR / p).resolve()

    @property
    def private_upload_path(self) -> Path:
        p = Path(self.PRIVATE_UPLOAD_DIR)
        return p if p.is_absolute() else (BACKEND_DIR / p).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
