"""Discovery domain permission predicates.

Plugs concrete predicates into the four-tier scaffolding from
`heltour.api.shared.permissions`. The REST routes (`routes.py`) and the
WS handlers (`ws.py`) share these predicates so the frontend can't get
different answers from the two surfaces — the API is the single
boundary, per CLAUDE.md rule 5.

Visibility rules (matches `Season.VISIBILITY_CHOICES`):

  list view (home / WS events:home):
    - public:   everyone
    - unlisted: nobody (URL-only — find via direct slug)
    - draft:    nobody on the home surface (staff find via Django admin)

  detail view (drill-in / WS events:slug:<slug>):
    - public:   everyone
    - unlisted: anyone with the slug
    - draft:    staff only (404 to anonymous)

The home surface intentionally hides drafts even from staff. Staff
discover drafts via the Django admin, not via the public-shaped surface.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from django.db.models import QuerySet

from heltour.api.shared.auth import Viewer

if TYPE_CHECKING:
    from heltour.tournament.models import Season


# ---------- Type-level predicate ---------------------------------------------


@dataclass(frozen=True)
class SeasonDiscoveryReadType:
    """Type-level: can the viewer read Seasons through the discovery surface?

    Always True — discovery is a public read surface. Per-instance and
    per-queryset filtering does the actual gating.
    """

    type_name: str = "Season"

    def can_read(self, viewer: Viewer) -> bool:
        return True

    def can_write(self, viewer: Viewer) -> bool:
        return False  # discovery is read-only — writes go through other domains.


# ---------- Instance-level predicate -----------------------------------------


@dataclass(frozen=True)
class SeasonDiscoveryReadInstance:
    """Instance-level: detail-page read decision.

    Returns False on draft + non-staff. Routes map False to a 404
    (visibility predicates leak no information about whether a draft
    exists at the URL).
    """

    type_name: str = "Season"

    def can_read(self, viewer: Viewer, season: "Season") -> bool:
        v = season.visibility
        if v == "public":
            return True
        if v == "unlisted":
            return True
        if v == "draft":
            return bool(viewer.is_staff)
        return False

    def can_write(self, viewer: Viewer, season: "Season") -> bool:
        return False


# ---------- Queryset filter (the home / WS-list shape) -----------------------


def visible_queryset(viewer: Viewer) -> QuerySet:
    """Base queryset for the discovery list surfaces (home REST + WS).

    Annotations are read by `services.status_group` / `slot_status` to
    avoid an N+1 round lookup per card.
    """

    from django.db.models import (
        DateTimeField,
        Exists,
        IntegerField,
        OuterRef,
        Q,
        Subquery,
    )

    from heltour.tournament.models import Round, Season

    rounds_for_season = Round.objects.filter(season=OuterRef("pk"))

    return (
        Season.objects.select_related("league")
        .filter(visibility="public")
        .filter(Q(is_active=True) | Q(is_completed=True))
        .annotate(
            _has_pub_round=Exists(
                rounds_for_season.filter(publish_pairings=True),
            ),
            _latest_pub_round_number=Subquery(
                rounds_for_season.filter(publish_pairings=True)
                .order_by("-number")
                .values("number")[:1],
                output_field=IntegerField(),
            ),
            _last_round_end=Subquery(
                rounds_for_season.order_by("-number").values("end_date")[:1],
                output_field=DateTimeField(),
            ),
        )
    )


# ---------- WS handshake helper ----------------------------------------------


def can_subscribe_event_slug(viewer: Viewer, season: "Season") -> bool:
    """Per-event WS handshake decision.

    Mirrors the detail-page rule so the WS upgrades succeed for the same
    slugs the HTML page renders for.
    """

    return SeasonDiscoveryReadInstance().can_read(viewer, season)


# Singleton predicates — predicates here are stateless, so module-level
# instances let routes import once and reuse. (Constructed via dataclass
# defaults; no DI seam needed unless test wiring grows.)
SEASON_READ_TYPE = SeasonDiscoveryReadType()
SEASON_READ_INSTANCE = SeasonDiscoveryReadInstance()
