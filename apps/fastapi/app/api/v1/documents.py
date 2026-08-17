"""Document generation endpoints: printable HTML report and CSV export.

Read-only: the report/export are computed live from the shared database and
never mutate it.
"""

from typing import Annotated, Literal

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, PlainTextResponse

from ... import analytics, documents
from ...db import get_conn
from ...security import InternalAuth

router = APIRouter(prefix="/api/v1/documents", tags=["documents"])

MetricName = Literal["registrations", "revenue", "admissions", "attendance", "lab_requests", "dispensations"]

Conn = Annotated[asyncpg.Connection, Depends(get_conn)]


@router.get("/report", response_class=HTMLResponse)
async def report(
    _auth: InternalAuth,
    conn: Conn,
    days: Annotated[int, Query(ge=1, le=365)] = 30,
    metric: MetricName = "revenue",
    start: Annotated[str | None, Query(description="Inclusive YYYY-MM-DD")] = None,
    end: Annotated[str | None, Query(description="Inclusive YYYY-MM-DD")] = None,
) -> str:
    """Self-contained printable HTML summary report (KPIs + a metric trend)."""
    if start is not None and end is not None and start > end:
        raise HTTPException(status_code=400, detail={"code": "invalid_range", "message": "start must be on or before end"})
    if start is not None and end is not None:
        trend_rows = await analytics.METRIC_FUNCS[metric](conn, start, end)
        metric_days = [r["day"] for r in trend_rows]
        metric_values = [float(r["value"]) for r in trend_rows]
        overview_data = await analytics.overview(conn, days)
    else:
        overview_data = await analytics.overview(conn, days)
        today = str(await conn.fetchval("SELECT CURRENT_DATE::text"))
        trend_rows = await analytics.METRIC_FUNCS[metric](
            conn,
            str(await conn.fetchval("SELECT (CURRENT_DATE - $1::int)::text", days)),
            today,
        )
        metric_days = [r["day"] for r in trend_rows]
        metric_values = [float(r["value"]) for r in trend_rows]
    return documents.render_html_report(
        overview=overview_data,
        trend={"points": trend_rows},
        metric_label=analytics.METRIC_LABELS[metric],
        metric_days=metric_days,
        metric_values=metric_values,
    )


@router.get("/export", response_class=PlainTextResponse)
async def export_csv(
    metric: MetricName,
    _auth: InternalAuth,
    conn: Conn,
    start: Annotated[str, Query(description="Inclusive YYYY-MM-DD")],
    end: Annotated[str, Query(description="Inclusive YYYY-MM-DD")],
) -> str:
    """CSV export (date, value) for one metric within [start, end]."""
    if start > end:
        raise HTTPException(status_code=400, detail={"code": "invalid_range", "message": "start must be on or before end"})
    rows = await analytics.METRIC_FUNCS[metric](conn, start, end)
    days = [r["day"] for r in rows]
    values = [float(r["value"]) for r in rows]
    return documents.render_export_csv(days, values, metric)
