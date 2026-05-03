from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


class MatchDTO(BaseModel):
    """A single Match. In team Events this is a Player Match (one board of a
    Team Match); in lone Events it's a standalone Match.
    """

    id: int
    white_username: str | None
    black_username: str | None
    white_rating: int | None
    black_rating: int | None
    result: str
    game_link: str
    board_number: int | None
    team_match_id: int | None


class RoundMatchesDTO(BaseModel):
    round_id: int
    round_number: int
    event_tag: str
    event_name: str
    league_tag: str
    is_completed: bool
    matches: list[MatchDTO]


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
