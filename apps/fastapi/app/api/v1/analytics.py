"""Analytics endpoints: read-only trends and operational overview.

All endpoints require the internal service token (see app/security.py) and
aggregate live from the shared `hims` database.
"""

from typing import Annotated, Literal

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query

from ... import analytics
from ...analytics import METRIC_FUNCS, METRIC_LABELS
from ...db import get_conn
from ...security import InternalAuth

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])

MetricName = Literal[
    "registrations", "revenue", "admissions", "attendance", "lab_requests", "dispensations"
]

Conn = Annotated[asyncpg.Connection, Depends(get_conn)]


@router.get("/overview")
async def overview(
    _auth: InternalAuth,
    conn: Conn,
    days: Annotated[int, Query(ge=1, le=365)] = 30,
) -> dict:
    """Operational KPIs plus daily trends for the last `days`."""
    return await analytics.overview(conn, days)


@router.get("/trends/{metric}")
async def trends(
    metric: MetricName,
    _auth: InternalAuth,
    conn: Conn,
    start: Annotated[str, Query(description="Inclusive YYYY-MM-DD")],
    end: Annotated[str, Query(description="Inclusive YYYY-MM-DD")],
) -> dict:
    """Daily series for one metric within [start, end] (inclusive)."""
    if metric not in METRIC_FUNCS:
        raise HTTPException(status_code=404, detail={"code": "unknown_metric", "message": f"unknown metric: {metric}"})
    if start > end:
        raise HTTPException(status_code=400, detail={"code": "invalid_range", "message": "start must be on or before end"})
    rows = await METRIC_FUNCS[metric](conn, start, end)
    return {
        "metric": metric,
        "label": METRIC_LABELS[metric],
        "start": start,
        "end": end,
        "points": rows,
    }
