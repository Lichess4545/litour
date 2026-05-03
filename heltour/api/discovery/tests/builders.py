"""Test data builders for discovery-domain tests.

Discovery composes over Season + League — we don't need rounds or
pairings for most coverage, so the builders are deliberately thinner
than `round_management/tests/builders.py`.
"""

from __future__ import annotations

from datetime import datetime, timezone

from heltour.tournament.models import League, Round, Season


def make_season(
    *,
    league_tag: str,
    league_name: str | None = None,
    season_tag: str = "s1",
    season_name: str | None = None,
    competitor_type: str = "team",
    pairing_type: str = "swiss-dutch",
    rating_type: str = "classical",
    time_control: str = "45+45",
    rounds: int = 8,
    boards: int | None = 8,
    is_active: bool = True,
    is_completed: bool = False,
    visibility: str = "public",
    registration_open: bool = False,
    start_date: datetime | None = None,
) -> Season:
    """Build a Season + League pair for discovery tests.

    Defaults reproduce the canonical "Team Swiss · 8 rounds" shape that
    the home page expects. ``visibility`` lets each test exercise the
    public/unlisted/draft matrix.
    """

    league = League.objects.create(
        name=league_name or f"League {league_tag}",
        tag=league_tag,
        competitor_type=competitor_type,
        pairing_type=pairing_type,
        rating_type=rating_type,
        time_control=time_control,
    )
    season = Season.objects.create(
        league=league,
        name=season_name or f"Season {season_tag}",
        tag=season_tag,
        rounds=rounds,
        boards=boards,
        is_active=is_active,
        is_completed=is_completed,
        visibility=visibility,
        registration_open=registration_open,
        start_date=start_date,
    )
    return season


def publish_round(season: Season, number: int) -> Round:
    """Mark a single Round as published (used to drive `Round N of M`)."""

    rnd = Round.objects.get(season=season, number=number)
    rnd.publish_pairings = True
    rnd.save()
    return rnd


def utc(year: int, month: int, day: int) -> datetime:
    return datetime(year, month, day, 11, 0, tzinfo=timezone.utc)
