from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


class PairingDTO(BaseModel):
    id: int
    white_username: str | None
    black_username: str | None
    white_rating: int | None
    black_rating: int | None
    result: str
    game_link: str
    board_number: int | None
    team_pairing_id: int | None


class RoundPairingsDTO(BaseModel):
    round_id: int
    round_number: int
    season_name: str
    league_tag: str
    is_completed: bool
    pairings: list[PairingDTO]


class CurrentRoundDTO(BaseModel):
    league_tag: str
    season_name: str
    round_id: int
    round_number: int


class _WSPairingBase(BaseModel):
    pairing_id: int
    round_id: int
    result: str
    game_link: str
    white_username: str | None
    black_username: str | None


class WSPairingResultUpdate(_WSPairingBase):
    type: Literal["pairing.result"] = "pairing.result"


class WSPairingGameLinkUpdate(_WSPairingBase):
    type: Literal["pairing.game_link"] = "pairing.game_link"


class WSPing(BaseModel):
    type: Literal["ping"] = "ping"


WSMessage = Annotated[
    Union[WSPairingResultUpdate, WSPairingGameLinkUpdate, WSPing],
    Field(discriminator="type"),
]
