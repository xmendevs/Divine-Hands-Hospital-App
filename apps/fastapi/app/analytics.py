"""Read-only analytics queries against the shared `hims` database.

All queries aggregate directly on the authoritative transactional tables
(patients, payments, admissions, attendance_records, lab_requests,
dispensations) — nothing is stored redundantly, so every result always
reflects current state. The Go service owns all writes; this module only
reads.
"""

from __future__ import annotations

import asyncpg

# ---------------------------------------------------------------------------
# Trends
# ---------------------------------------------------------------------------


async def daily_counts(
    conn: asyncpg.Connection,
    table: str,
    ts_column: str,
    start: str,
    end: str,
) -> list[dict]:
    """Count rows per day for a timestamp column within [start, end)."""
    rows = await conn.fetch(
        f"""
        SELECT (created_at AT TIME ZONE 'UTC')::date AS day, COUNT(*)::int AS value
        FROM {table}
        WHERE {ts_column} >= $1::date AND {ts_column} < $2::date + 1
        GROUP BY 1 ORDER BY 1
        """,
        start,
        end,
    )
    return [{"day": r["day"].isoformat(), "value": r["value"]} for r in rows]


async def daily_sums(
    conn: asyncpg.Connection,
    table: str,
    ts_column: str,
    amount_column: str,
    start: str,
    end: str,
) -> list[dict]:
    """Sum an amount column per day within [start, end)."""
    rows = await conn.fetch(
        f"""
        SELECT ({ts_column} AT TIME ZONE 'UTC')::date AS day,
               COALESCE(SUM({amount_column}), 0)::numeric AS value
        FROM {table}
        WHERE {ts_column} >= $1::date AND {ts_column} < $2::date + 1
        GROUP BY 1 ORDER BY 1
        """,
        start,
        end,
    )
    return [
        {"day": r["day"].isoformat(), "value": float(r["value"])} for r in rows
    ]


async def registrations_trend(conn: asyncpg.Connection, start: str, end: str) -> list[dict]:
    return await daily_counts(conn, "patients", "created_at", start, end)


async def revenue_trend(conn: asyncpg.Connection, start: str, end: str) -> list[dict]:
    return await daily_sums(conn, "payments", "received_at", "amount", start, end)


async def admissions_trend(conn: asyncpg.Connection, start: str, end: str) -> list[dict]:
    return await daily_counts(conn, "admissions", "admitted_at", start, end)


async def attendance_trend(conn: asyncpg.Connection, start: str, end: str) -> list[dict]:
    return await daily_counts(conn, "attendance_records", "clock_in_at", start, end)


async def lab_requests_trend(conn: asyncpg.Connection, start: str, end: str) -> list[dict]:
    return await daily_counts(conn, "lab_requests", "requested_at", start, end)


async def dispensations_trend(conn: asyncpg.Connection, start: str, end: str) -> list[dict]:
    return await daily_counts(conn, "dispensations", "created_at", start, end)


# ---------------------------------------------------------------------------
# Overview / KPIs
# ---------------------------------------------------------------------------


async def overview(conn: asyncpg.Connection, days: int = 30) -> dict:
    """High-level operational KPIs plus a daily trend for the last `days`."""
    start = str(await conn.fetchval("SELECT (CURRENT_DATE - $1::int)::text", days))
    today = str(await conn.fetchval("SELECT CURRENT_DATE::text"))

    totals: dict = {}
    row = await conn.fetchrow(
        """
        SELECT
          (SELECT COUNT(*)::int FROM patients) AS patients_total,
          (SELECT COUNT(*)::int FROM patients WHERE created_at >= CURRENT_DATE) AS patients_today,
          (SELECT COUNT(*)::int FROM admissions WHERE status = 'admitted') AS admissions_active,
          (SELECT COUNT(*)::int FROM lab_requests WHERE status <> 'cancelled' AND released_at IS NULL) AS lab_open,
          (SELECT COUNT(*)::int FROM lab_request_items WHERE result_entered_at IS NOT NULL AND result_verified_at IS NULL) AS lab_pending_verification,
          (SELECT COUNT(*)::int FROM attendance_records WHERE status = 'clocked_in') AS staff_clocked_in,
          (SELECT COUNT(*)::int FROM medicines WHERE active = TRUE) AS medicines_active,
          (SELECT COUNT(*)::int FROM medicine_batches
           WHERE status = 'active' AND quantity_on_hand > 0 AND expiry_date IS NOT NULL
             AND expiry_date <= CURRENT_DATE + INTERVAL '30 days') AS batches_expiring_30d,
          (SELECT COALESCE(SUM(amount), 0)::numeric FROM payments
           WHERE received_at >= CURRENT_DATE) AS revenue_today,
          (SELECT COALESCE(SUM(total_amount), 0)::numeric FROM invoices
           WHERE status <> 'voided') AS revenue_invoiced,
          (SELECT COALESCE(SUM(total_amount - amount_paid), 0)::numeric FROM invoices
           WHERE status IN ('issued','partially_paid')) AS revenue_outstanding
        """,
    )
    for key, value in row.items():
        totals[key] = float(value) if isinstance(value, (int, float)) else value

    return {
        "days": days,
        "totals": totals,
        "trends": {
            "registrations": await registrations_trend(conn, start, today),
            "revenue": await revenue_trend(conn, start, today),
            "admissions": await admissions_trend(conn, start, today),
            "attendance": await attendance_trend(conn, start, today),
        },
    }


# ---------------------------------------------------------------------------
# Metric registry shared by trends, ML, and export endpoints
# ---------------------------------------------------------------------------

METRIC_FUNCS: dict[str, object] = {
    "registrations": registrations_trend,
    "revenue": revenue_trend,
    "admissions": admissions_trend,
    "attendance": attendance_trend,
    "lab_requests": lab_requests_trend,
    "dispensations": dispensations_trend,
}

METRIC_LABELS: dict[str, str] = {
    "registrations": "Patient registrations",
    "revenue": "Revenue collected (NGN)",
    "admissions": "Admissions",
    "attendance": "Staff clock-ins",
    "lab_requests": "Lab requests",
    "dispensations": "Dispensations",
}


async def metric_trend(conn: asyncpg.Connection, metric: str, start: str, end: str) -> list[dict]:
    fn = METRIC_FUNCS[metric]
    return await fn(conn, start, end)
