"""Pure-Python services for the discovery domain.

Composition layer above the existing domains: `event_setup`,
`registration`, `roster_formation`, `round_management`, `standings`. None
of those import from here. The screaming-architecture invariant points
the dependency arrow into discovery, never out of it.

Functions here take primitives or ORM instances and return DTOs. The
FastAPI route layer (`routes.py`) wires viewer auth + visibility filtering
on top via the shared/permissions tier; signals_pubsub (`tournament/`)
wires real-time pubsub on top of the same data.
"""

from __future__ import annotations

import logging
from typing import Iterable

from django.db.models import Q, QuerySet

from heltour.api.discovery.permissions import (
    SEASON_READ_INSTANCE,
    visible_queryset,
)
from heltour.api.discovery.schemas import (
    EventCardDTO,
    EventCardsPage,
    EventDetailDTO,
    EventHeaderDTO,
    StatusGroup,
    StatusLabel,
    Visibility,
)
from heltour.api.shared.auth import Viewer

logger = logging.getLogger("heltour.api.discovery")


# ---------- Status mapping ----------------------------------------------------

_STATUS_LABELS: dict[StatusGroup, StatusLabel] = {
    "active": "Now playing",
    "upcoming": "Open",
    "awaiting": "Awaiting results",
    "completed": "Finished",
}


def status_group(season) -> StatusGroup:
    if season.is_completed:
        return "completed"
    if _last_round_ended(season):
        return "awaiting"
    if _has_published_round(season):
        return "active"
    return "upcoming"


def _has_published_round(season) -> bool:
    if hasattr(season, "_has_pub_round"):
        return bool(season._has_pub_round)
    from heltour.tournament.models import Round

    return Round.objects.filter(season=season, publish_pairings=True).exists()


def _last_round_ended(season) -> bool:
    """Has the schedule's final round end_date passed?"""

    from django.utils import timezone

    if hasattr(season, "_last_round_end"):
        cached: object = season._last_round_end
        if cached is None:
            return False
        return cached < timezone.now()  # type: ignore[operator]
    from heltour.tournament.models import Round

    last_end = (
        Round.objects.filter(season=season)
        .order_by("-number")
        .values_list("end_date", flat=True)
        .first()
    )
    if last_end is None:
        return False
    return last_end < timezone.now()


def _latest_published_round_number(season) -> int | None:
    if hasattr(season, "_latest_pub_round_number"):
        cached = season._latest_pub_round_number
        return cached if cached is None else int(cached)
    from heltour.tournament.models import Round

    return (
        Round.objects.filter(season=season, publish_pairings=True)
        .order_by("-number")
        .values_list("number", flat=True)
        .first()
    )


def status_label(group: StatusGroup) -> StatusLabel:
    return _STATUS_LABELS[group]


# ---------- Slug + URL helpers -----------------------------------------------


def resolve_slug(slug: str) -> object | None:
    """Look up a Season by its globally-unique discovery slug.

    Returns None on miss so callers can map to 404 / 403 as needed.
    """

    from heltour.tournament.models import Season

    return Season.objects.select_related("league").filter(slug=slug).first()


def organizer_label(season) -> str:
    """Display string for the organizer field.

    Falls back to `league.name` when the season has no explicit
    organizer override. Some seasons run under a different organizer
    than the league name suggests (cross-league events, guest hosts);
    the override on the Season model makes that one field, not a
    structural change.
    """

    override = (getattr(season, "organizer_name", "") or "").strip()
    return override or season.league.name


def organizer_tag(season) -> str:
    """Machine slug for the organizer chip filter."""

    override = (getattr(season, "organizer_tag_override", "") or "").strip()
    return override or season.league.tag


def registration_url(season) -> str:
    """URL the Register CTA links to.

    Points at the existing Django registration form (the FastAPI
    registration package is still a placeholder). Single helper so the
    swap is one-line when registration owns its own canonical URL.
    """

    return f"/{season.league.tag}/season/{season.tag}/register/"


# ---------- Composed display strings -----------------------------------------

