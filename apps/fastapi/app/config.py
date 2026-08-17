from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    service_name: str = "fastapi"
    host: str = "127.0.0.1"
    port: int = 8000
    log_level: str = "info"
    app_timezone: str = "UTC"
    postgres_host: str = "127.0.0.1"
    postgres_port: int = 5432
    redis_host: str = "127.0.0.1"
    redis_port: int = 6379

    # Analytics database: the same PostgreSQL the Go core service uses.
    # Defaults mirror the Go service so a dev environment works out of the box.
    database_url: str = "postgres://hims:change-me@127.0.0.1:5432/hims?sslmode=disable"
    db_pool_size: int = 5
    db_connect_timeout: float = 5.0

    # Internal service token shared with the Go API. Every analytics endpoint
    # requires `Authorization: Bearer <token>`; the Go API forwards requests
    # after authenticating the end user, so FastAPI never sees user sessions.
    # Leave empty to disable analytics (endpoints return 503).
    internal_token: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
