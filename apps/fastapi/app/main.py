"""FastAPI service entrypoint.

Health/readiness, versioned API prefix, structured logging, correlation IDs,
and a standardized error envelope, plus the read-only analytics service
(trends, overview, ML insights, and printable reports) that reads the shared
`hims` database and requires the internal service token.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import db
from .api.v1.router import router as v1_router
from .config import get_settings
from .errors import register_exception_handlers
from .health import router as health_router
from .logging import configure_logging
from .middleware import RequestIDMiddleware

settings = get_settings()
configure_logging(settings.log_level)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    try:
        yield
    finally:
        await db.close()


app = FastAPI(title="HIMS FastAPI", version="0.1.0", lifespan=lifespan)
app.add_middleware(RequestIDMiddleware)
app.include_router(health_router)
app.include_router(v1_router, prefix="/api/v1")
register_exception_handlers(app)
