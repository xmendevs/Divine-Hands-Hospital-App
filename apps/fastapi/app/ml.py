"""Dependency-free ML insights for the analytics service.

These are deliberately lightweight (stdlib only): simple linear-trend
forecasting with a moving-average sanity check, plus z-score based anomaly
detection on daily series. They are pure functions so they can be unit-tested
without a database and without heavy ML dependencies.

The Go core owns the transactional rules; these insights are advisory
analytics only and never write back to the shared database.
"""

from __future__ import annotations

import statistics
from datetime import UTC, date, datetime, timedelta


def _series_points(days: list[date], values: list[float]) -> list[tuple[date, float]]:
    return list(zip(days, values))


def _linear_fit(points: list[tuple[int, float]]) -> tuple[float, float, float]:
    """Least-squares fit y = slope*x + intercept over integer x indices.

    Returns (slope, intercept, r2). r2 is 1.0 for a single point (perfect
    fit by definition), which callers should treat as "insufficient data".
    """
    n = len(points)
    if n == 0:
        return 0.0, 0.0, 0.0
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    sxx = sum((x - mean_x) ** 2 for x in xs)
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    if sxx == 0:
        slope = 0.0
    else:
        slope = sxy / sxx
    intercept = mean_y - slope * mean_x

    ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys))
    ss_tot = sum((y - mean_y) ** 2 for y in ys)
    r2 = 1.0 if ss_tot == 0 else 1.0 - ss_res / ss_tot
    return slope, intercept, r2


def forecast(
    days: list[date],
    values: list[float],
    horizon: int = 7,
) -> dict:
    """Forecast the next `horizon` days from a daily series.

    Combines a least-squares linear trend with the recent moving average;
    when the series is too short or flat for a meaningful trend (r2 low or
    < 3 points) it falls back to the moving average. Returns observed points
    and predicted points with a simple residual-based interval.
    """
    if not days or not values or len(days) != len(values):
        raise ValueError("days and values must be non-empty and equal length")
    if horizon < 1 or horizon > 90:
        raise ValueError("horizon must be between 1 and 90")

    obs = _series_points(days, values)
    n = len(obs)

    # Window for the moving average: up to 7 days, clamped to series length.
    window = min(7, n)
    moving_avg = statistics.fmean(values[-window:])

    fit = _linear_fit(list(enumerate([v for _, v in obs])))
    slope, intercept, r2 = fit

    use_trend = n >= 3 and r2 >= 0.5
    if use_trend:
        # Blend the trend with the moving average so a single outlier day
        # does not dominate the projection.
        next_x = n
        trend_next = slope * next_x + intercept
        blended = 0.6 * trend_next + 0.4 * moving_avg
        # Residuals around the fitted line give a rough prediction interval.
        residual = statistics.pstdev(
            [v - (slope * i + intercept) for i, (_, v) in enumerate(obs)]
        )
    else:
        blended = moving_avg
        residual = statistics.pstdev(values) if n > 1 else 0.0

    last_day = obs[-1][0]
    predicted: list[dict] = []
    for k in range(1, horizon + 1):
        d = last_day + timedelta(days=k)
        if use_trend:
            base = 0.6 * (slope * (n - 1 + k) + intercept) + 0.4 * moving_avg
        else:
            base = blended
        value = max(0.0, base)  # counts / money cannot go negative
        spread = 1.96 * residual if residual > 0 else max(1.0, abs(value) * 0.05)
        predicted.append(
            {
                "date": d.isoformat(),
                "value": round(value, 2),
                "lower": round(max(0.0, value - spread), 2),
                "upper": round(value + spread, 2),
            }
        )

    return {
        "model": {
            "method": "linear_trend + moving_average" if use_trend else "moving_average",
            "points": n,
            "r2": round(r2, 4),
            "slope": round(slope, 4),
            "movingAverage": round(moving_avg, 2),
        },
        "observed": [
            {"date": d.isoformat(), "value": round(v, 2)} for d, v in obs
        ],
        "predicted": predicted,
    }


def detect_anomalies(
    days: list[date],
    values: list[float],
    window: int = 14,
    threshold: float = 2.5,
) -> dict:
    """Flag days whose value deviates from the trailing window by > threshold
    standard deviations (z-score). Days with no prior window or with zero
    variance are never flagged. Returns all points annotated with z-score and
    an `anomalies` list of the flagged days.
    """
    if not days or not values or len(days) != len(values):
        raise ValueError("days and values must be non-empty and equal length")
    if window < 2:
        raise ValueError("window must be at least 2")
    if threshold <= 0:
        raise ValueError("threshold must be positive")

    annotated: list[dict] = []
    flagged: list[dict] = []
    for i, (d, v) in enumerate(zip(days, values)):
        start = max(0, i - window)
        if start == i:
            # No trailing history yet.
            annotated.append({"date": d.isoformat(), "value": round(v, 2), "zScore": None, "anomaly": False})
            continue
        trail = values[start:i]
        mean = statistics.fmean(trail)
        stdev = statistics.pstdev(trail) if len(trail) > 1 else 0.0
        z = (v - mean) / stdev if stdev > 0 else 0.0
        is_anomaly = stdev > 0 and abs(z) > threshold
        annotated.append(
            {"date": d.isoformat(), "value": round(v, 2), "zScore": round(z, 3), "anomaly": is_anomaly}
        )
        if is_anomaly:
            flagged.append({"date": d.isoformat(), "value": round(v, 2), "zScore": round(z, 3)})

    return {"window": window, "threshold": threshold, "points": annotated, "anomalies": flagged}


def parse_day(value: str) -> date:
    """Parse a YYYY-MM-DD date, accepting ISO datetime strings too."""
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        raise ValueError(f"invalid date: {value!r} (expected YYYY-MM-DD)") from None


def utc_today() -> date:
    return datetime.now(UTC).date()
