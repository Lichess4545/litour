"""Pydantic DTOs for the cockpit.

Per design doc ER8 + ER12, ``CockpitMatchDTO(MatchDTO)`` and
``CockpitDTO(RoundMatchesDTO)`` extend the round-management primitives.
Both carry explicit ``ConfigDict(title=...)`` to disambiguate the OpenAPI
schema (pydantic v2 inheritance reuses the parent title by default).

``CockpitDTO`` redeclares ``matches: list[CockpitMatchDTO]`` because v2
does not auto-narrow inherited generic field types when the subclass
narrows the element type.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field

from heltour.api.round_management.schemas import (
    MatchDTO,
    RoundMatchesDTO,
    ViewerDTO,
)

CockpitMode = Literal["live", "pre_round", "history", "empty"]
AttentionLevel = Literal["none", "watch", "act"]
AttentionReasonCode = Literal[
    "no_schedule_near_deadline",
    "scheduled_but_not_started",
    "past_deadline_no_result",
]


class AttentionDTO(BaseModel):
    model_config = ConfigDict(title="CockpitAttentionDTO")

    level: AttentionLevel
    reasons: list[AttentionReasonCode]


class CockpitViewerDTO(ViewerDTO):
    """Cockpit-scoped viewer flags (DR per design doc ER3 field tier).

    Adds the per-intervention capability flags so the UI can choose which
    drawer controls to render without per-pairing roundtrips.
    """

    model_config = ConfigDict(title="CockpitViewerDTO")

    can_force_result: bool
    can_mark_forfeit: bool
    can_reschedule: bool


class CockpitMatchDTO(MatchDTO):
    model_config = ConfigDict(title="CockpitMatchDTO")

    attention: AttentionDTO
    scheduled_at: datetime | None
    version: int  # epoch ms; optimistic-concurrency token


class CockpitAuditEntryDTO(BaseModel):
    model_config = ConfigDict(title="CockpitAuditEntryDTO")

    id: int
    intervention_type: Literal["force_result", "mark_forfeit", "reschedule"]
    actor_username: str
    pairing_id: int
    before_summary: str
    after_summary: str
    reason: str
    created_at: datetime


class CockpitTokenStatusDTO(BaseModel):
    """Lichess system API token status — mirrors `lichessapi.check_system_api_token`."""

    model_config = ConfigDict(title="CockpitTokenStatusDTO")

    valid: bool
    user_id: str | None = None
    expires_at: datetime | None = None
    scopes: list[str] = Field(default_factory=list)
    error: str | None = None
    checked_at: datetime | None = None


class CockpitTokenValidationDTO(BaseModel):
    """Last-validated-tokens result — mirrors cache key `token_validation_<season>`."""

    model_config = ConfigDict(title="CockpitTokenValidationDTO")

    timestamp: str
    success: bool
    total: int
    refreshed_count: int
    failed_count: int


class CockpitMultiMatchInfoDTO(BaseModel):
    model_config = ConfigDict(title="CockpitMultiMatchInfoDTO")

    is_complete: bool
    matches_per_stage: int
    expected_team_pairs: int
    completed_team_pairs: int
    total_matches_expected: int
    total_matches_actual: int
    total_matches_completed: int
    status_message: str
    reason: str | None = None


class CockpitTiedMatchDTO(BaseModel):
    model_config = ConfigDict(title="CockpitTiedMatchDTO")

    pairing_id: int
    competitor_white: str
    competitor_black: str
    score: float
    admin_url: str


class CockpitKnockoutAdvancementDTO(BaseModel):
    model_config = ConfigDict(title="CockpitKnockoutAdvancementDTO")

    can_advance: bool
    is_final_round: bool
    can_generate_next_match_set: bool
    round_to_advance_number: int | None = None
    reason: str | None = None
    multi_match: CockpitMultiMatchInfoDTO | None = None
    tied_matches: list[CockpitTiedMatchDTO] = Field(default_factory=list)


CtaKind = Literal[
    "generate_pairings",
    "pre_round_report",
    "start_round",
    "close_round",
    "close_season",
    "review_nominations",
    "advance_tournament",
    "finalize_tournament",
    "generate_next_match_set",
    "create_missing_matches",
]


class CockpitPrimaryActionDTO(BaseModel):
    """The state-aware primary CTA shown in the header.

    `kind` is the action; `label` is the user-facing button text;
    `href` is the destination Django admin/league URL; `confirm` is an
    optional confirmation message; `secondary_*` is for the
    Pre-Round-Report-then-Start-Round paired-action layout.
    """

    model_config = ConfigDict(title="CockpitPrimaryActionDTO")

    kind: CtaKind
    label: str
    href: str
    confirm: str | None = None
    secondary_kind: CtaKind | None = None
    secondary_label: str | None = None
    secondary_href: str | None = None


class CockpitUrlsDTO(BaseModel):
    """Pre-baked Django admin / league URLs.

    Server-side construction means the client never builds these URLs
    and changes to URL patterns flow through one place. Only URLs we
    actually surface live here.
    """

    model_config = ConfigDict(title="CockpitUrlsDTO")

    league_dashboard: str
    season_admin: str
    season_create: str
    registrations: str
    mod_requests: str
    manage_players: str
    alternates: str | None
    team_composition: str | None
    team_spam: str | None
    game_ids: str
    broadcast_players: str | None
    export_trf16: str
    knockout_bracket: str | None
    review_nominations: str
    pre_round_report: str | None
    round_transition: str | None
    generate_pairings: str | None
    tournament_admin: str
    user_admin: str


class CockpitManagementDTO(BaseModel):
    """Tournament-management surface bundle.

    Carries everything the cockpit needs to render its toolbar, primary
    CTA, and footer status strip. Mirrors the data computed by
    `tournament/views.py::LeagueDashboardView._common_context`. Only
    populated when the viewer has `tournament.view_dashboard` on the
    league — non-organizers receive `None`.
    """

    model_config = ConfigDict(title="CockpitManagementDTO")

    # capability flags — drive toolbar visibility
    can_view_dashboard: bool
    can_admin_users: bool
    can_generate_pairings: bool
    can_change_season: bool

    # league-level feature flags
    is_team_league: bool
    is_knockout_tournament: bool
    require_fide_id: bool
    show_fide_names: bool

    # season state
    registration_open: bool
    season_completed: bool

    # backlog counts (used as toolbar badges)
    pending_reg_count: int
    pending_modreq_count: int
    unassigned_player_count: int
    alternate_search_count: int | None

    # operational health
    celery_down: bool
    lichess_token: CockpitTokenStatusDTO | None
    token_validation: CockpitTokenValidationDTO | None

    # round-flow context (drives primary CTA)
    primary_action: CockpitPrimaryActionDTO | None
    knockout: CockpitKnockoutAdvancementDTO | None

    # pre-baked admin URLs
    urls: CockpitUrlsDTO


ActionStatus = Literal["ok", "warning", "error"]


class CockpitActionResultDTO(BaseModel):
    """Generic result envelope for cockpit one-shot actions.

    Each route returns one of these so the UI can render a toast and
    decide whether to refetch the snapshot. ``status="warning"`` means
    the action partially succeeded (e.g. some tokens refreshed, some
    failed) and the UI should still refresh.

    When ``job_id`` is set, the action ran asynchronously via the
    background-job system; the client can subscribe to the jobs WS to
    watch progress / completion.
    """

    model_config = ConfigDict(title="CockpitActionResultDTO")

    status: ActionStatus
    title: str
    detail: str = ""
    refresh: bool = True
    job_id: int | None = None


class GeneratePairingsRequest(BaseModel):
    model_config = ConfigDict(title="CockpitGeneratePairingsRequest")

    round_id: int | None = None  # defaults to next-round-to-open
    overwrite: bool = False
    auto_assign_forfeits: bool = False
    publish_immediately: bool = False


class StartRoundRequest(BaseModel):
    model_config = ConfigDict(title="CockpitStartRoundRequest")

    round_id: int | None = None
    update_board_order: bool = False


class CloseRoundRequest(BaseModel):
    model_config = ConfigDict(title="CockpitCloseRoundRequest")

    round_id: int | None = None


class CloseSeasonRequest(BaseModel):
    model_config = ConfigDict(title="CockpitCloseSeasonRequest")

    confirm: Literal[True]


class CockpitDTO(RoundMatchesDTO):
    model_config = ConfigDict(title="CockpitDTO")

    mode: CockpitMode
    needs_you_count: int
    last_event_id: int  # for snapshot↔WS gap replay (design doc gap section)
    round_deadline: datetime | None
    matches: list[CockpitMatchDTO]
    viewer: CockpitViewerDTO
    management: CockpitManagementDTO | None = None


# ---------- Intervention request shapes -----------------------------------------


class _BaseInterventionRequest(BaseModel):
    """Shared optimistic-concurrency token + reason field."""

    expected_version: int
    reason: str = ""


class ForceResultRequest(_BaseInterventionRequest):
    model_config = ConfigDict(title="CockpitForceResultRequest")

    result: Literal["1-0", "0-1", "1/2-1/2"]


class MarkForfeitRequest(_BaseInterventionRequest):
    model_config = ConfigDict(title="CockpitMarkForfeitRequest")

    forfeit_side: Literal["white", "black", "double"]


class RescheduleRequest(_BaseInterventionRequest):
    model_config = ConfigDict(title="CockpitRescheduleRequest")

    new_scheduled_at: datetime  # UTC


# ---------- WS envelope shapes --------------------------------------------------


class WSCockpitMatchUpdate(BaseModel):
    """Enriched match update with cockpit-specific fields."""

    model_config = ConfigDict(title="WSCockpitMatchUpdate")

    type: Literal["cockpit.match.update"] = "cockpit.match.update"
    round_id: int
    match: CockpitMatchDTO
    needs_you_count: int
    last_event_id: int


class WSCockpitClose(BaseModel):
    """Sentinel pushed before the server closes (round transition / revoke).

    The actual WebSocket close follows immediately; this gives the client
    a typed signal of *why* the close is coming so the UI can show the
    right reconnect / redirect treatment.
    """

    model_config = ConfigDict(title="WSCockpitClose")

    type: Literal["cockpit.close"] = "cockpit.close"
    reason: Literal["round_transition", "permission_revoked", "round_deleted"]


WSCockpitMessage = Annotated[
    Union[WSCockpitMatchUpdate, WSCockpitClose],
    Field(discriminator="type"),
]