_PAIRING_SHORT_LABELS = {
    "swiss-dutch": "Swiss",
    "swiss-dutch-baku-accel": "Swiss",
    "knockout-single": "Knockout",
    "knockout-multi": "Knockout",
}


def format_line(season) -> str:
    """e.g. 'Team Swiss · 8 rounds' or 'Individual Knockout · 5 rounds'."""

    league = season.league
    competitor = "Team" if league.competitor_type == "team" else "Individual"
    pairing = _PAIRING_SHORT_LABELS.get(league.pairing_type, league.pairing_type or "Swiss")
    rounds = f"{season.rounds} rounds"
    return f"{competitor} {pairing} · {rounds}"


def schedule_line(season) -> str:
    parts: list[str] = []
    tc = season.league.time_control.strip() if season.league.time_control else ""
    if tc:
        parts.append(tc)
    if season.start_date is not None:
        date_str = season.start_date.strftime("%b %-d")
        meridiem = season.start_date.strftime("%-I%p").lower()
        parts.append(f"{date_str}, {meridiem} UTC")
    return " · ".join(parts)


def slot_status(season) -> str:
    group = status_group(season)
    if group == "completed":
        return ""

    if group == "active" or group == "awaiting":
        latest = _latest_published_round_number(season)
        current = latest if latest is not None else 1
        return f"Round {current} of {season.rounds}"

    from heltour.tournament.models import SeasonPlayer

    count = SeasonPlayer.objects.filter(season=season, is_active=True).count()
    return f"{count} players registered"


# ---------- Card / header builders -------------------------------------------


def build_card(season) -> EventCardDTO:
    """Compose an EventCardDTO from a `select_related('league')` Season."""

    group = status_group(season)
    return EventCardDTO(
        name=season.name,
        slug=season.slug,
        status_group=group,
        status_label=status_label(group),
        organizer_label=organizer_label(season),
        organizer_tag=organizer_tag(season),
        format_line=format_line(season),
        schedule_line=schedule_line(season),
        slot_status=slot_status(season),
        registration_url=registration_url(season),
        visibility=_visibility(season),
    )


def build_header(season, *, can_manage: bool = False) -> EventHeaderDTO:
    group = status_group(season)
    return EventHeaderDTO(
        name=season.name,
        slug=season.slug,
        status_group=group,
        status_label=status_label(group),
        organizer_label=organizer_label(season),
        organizer_tag=organizer_tag(season),
        format_line=format_line(season),
        schedule_line=schedule_line(season),
        slot_status=slot_status(season),
        registration_url=registration_url(season),
        registration_open=bool(season.registration_open),
        visibility=_visibility(season),
        can_manage=can_manage,
    )


def _visibility(season) -> Visibility:
    v = season.visibility
    if v not in ("public", "unlisted", "draft"):
        # Defensive: a value outside the choice tuple should be impossible at
        # the DB layer (CharField + choices), but treat unknown as draft so
        # discovery never accidentally surfaces something it can't classify.
        logger.warning("unknown season visibility %r for slug=%s", v, season.slug)
        return "draft"
    return v


# ---------- Filtering, sorting, pagination -----------------------------------


def _apply_status_filter(qs: QuerySet, status_keys: Iterable[StatusGroup]) -> QuerySet:
    from django.utils import timezone

    keys = list(status_keys)
    if not keys:
        return qs
    now = timezone.now()
    clauses = Q()
    for key in keys:
        if key == "active":
            clauses |= Q(is_completed=False, _has_pub_round=True) & (
                Q(_last_round_end__isnull=True) | Q(_last_round_end__gte=now)
            )
        elif key == "upcoming":
            clauses |= Q(is_completed=False, _has_pub_round=False)
        elif key == "awaiting":
            clauses |= Q(is_completed=False, _last_round_end__lt=now)
        elif key == "completed":
            clauses |= Q(is_completed=True)
    return qs.filter(clauses)


def _apply_organizer_filter(qs: QuerySet, organizer_tags: Iterable[str]) -> QuerySet:
    tags = [t for t in organizer_tags if t]
    if not tags:
        return qs
    return qs.filter(league__tag__in=tags)


