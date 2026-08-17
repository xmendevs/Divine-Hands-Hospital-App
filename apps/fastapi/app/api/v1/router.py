from datetime import UTC, datetime

from fastapi import APIRouter

from ...config import get_settings
from .analytics import router as analytics_router
from .documents import router as documents_router
from .ml import router as ml_router

router = APIRouter()


@router.get("/version")
def version() -> dict:
    settings = get_settings()
    return {
        "service": settings.service_name,
        "version": "0.1.0",
        "timezone": settings.app_timezone,
        "utcNow": datetime.now(UTC).isoformat(),
    }


router.include_router(analytics_router)
router.include_router(ml_router)
router.include_router(documents_router)
