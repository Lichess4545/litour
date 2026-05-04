"""DTOs for the discovery domain.

These shapes are user-facing — what /v2/ and /v2/events/<slug>/... render
from. The wire contract uses both machine and display fields for status
so the URL `?status=active` (machine) stays stable while the UI shows
"Now playing" (display label per DESIGN.md).

`organizer_label` is `Season.league.name` until an `Organizer` entity
exists; the swap point is `services.organizer_label`. The string the user
sees is always "organizer" — never "league" — per the 2026-05-03 design
decision.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


# Internal status keys — stay aligned with `Season.is_active` / `is_completed`.
StatusGroup = Literal["active", "upcoming", "awaiting", "completed"]

# Display strings come from DESIGN.md decision log: chess-native vocabulary.
StatusLabel = Literal["Now playing", "Open", "Awaiting results", "Finished"]

# Visibility states — mirror Season.VISIBILITY_CHOICES.
Visibility = Literal["public", "unlisted", "draft"]


class EventCardDTO(BaseModel):
    """The shape rendered into one card on /v2/.

    Card hierarchy (DESIGN.md): name -> status pill -> organizer label
    -> format / schedule -> slot status. Field order in this class
    matches that visual order to make the contract self-documenting.
    """

    name: str = Field(description="Tournament name (Season.name).")
    slug: str = Field(description="Globally-unique URL identifier.")
    status_group: StatusGroup = Field(
        description="Machine status key. URL filter contract: ?status=active|upcoming|completed."
    )
    status_label: StatusLabel = Field(
        description="Display string for the status pill. Chess-native per DESIGN.md."
    )
    organizer_label: str = Field(description="Organizer name shown under the tournament title.")
    organizer_tag: str = Field(
        description="Machine slug for the organizer chip filter. Currently League.tag."
    )
    format_line: str = Field(description='Composed format summary, e.g. "Team Swiss · 8 rounds".')
    schedule_line: str = Field(
        description='Composed schedule summary, e.g. "45+45 · Sundays 11am UTC". '
        "Empty string when start_date is unset."
    )
    slot_status: str = Field(
        description=(
            "Free-form status string the card renders next to the pill, e.g. "
            '"Round 4 of 8" for active events or "23 / 32 players" for open ones. '
            "Empty string for finished events."
        )
    )
    registration_url: str = Field(
        description="Absolute path that the Register CTA links to (legacy Django form)."
    )
    visibility: Visibility = Field(description="Carried for the noindex hint on detail pages.")


class EventCardsPage(BaseModel):
    """Paginated card list returned by GET /v1/discovery/events.

    `total` is the unpaginated count after filters apply, for client-side
    pagination UIs that render "Showing N of T".
    """

    events: list[EventCardDTO]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0)


class EventHeaderDTO(BaseModel):
    """Header block on /v2/events/<slug>/... (card-shaped, plus richer fields)."""

    name: str
    slug: str
    status_group: StatusGroup
    status_label: StatusLabel
    organizer_label: str
    organizer_tag: str
    format_line: str
    schedule_line: str
    slot_status: str
    registration_url: str
    registration_open: bool = Field(
        description="Whether the Register CTA should render as an active button."
    )
    visibility: Visibility
    can_manage: bool = Field(
        default=False,
        description=(
            "True when the viewer holds tournament.change_pairing on the league. "
            "Drives whether the event page renders a Manage-cockpit link. "
            "Always False on signal-pushed payloads (publishers fan out without a "
            "viewer)."
        ),
    )


class EventDetailDTO(BaseModel):
    """Full payload for GET /v1/discovery/events/<slug>.

    `tabs_available` lists the machine names of tabs whose payload is
    real (not a "Coming soon" placeholder). Frontend reads this to
    decide which tabs are interactive vs. disabled.
    """

    header: EventHeaderDTO
    tabs_available: list[Literal["pairings", "standings", "roster"]] = Field(
        description='Always at least ["pairings"] today. "standings" / "roster" '
        "join when their packages graduate from placeholder."
    )
    # Concrete pairings DTO is built lazily in service.get_event_with_tabs and
    # injected as a dict to keep this schema independent of round_management's
    # internal model. Frontend ignores extra keys.
    pairings: dict | None = Field(
        default=None,
        description=(
            "Latest published round's pairings DTO when available, or None when "
            "no round has been published yet. Shape: round_management.RoundMatchesDTO."
        ),
    )
    pairings_error: bool = Field(
        default=False,
        description=(
            "True when the pairings DTO failed to build. Distinguishes a "
            "rendered empty state ('Pairings will appear once...') from a "
            "broken backend ('Couldn't load pairings, retry')."
        ),
    )
