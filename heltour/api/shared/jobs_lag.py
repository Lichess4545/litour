"""Queue-health canary aggregation.

Reads recent ``JobLagSample`` rows and reduces them to the snapshot
shape the cockpit UI consumes (latest, avg, stddev, p95, max). Lives
in ``shared`` rather than under ``round_management`` because two
unrelated callers want it: the REST handler (``/v1/jobs/lag``) and
the Celery canary task (which publishes a fresh snapshot to Redis on
every sample so the cockpit WS can fan it out without polling).
"""

from __future__ import annotations

import math
from datetime import timedelta
from typing import Any

LAG_WINDOW = timedelta(hours=1)

LAG_CHANNEL = "system:queue_lag"


def _percentile(values: list[float], pct: float) -> float:
    """Linear-interpolated percentile over a small sample. Inputs must be sorted."""
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    rank = pct * (len(values) - 1)
    lo = int(rank)
    hi = min(lo + 1, len(values) - 1)
    frac = rank - lo
    return values[lo] + (values[hi] - values[lo]) * frac


def compute_lag_snapshot() -> dict[str, Any]:
    """Aggregate the last ``LAG_WINDOW`` of canary samples into the wire DTO."""
    from django.utils import timezone

    from heltour.api.shared.models import JobLagSample

    cutoff = timezone.now() - LAG_WINDOW
    rows = list(
        JobLagSample.objects.filter(requested_at__gte=cutoff)
        .order_by("-requested_at")
        .values("requested_at", "started_at", "completed_at")
    )
    if not rows:
        return {
            "samples": 0,
            "queue_lag_latest": None,
            "queue_lag_avg": None,
            "queue_lag_stddev": None,
            "queue_lag_p95": None,
            "queue_lag_max": None,
            "last_observed_at": None,
        }
    queue_lags = [(r["started_at"] - r["requested_at"]).total_seconds() for r in rows]
    latest = queue_lags[0]
    avg = sum(queue_lags) / len(queue_lags)
    if len(queue_lags) >= 2:
        variance = sum((x - avg) ** 2 for x in queue_lags) / (len(queue_lags) - 1)
        stddev: float | None = math.sqrt(variance)
    else:
        stddev = None
    sorted_lags = sorted(queue_lags)
    return {
        "samples": len(rows),
        "queue_lag_latest": latest,
        "queue_lag_avg": avg,
        "queue_lag_stddev": stddev,
        "queue_lag_p95": _percentile(sorted_lags, 0.95),
        "queue_lag_max": sorted_lags[-1],
        "last_observed_at": rows[0]["requested_at"].isoformat(),
    }