def _apply_default_sort(qs: QuerySet) -> QuerySet:
    """Sort by status group (active > upcoming > completed), then start_date desc.

    Ordering is enforced at the queryset level so pagination is stable
    across pages. NULL start_date sorts last within its group via
    F-expression nulls_last (Django 4.x).
    """

    from django.db.models import F

    # `_status_priority` annotation: 0 active, 1 upcoming, 2 completed.
    # Cleaner than three separate Case/When across all callers.
    from django.db.models import Case, IntegerField, Value, When

    from django.utils import timezone

    now = timezone.now()
    return qs.annotate(
        _status_priority=Case(
            When(is_completed=True, then=Value(3)),
            When(_last_round_end__lt=now, then=Value(2)),
            When(_has_pub_round=True, then=Value(0)),
            default=Value(1),
            output_field=IntegerField(),
        )
    ).order_by("_status_priority", F("start_date").desc(nulls_last=True), "-id")


def list_events(
    viewer: Viewer,
    *,
    status: Iterable[StatusGroup] | None = None,
    organizer_tags: Iterable[str] | None = None,
    limit: int = 20,
    offset: int = 0,
) -> EventCardsPage:
    """Paginated card list for /v2/.

    Default filter (when ``status`` is None) is active + upcoming only —
    completed Seasons require the explicit opt-in. The home page's calm
    posture depends on this default; otherwise the grid bloats with
    archives.
    """

    if limit < 1:
        limit = 1
    if limit > 100:
        limit = 100
    if offset < 0:
        offset = 0

    if status is None:
        status_keys: tuple[StatusGroup, ...] = ("active", "upcoming", "awaiting")
    else:
        status_keys = tuple(status)

    qs = visible_queryset(viewer)
    qs = _apply_status_filter(qs, status_keys)
    qs = _apply_organizer_filter(qs, organizer_tags or ())
    qs = _apply_default_sort(qs)

    total = qs.count()
    rows = list(qs[offset : offset + limit])
    return EventCardsPage(
        events=[build_card(s) for s in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


# ---------- Detail composition -----------------------------------------------


def get_event_with_tabs(
    slug: str, viewer: Viewer, user: object | None = None
) -> EventDetailDTO | None:
    """Build the full payload for /v2/events/<slug>/...

    Returns None when the slug doesn't resolve OR the viewer isn't
    allowed to see the resolved Season. The route layer maps None to a
    404 (visibility predicates leak no information about the difference
    between "doesn't exist" and "exists but you can't see it").

    ``user`` is the authenticated Django User (or None for anonymous);
    used to compute the per-viewer ``can_manage`` flag on the header so
    the page can render a Manage-cockpit link without a separate probe.
    """

    season = resolve_slug(slug)
    if season is None:
        return None
    if not SEASON_READ_INSTANCE.can_read(viewer, season):
        return None

    from heltour.api.round_management.permissions import can_change_pairing_sync

    can_manage = can_change_pairing_sync(user, season.league)
    header = build_header(season, can_manage=can_manage)
    tabs_available: list[str] = []

    pairings, pairings_error = _build_pairings_payload(season, viewer)
    if pairings is not None:
        tabs_available.append("pairings")

    return EventDetailDTO(
        header=header,
        tabs_available=tabs_available,
        pairings=pairings,
        pairings_error=pairings_error,
    )


def _build_pairings_payload(season, viewer: Viewer) -> tuple[dict | None, bool]:
    """Returns (payload, error). payload is None for genuine empty state
    (no round published) AND for errors; the error flag distinguishes."""

    from heltour.tournament.models import Round

    rnd = Round.objects.filter(season=season, publish_pairings=True).order_by("-number").first()
    if rnd is None:
        return None, False

    try:
        from heltour.api.round_management.service import round_matches_by_id_sync
    except ImportError:
        logger.exception("round_matches_by_id_sync unavailable")
        return None, True

    try:
        dto = round_matches_by_id_sync(rnd.pk, viewer, None)
    except Exception:
        logger.exception("failed to build pairings dto for round=%s", rnd.pk)
        return None, True

    return dto.model_dump(mode="json"), False
