from datetime import UTC, datetime

from fastapi import APIRouter

from ...config import get_settings

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
