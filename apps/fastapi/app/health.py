import socket
from datetime import UTC, datetime

from fastapi import APIRouter, Response

from .config import get_settings

router = APIRouter()


@router.get("/health")
def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.service_name,
        "time": datetime.now(UTC).isoformat(),
    }


def _tcp_check(host: str, port: int, timeout: float = 2.0) -> dict:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return {"status": "ok"}
    except OSError as exc:  # pragma: no cover - depends on environment
        return {"status": "error", "error": str(exc)}


@router.get("/ready")
def ready(response: Response) -> dict:
    settings = get_settings()
    checks = {
        "postgres": _tcp_check(settings.postgres_host, settings.postgres_port),
        "redis": _tcp_check(settings.redis_host, settings.redis_port),
    }
    is_ready = all(c["status"] == "ok" for c in checks.values())
    if not is_ready:
        response.status_code = 503
    return {"status": "ready" if is_ready else "not_ready", "checks": checks}
