import logging
import time
import uuid

from .logging import request_id_var

REQUEST_ID_HEADER = "x-request-id"

logger = logging.getLogger("fastapi.access")


class RequestIDMiddleware:
    """ASGI middleware that assigns a correlation ID, echoes it on the
    response, and emits one structured access-log line per request."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {k.decode(): v.decode() for k, v in scope.get("headers", [])}
        request_id = headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex
        token = request_id_var.set(request_id)

        status_code = 0
        start = time.perf_counter()

        async def send_wrapper(message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                raw = list(message.get("headers", []))
                raw.append((REQUEST_ID_HEADER.encode(), request_id.encode()))
                message["headers"] = raw
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            request_id_var.reset(token)

        logger.info(
            "request",
            extra={
                "method": scope["method"],
                "path": scope["path"],
                "status": status_code,
                "duration_ms": round((time.perf_counter() - start) * 1000, 1),
            },
        )
