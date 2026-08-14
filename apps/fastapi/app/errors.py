import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import HTTPException as FastAPIHTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .logging import request_id_var

logger = logging.getLogger("fastapi")

_STATUS_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    422: "validation_error",
    429: "rate_limited",
    500: "internal_error",
}


def error_envelope(code: str, message: str) -> dict:
    """Standard error response format shared with the Go service."""
    return {
        "error": {
            "code": code,
            "message": message,
            "requestId": request_id_var.get() or "",
        }
    }


def register_exception_handlers(app: FastAPI) -> None:
    async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _STATUS_CODES.get(exc.status_code, "error")
        message = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return JSONResponse(status_code=exc.status_code, content=error_envelope(code, message))

    # FastAPI raises its own HTTPException subclass from route handlers, while
    # Starlette's router raises the base class for unmatched routes/methods.
    # Register for both so every HTTP error uses the shared envelope.
    app.add_exception_handler(FastAPIHTTPException, http_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)

    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=error_envelope("validation_error", "request validation failed"),
        )

    app.add_exception_handler(RequestValidationError, validation_exception_handler)

    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.error("unhandled error", exc_info=exc)
        return JSONResponse(
            status_code=500,
            content=error_envelope("internal_error", "internal server error"),
        )

    app.add_exception_handler(Exception, unhandled_exception_handler)
