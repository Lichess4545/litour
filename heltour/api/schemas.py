from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


class MatchDTO(BaseModel):
    """A single Match. In team Events this is a Player Match (one board of a
    Team Match); in lone Events it's a standalone Match.

    ``*_username`` is the lichess handle (canonical identity, used for links
    to lichess.org/@/<handle>). ``*_fide_name`` is the player's FIDE name
    when known. ``*_rating`` is league-resolved (snapshot at game time when
    available, falling back to the player's current league rating).
    ``*_gender`` is the raw choice value (``male`` / ``female`` /
    ``non-binary`` / ``not-represented`` / ``prefer-not-disclose`` / ``""``).
    """

    id: int
    white_username: str | None
    black_username: str | None
    white_fide_name: str | None
    black_fide_name: str | None
    white_rating: int | None
    black_rating: int | None
    white_gender: str | None
    black_gender: str | None
    result: str
    game_link: str
    board_number: int | None
    team_match_id: int | None


class TeamMatchDTO(BaseModel):
    """A Team Match (Django ``TeamPairing``). Holds the two teams and the
    aggregated score; the actual board pairings (Player Matches) are in
    ``RoundMatchesDTO.matches`` linked via ``MatchDTO.team_match_id``.
    """

    id: int
    pairing_order: int
    white_team_name: str
    white_team_number: int
    black_team_name: str | None
    black_team_number: int | None
    white_score: float
    black_score: float
    is_bye: bool


class EventRoundDTO(BaseModel):
    """Summary of one round in an Event, used by the round navigator at the
    top of round-scoped pages. ``is_published`` mirrors the Django
    ``Round.publish_pairings`` flag — pairings are visible to the public
    only when this is true; the UI fades unpublished (future) rounds.
    """

    round_id: int
    round_number: int
    is_completed: bool
    is_published: bool


class EventSettingsDTO(BaseModel):
    """Display / behaviour preferences resolved for an Event (Season).

    Bag of flags rather than scattering each setting onto every DTO that
    needs them. Today a few items live on `League` (e.g. `show_fide_names`,
    `rating_type`); over time some may move to `Season`. Either way, the
    UI consumes them through this single object so callers don't need to
    track which model owns which flag.
    """

    use_fide_information: bool


class RoundMatchesDTO(BaseModel):
    round_id: int
    round_number: int
    event_tag: str
    event_name: str
    league_tag: str
    is_completed: bool
    is_team: bool
    settings: EventSettingsDTO
    # All rounds in the Event, ordered by `round_number`. Used by the round
    # navigator so callers don't need a second request to render it.
    rounds: list[EventRoundDTO]
    matches: list[MatchDTO]
    team_matches: list[TeamMatchDTO]


class CurrentRoundDTO(BaseModel):
    league_tag: str
    event_tag: str
    event_name: str
    round_id: int
    round_number: int


class _WSMatchBase(BaseModel):
    match_id: int
    round_id: int
    result: str
    game_link: str
    white_username: str | None
    black_username: str | None


class WSMatchResultUpdate(_WSMatchBase):
    type: Literal["match.result"] = "match.result"


class WSMatchGameLinkUpdate(_WSMatchBase):
    type: Literal["match.game_link"] = "match.game_link"


class WSPing(BaseModel):
    type: Literal["ping"] = "ping"


WSMessage = Annotated[
    Union[WSMatchResultUpdate, WSMatchGameLinkUpdate, WSPing],
    Field(discriminator="type"),
]
