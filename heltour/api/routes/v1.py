from fastapi import APIRouter, HTTPException

from heltour.api.deps import in_thread
from heltour.api.match_dto import (
    captains_for_round,
    lone_player_pairing_to_match,
    team_pairing_to_team_match,
    team_player_pairing_to_match,
)
from heltour.api.schemas import (
    CurrentRoundDTO,
    EventRoundDTO,
    EventSettingsDTO,
    MatchDTO,
    RoundMatchesDTO,
    TeamMatchDTO,
)

router = APIRouter()


def _build_round_matches(rnd) -> RoundMatchesDTO:
    """Build a RoundMatchesDTO for a Round model instance.

    Terminology note: the public API uses terms.md vocabulary. The Django
    ``Season`` model is exposed as ``event``; ``TeamPairing`` as Team Match;
    ``TeamPlayerPairing`` / ``LonePlayerPairing`` as Match (a Player Match
    inside a Team Match for the team form, a standalone Match otherwise).
    """
    from heltour.tournament.models import (
        LonePlayerPairing,
        TeamPairing,
        TeamPlayerPairing,
    )

    is_team = rnd.season.boards is not None
    league = rnd.season.league

    matches: list[MatchDTO] = []
    team_matches: list[TeamMatchDTO] = []

    if is_team:
        tp_qs = (
            TeamPairing.objects.filter(round_id=rnd.pk)
            .select_related("white_team", "black_team")
            .order_by("pairing_order")
        )
        for tm in tp_qs:
            team_matches.append(team_pairing_to_team_match(tm))

        captains = captains_for_round(rnd)
        team_player_qs = (
            TeamPlayerPairing.objects.filter(team_pairing__round_id=rnd.pk)
            .select_related("white", "black", "team_pairing")
            .order_by("team_pairing__pairing_order", "board_number")
        )
        for tp in team_player_qs:
            matches.append(team_player_pairing_to_match(tp, league, captains))
    else:
        lone_qs = (
            LonePlayerPairing.objects.filter(round_id=rnd.pk)
            .select_related("white", "black")
            .order_by("pairing_order", "id")
        )
        for lp in lone_qs:
            matches.append(lone_player_pairing_to_match(lp, league))

    return RoundMatchesDTO(
        round_id=rnd.pk,
        round_number=rnd.number,
        event_tag=rnd.season.tag,
        event_name=rnd.season.name,
        league_tag=rnd.season.league.tag,
        is_completed=rnd.is_completed,
        is_team=is_team,
        settings=_event_settings(rnd.season),
        rounds=_event_rounds(rnd.season),
        matches=matches,
        team_matches=team_matches,
    )


def _event_rounds(season) -> list[EventRoundDTO]:
    from heltour.tournament.models import Round

    rounds = Round.objects.filter(season=season).order_by("number")
    return [
        EventRoundDTO(
            round_id=r.pk,
            round_number=r.number,
            is_completed=r.is_completed,
            is_published=r.publish_pairings,
        )
        for r in rounds
    ]


def _event_settings(season) -> EventSettingsDTO:
    """Resolve the `EventSettings` for an Event (Season). Today everything
    here is sourced from the parent League; if any of these later move
    onto Season itself the resolution stays in this single function.
    """
    return EventSettingsDTO(
        use_fide_information=bool(season.league.show_fide_names),
    )


def _round_matches_by_id_sync(round_id: int) -> RoundMatchesDTO:
    from heltour.tournament.models import Round

    try:
        rnd = Round.objects.select_related("season__league").get(pk=round_id)
    except Round.DoesNotExist:
        raise HTTPException(status_code=404, detail="round not found")
    return _build_round_matches(rnd)


def _round_matches_by_slug_sync(
    league_tag: str, event_tag: str, round_number: int
) -> RoundMatchesDTO:
    from heltour.tournament.models import Round

    try:
        rnd = Round.objects.select_related("season__league").get(
            season__league__tag=league_tag,
            season__tag=event_tag,
            number=round_number,
        )
    except Round.DoesNotExist:
        raise HTTPException(status_code=404, detail="round not found")
    return _build_round_matches(rnd)


def _current_round_sync(league_tag: str) -> CurrentRoundDTO:
    from heltour.tournament.models import League, Round

    try:
        league = League.objects.get(tag=league_tag)
    except League.DoesNotExist:
        raise HTTPException(status_code=404, detail="league not found")

    rnd = (
        Round.objects.filter(season__league=league, publish_pairings=True)
        .select_related("season")
        .order_by("is_completed", "-number")
        .first()
    )
    if rnd is None:
        raise HTTPException(status_code=404, detail="no published round")

    return CurrentRoundDTO(
        league_tag=league.tag,
        event_tag=rnd.season.tag,
        event_name=rnd.season.name,
        round_id=rnd.pk,
        round_number=rnd.number,
    )


_NOT_FOUND_RESPONSE = {404: {"description": "Not found"}}


@router.get(
    "/rounds/{round_id}/matches",
    response_model=RoundMatchesDTO,
    responses=_NOT_FOUND_RESPONSE,
)
async def round_matches_by_id(round_id: int) -> RoundMatchesDTO:
    return await in_thread(_round_matches_by_id_sync, round_id)


@router.get(
    "/leagues/{league_tag}/events/{event_tag}/rounds/{round_number}/matches",
    response_model=RoundMatchesDTO,
    responses=_NOT_FOUND_RESPONSE,
)
async def round_matches_by_slug(
    league_tag: str, event_tag: str, round_number: int
) -> RoundMatchesDTO:
    return await in_thread(
        _round_matches_by_slug_sync, league_tag, event_tag, round_number
    )


@router.get(
    "/leagues/{league_tag}/current-round",
    response_model=CurrentRoundDTO,
    responses=_NOT_FOUND_RESPONSE,
)
async def current_round(league_tag: str) -> CurrentRoundDTO:
    return await in_thread(_current_round_sync, league_tag)
