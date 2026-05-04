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


class CockpitDTO(RoundMatchesDTO):
    model_config = ConfigDict(title="CockpitDTO")

    mode: CockpitMode
    needs_you_count: int
    last_event_id: int  # for snapshot↔WS gap replay (design doc gap section)
    round_deadline: datetime | None
    matches: list[CockpitMatchDTO]
    viewer: CockpitViewerDTO


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
