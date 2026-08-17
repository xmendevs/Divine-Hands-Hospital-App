"""ML insight endpoints: time-series forecast and anomaly detection.

Lightweight, dependency-free analytics over the shared `hims` database
(see app/ml.py). Read-only and advisory; never writes back.
"""

from typing import Annotated, Literal

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query

from ... import analytics, ml
from ...db import get_conn
from ...security import InternalAuth

router = APIRouter(prefix="/api/v1/ml", tags=["ml"])

MetricName = Literal["registrations", "revenue", "admissions", "attendance", "lab_requests", "dispensations"]

Conn = Annotated[asyncpg.Connection, Depends(get_conn)]


async def _series(conn: asyncpg.Connection, metric: str, days: int) -> tuple[list, list]:
    """Fetch the last `days` of daily data for a metric as (days, values)."""
    today = str(await conn.fetchval("SELECT CURRENT_DATE::text"))
    start = str(await conn.fetchval("SELECT (CURRENT_DATE - $1::int)::text", days - 1))
    rows = await analytics.METRIC_FUNCS[metric](conn, start, today)
    days_out = [r["day"] for r in rows]
    values = [float(r["value"]) for r in rows]
    return days_out, values


@router.get("/forecast")
async def forecast(
    metric: MetricName,
    _auth: InternalAuth,
    conn: Conn,
    horizon: Annotated[int, Query(ge=1, le=90)] = 7,
    days: Annotated[int, Query(ge=3, le=365, description="Trailing window of daily data")] = 60,
) -> dict:
    """Forecast the next `horizon` days for a metric from its trailing series."""
    try:
        metric_days, values = await _series(conn, metric, days)
        result = ml.forecast(metric_days, values, horizon=horizon)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"code": "invalid_request", "message": str(exc)})
    result["metric"] = metric
    return result


@router.get("/anomalies")
async def anomalies(
    metric: MetricName,
    _auth: InternalAuth,
    conn: Conn,
    window: Annotated[int, Query(ge=2, le=90, description="Trailing window for z-score baseline")] = 14,
    threshold: Annotated[float, Query(gt=0, description="Z-score threshold for flagging")] = 2.5,
    days: Annotated[int, Query(ge=3, le=365, description="Trailing window of daily data")] = 60,
) -> dict:
    """Flag days that deviate from their trailing baseline by > threshold z."""
    try:
        metric_days, values = await _series(conn, metric, days)
        result = ml.detect_anomalies(metric_days, values, window=window, threshold=threshold)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"code": "invalid_request", "message": str(exc)})
    result["metric"] = metric
    return result
