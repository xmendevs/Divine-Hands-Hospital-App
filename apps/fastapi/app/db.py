"""PostgreSQL access for the analytics service.

The FastAPI service is a read-only analytics companion to the Go core. It
connects directly to the shared `hims` database (the same one the Go service
writes to) so analytics always reflect the authoritative transactional data.
All endpoints are read-only; the service never mutates shared state.
"""

import logging
from collections.abc import AsyncIterator

import asyncpg

from .config import get_settings

logger = logging.getLogger("fastapi.db")

_pool: asyncpg.Pool | None = None


async def connect() -> None:
    """Create the connection pool. Idempotent; safe to call at startup.

    A failed connect (database down, bad URL) is logged but not fatal: the
    pool stays unset and analytics endpoints return 503, so the service can
    still serve health/readiness while the database is unavailable.
    """
    global _pool
    if _pool is not None:
        return
    settings = get_settings()
    try:
        _pool = await asyncpg.create_pool(
            settings.database_url,
            min_size=1,
            max_size=settings.db_pool_size,
            timeout=settings.db_connect_timeout,
        )
    except Exception:
        logger.warning("analytics database unavailable; endpoints will return 503", exc_info=True)
        _pool = None


async def close() -> None:
    """Close the connection pool. Idempotent; safe to call at shutdown."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def get_conn() -> AsyncIterator[asyncpg.Connection]:
    """FastAPI dependency yielding a pooled connection.

    Raises 503 (via DatabaseUnavailable) when the pool is not running, so
    callers can fail fast instead of hanging on a dead database.
    """
    if _pool is None:
        raise DatabaseUnavailable("analytics database is not available")
    async with _pool.acquire() as conn:
        yield conn


class DatabaseUnavailable(Exception):
    """Raised when the analytics database pool is not available."""
