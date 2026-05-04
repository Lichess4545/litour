"""REST routes for the discovery domain.

The home page (`/v2/`) consumes ``GET /v1/discovery/events``.
The drill-in page consumes ``GET /v1/discovery/events/<slug>``.

Both endpoints are anonymous-allowed: discovery is a public read surface.
The only auth use is ``viewer.is_staff`` for draft visibility on the
detail endpoint. Per-instance / per-queryset visibility filtering lives
in `discovery.permissions`; routes only translate viewer + query params
into service calls and map None to 404.
"""

from __future__ import annotations

import re
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from heltour.api.deps import in_thread
from heltour.api.discovery.schemas import EventCardsPage, EventDetailDTO
from heltour.api.discovery.services import get_event_with_tabs, list_events
from heltour.api.shared.auth import Viewer, get_viewer, get_viewer_and_user

_ORG_TAG_RE = re.compile(r"^[-a-zA-Z0-9_]+$")

router = APIRouter()


# Discovery slugs are slugify(league.tag + season.tag + season.id), so they can
# run a bit longer than the typical SLUG_PATTERN cap (max=64 in shared/paths).
# 100 here mirrors the model field max_length.
EventSlugPath = Annotated[
    str,
    Path(pattern=r"^[-a-zA-Z0-9_]+$", max_length=100, min_length=1),
]


StatusQuery = Annotated[
    list[Literal["active", "upcoming", "awaiting", "completed"]] | None,
    Query(
        description=(
            "Status group filter, repeatable. Default (when omitted) is "
            "active + upcoming + awaiting; completed requires an explicit "
            "?status=completed."
        ),
    ),
]
OrganizerQuery = Annotated[
    list[str] | None,
    Query(
        alias="organizer",
        description=(
            "Organizer filter by tag (formerly League.tag), repeatable. "
            "Omitted = all organizers. Each tag must match "
            "[-a-zA-Z0-9_]+ (max 64 chars)."
        ),
    ),
]


def _validate_organizer_tags(tags: list[str] | None) -> list[str] | None:
    if not tags:
        return tags
    for t in tags:
        if not isinstance(t, str) or len(t) == 0 or len(t) > 64 or not _ORG_TAG_RE.match(t):
            raise HTTPException(status_code=422, detail="invalid organizer tag")
    return tags


LimitQuery = Annotated[int, Query(ge=1, le=100)]
# Cap offset at a realistic ceiling — without an upper bound, schemathesis
# (and unfriendly clients) can push it past Postgres BIGINT and trip a 500
# from the OFFSET clause. A billion is many orders of magnitude above any
# real paging need; rejecting with 422 keeps the surface predictable.
OffsetQuery = Annotated[int, Query(ge=0, le=1_000_000_000)]


@router.get(
    "/discovery/events",
    response_model=EventCardsPage,
    summary="List discoverable events.",
)
async def list_events_route(
    viewer: Annotated[Viewer, Depends(get_viewer)],
    status: StatusQuery = None,
    organizer: OrganizerQuery = None,
    limit: LimitQuery = 20,
    offset: OffsetQuery = 0,
) -> EventCardsPage:
    organizer = _validate_organizer_tags(organizer)
    return await in_thread(
        list_events,
        viewer,
        status=status,
        organizer_tags=organizer,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/discovery/events/{slug}",
    response_model=EventDetailDTO,
    responses={404: {"description": "Not found."}},
    summary="Event detail (header + composed pairings + tab availability).",
)
async def event_detail_route(
    slug: EventSlugPath,
    viewer_and_user: Annotated[tuple[Viewer, object | None], Depends(get_viewer_and_user)],
) -> EventDetailDTO:
    viewer, user = viewer_and_user
    detail = await in_thread(get_event_with_tabs, slug, viewer, user)
    if detail is None:
        # 404 covers both "no such slug" and "slug exists but you can't see it"
        # so visibility predicates leak no information about draft existence.
        raise HTTPException(status_code=404, detail="event not found")
    return detail
