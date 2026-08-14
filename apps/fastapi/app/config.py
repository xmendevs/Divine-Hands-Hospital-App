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


@lru_cache
def get_settings() -> Settings:
    return Settings()
