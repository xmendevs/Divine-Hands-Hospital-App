"""Internal service auth for the analytics API.

The FastAPI service is not a user-facing endpoint: it is only reachable via
the Go API, which authenticates the end user (session + RBAC) and forwards the
request with the shared internal token. This module validates that token.

Every analytics/document/ML endpoint requires `Authorization: Bearer <token>`.
When `INTERNAL_TOKEN` is unset the endpoints are disabled (503) rather than
open, matching the fail-closed convention of the Go service.
"""

import hmac
from typing import Annotated

from fastapi import Depends, Header, HTTPException

from ..config import get_settings


async def require_internal_token(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    token = get_settings().internal_token
    if not token:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "internal_not_configured",
                "message": "analytics is disabled: INTERNAL_TOKEN is not set",
            },
        )
    supplied = ""
    if authorization and authorization.startswith("Bearer "):
        supplied = authorization[len("Bearer ") :]
    if not supplied or not hmac.compare_digest(supplied, token):
        raise HTTPException(
            status_code=401,
            detail={"code": "unauthorized", "message": "invalid internal token"},
        )


InternalAuth = Annotated[None, Depends(require_internal_token)]
