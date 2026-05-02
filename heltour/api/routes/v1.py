from fastapi import APIRouter, HTTPException

from heltour.api.deps import in_thread
from heltour.api.schemas import CurrentRoundDTO, PairingDTO, RoundPairingsDTO

router = APIRouter()


def _round_pairings_sync(round_id: int) -> RoundPairingsDTO:
    from heltour.tournament.models import (
        LonePlayerPairing,
        Round,
        TeamPlayerPairing,
    )

    try:
        rnd = Round.objects.select_related("season__league").get(pk=round_id)
    except Round.DoesNotExist:
        raise HTTPException(status_code=404, detail="round not found")

    pairings: list[PairingDTO] = []

    team_qs = TeamPlayerPairing.objects.filter(
        team_pairing__round_id=round_id
    ).select_related("white", "black", "team_pairing")
    for tp in team_qs:
        pairings.append(
            PairingDTO(
                id=tp.pk,
                white_username=tp.white.lichess_username if tp.white else None,
                black_username=tp.black.lichess_username if tp.black else None,
                white_rating=tp.white_rating,
                black_rating=tp.black_rating,
                result=tp.result,
                game_link=tp.game_link,
                board_number=tp.board_number,
                team_pairing_id=tp.team_pairing_id,
            )
        )

    lone_qs = LonePlayerPairing.objects.filter(round_id=round_id).select_related(
        "white", "black"
    )
    for lp in lone_qs:
        pairings.append(
            PairingDTO(
                id=lp.pk,
                white_username=lp.white.lichess_username if lp.white else None,
                black_username=lp.black.lichess_username if lp.black else None,
                white_rating=lp.white_rating,
                black_rating=lp.black_rating,
                result=lp.result,
                game_link=lp.game_link,
                board_number=None,
                team_pairing_id=None,
            )
        )

    return RoundPairingsDTO(
        round_id=rnd.pk,
        round_number=rnd.number,
        season_name=rnd.season.name,
        league_tag=rnd.season.league.tag,
        is_completed=rnd.is_completed,
        pairings=pairings,
    )


def _current_round_sync(league_tag: str) -> CurrentRoundDTO:
    from heltour.tournament.models import League, Round

    try:
        league = League.objects.get(tag=league_tag)
    except League.DoesNotExist:
        raise HTTPException(status_code=404, detail="league not found")

    rnd = (
        Round.objects.filter(season__league=league, publish_pairings=True)
        .order_by("is_completed", "-number")
        .first()
    )
    if rnd is None:
        raise HTTPException(status_code=404, detail="no published round")

    return CurrentRoundDTO(
        league_tag=league.tag,
        season_name=rnd.season.name,
        round_id=rnd.pk,
        round_number=rnd.number,
    )


_NOT_FOUND_RESPONSE = {404: {"description": "Not found"}}


@router.get(
    "/rounds/{round_id}/pairings",
    response_model=RoundPairingsDTO,
    responses=_NOT_FOUND_RESPONSE,
)
async def round_pairings(round_id: int) -> RoundPairingsDTO:
    return await in_thread(_round_pairings_sync, round_id)


@router.get(
    "/leagues/{league_tag}/current-round",
    response_model=CurrentRoundDTO,
    responses=_NOT_FOUND_RESPONSE,
)
async def current_round(league_tag: str) -> CurrentRoundDTO:
    return await in_thread(_current_round_sync, league_tag)
