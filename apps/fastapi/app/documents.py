"""Document generation for the analytics service.

Produces printable HTML summary reports and CSV exports of analytics series.
Pure functions over plain data so they are unit-testable without a database
and without heavyweight document dependencies (matching the Go service's
dependency-light PDF/CSV approach).
"""

from __future__ import annotations

import csv
import html
import io
from datetime import UTC, datetime

from .ml import forecast as ml_forecast
from .ml import parse_day

SERVICE_NAME = "Divine Hands Hospital Analytics"


def _money(value: float) -> str:
    return f"{value:,.2f}"


def _fmt_number(value: float) -> str:
    return f"{value:,.0f}" if value == int(value) else f"{value:,.2f}"


def render_html_report(
    *,
    generated_at: datetime | None = None,
    overview: dict | None = None,
    trend: dict | None = None,
    metric_label: str = "",
    metric_days: list[str] | None = None,
    metric_values: list[float] | None = None,
) -> str:
    """Render a self-contained printable HTML report.

    Accepts an optional KPI overview and/or a single metric trend. The output
    is a standalone document with inline print styles so `window.print()` /
    the browser print dialog produces a clean page.
    """
    generated = (generated_at or datetime.now(UTC)).strftime("%Y-%m-%d %H:%M UTC")
    parts: list[str] = []

    if overview:
        totals = overview.get("totals", {})
        parts.append("<h2>Key indicators</h2><table class='kpis'>")
        rows = [
            ("Total patients", totals.get("patients_total"), "int"),
            ("Patients registered today", totals.get("patients_today"), "int"),
            ("Active admissions", totals.get("admissions_active"), "int"),
            ("Open lab requests", totals.get("lab_open"), "int"),
            ("Lab results pending verification", totals.get("lab_pending_verification"), "int"),
            ("Staff currently clocked in", totals.get("staff_clocked_in"), "int"),
            ("Active medicines", totals.get("medicines_active"), "int"),
            ("Batches expiring within 30 days", totals.get("batches_expiring_30d"), "int"),
            ("Revenue today (NGN)", totals.get("revenue_today"), "money"),
            ("Revenue invoiced (NGN)", totals.get("revenue_invoiced"), "money"),
            ("Outstanding balance (NGN)", totals.get("revenue_outstanding"), "money"),
        ]
        for label, value, kind in rows:
            if value is None:
                display = "—"
            elif kind == "money":
                display = _money(float(value))
            else:
                display = _fmt_number(float(value))
            parts.append(f"<tr><th>{html.escape(label)}</th><td>{html.escape(display)}</td></tr>")
        parts.append("</table>")

    if trend and metric_days and metric_values is not None:
        parts.append(f"<h2>{html.escape(metric_label or 'Metric trend')}</h2>")
        parts.append("<table class='trend'><thead><tr><th>Date</th><th>Value</th></tr></thead><tbody>")
        for d, v in zip(metric_days, metric_values):
            parts.append(
                f"<tr><td>{html.escape(d)}</td><td>{html.escape(_fmt_number(v))}</td></tr>"
            )
        parts.append("</tbody></table>")

        # Short forecast appendix so the report is forward-looking too.
        try:
            fc = ml_forecast([parse_day(d) for d in metric_days], metric_values, horizon=7)
            parts.append("<h3>Next 7 days (linear trend + moving average)</h3>")
            parts.append("<table class='trend'><thead><tr><th>Date</th><th>Forecast</th></tr></thead><tbody>")
            for p in fc["predicted"]:
                parts.append(f"<tr><td>{html.escape(p['date'])}</td><td>{html.escape(_fmt_number(p['value']))}</td></tr>")
            parts.append("</tbody></table>")
        except ValueError:
            pass

    body = "\n".join(parts) if parts else "<p>No data available for the selected period.</p>"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{html.escape(SERVICE_NAME)} — Report</title>
<style>
  body {{ font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f172a; margin: 2rem; }}
  h1 {{ font-size: 1.4rem; margin: 0 0 0.25rem; }}
  h2 {{ font-size: 1.15rem; margin: 1.5rem 0 0.5rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.25rem; }}
  h3 {{ font-size: 1rem; margin: 1.25rem 0 0.5rem; }}
  .meta {{ color: #64748b; font-size: 0.8rem; margin-bottom: 1rem; }}
  table {{ border-collapse: collapse; width: 100%; font-size: 0.85rem; }}
  table.kpis {{ max-width: 560px; }}
  th, td {{ border: 1px solid #e2e8f0; padding: 0.4rem 0.6rem; text-align: left; }}
  th {{ background: #f1f5f9; font-weight: 600; }}
  @media print {{
    body {{ margin: 0.5in; }}
    h2 {{ page-break-after: avoid; }}
    table {{ page-break-inside: auto; }}
  }}
</style>
</head>
<body>
<h1>{html.escape(SERVICE_NAME)}</h1>
<div class="meta">Generated {html.escape(generated)}</div>
{body}
</body>
</html>"""


def render_csv(days: list[str], values: list[float], metric_label: str = "") -> str:
    """Render a simple two-column CSV (date, value)."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(["date", metric_label or "value"])
    for d, v in zip(days, values):
        writer.writerow([d, v])
    return buf.getvalue()


def render_export_csv(days: list[str], values: list[float], metric: str) -> str:
    return render_csv(days, values, metric)
