"""FastAPI service entrypoint.

Scaffold baseline: health/readiness, versioned API prefix, structured logging,
correlation IDs, and a standardized error envelope. Business endpoints are
added in later build phases.
"""

from fastapi import FastAPI

from .api.v1.router import router as v1_router
from .config import get_settings
from .errors import register_exception_handlers
from .health import router as health_router
from .logging import configure_logging
from .middleware import RequestIDMiddleware

settings = get_settings()
configure_logging(settings.log_level)

app = FastAPI(title="HIMS FastAPI", version="0.1.0")
app.add_middleware(RequestIDMiddleware)
app.include_router(health_router)
app.include_router(v1_router, prefix="/api/v1")
register_exception_handlers(app)
