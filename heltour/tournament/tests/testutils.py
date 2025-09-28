import logging

from django.conf import settings
from django.urls import reverse

from heltour.tournament.models import (
    League,
    LonePlayerScore,
    Player,
    Registration,
    Round,
    Season,
    SeasonPlayer,
    Team,
    TeamMember,
    TeamScore,
)


def set_rating(player, rating, rating_type='classical'):
    player.profile = {'perfs': {rating_type: {'rating': rating}}}


def create_reg(season, name):
    pl, _ = Player.objects.get_or_create(lichess_username=name)
    return Registration.objects.create(
        season=season,
        status="pending",
        player=pl,
        email="a@test.com",
        has_played_20_games=True,
        can_commit=True,
        agreed_to_rules=True,
        agreed_to_tos=True,
        alternate_preference="full_time",
    )


def get_valid_registration_form_data():
    """Helper to get valid form data for registration tests."""
    return {
        'agreed_to_tos': True,
        'agreed_to_rules': True,
        'can_commit': True,
        'friends': '',
        'avoid': '',
        'alternate_preference': 'full_time',
        'first_name': 'Test',
        'last_name': 'Player',
        'gender': 'male',
        'date_of_birth': '1995-06-20',
        'nationality': 'US',
        'corporate_email': 'test@company.com',
        'personal_email': '',
        'contact_number_0': 'US',
        'contact_number_1': '2015550123',
        'fide_id': '',
        'email': 'test@example.com',
        'has_played_20_games': True
    }


def league_tag(league_type):
    return '%sleague' % league_type


def season_tag(league_type):
    return '%sseason' % league_type


def league_url(league_type, page_name):
    return reverse('by_league:%s' % page_name, args=[league_tag(league_type)])


def season_url(league_type, page_name):
    return reverse('by_league:by_season:%s' % page_name,
                   args=[league_tag(league_type), season_tag(league_type)])


def get_league(league_type):
    return League.objects.get(tag='%sleague' % league_type)


def get_season(league_type):
    return Season.objects.get(tag='%sseason' % league_type)


def get_player(player_name):
    return Player.objects.get(lichess_username__iexact=player_name)


def get_round(league_type, round_number):
    return Round.objects.get(season=get_season(league_type), number=round_number)

def get_team(team_name: str) -> Team:
    return Team.objects.get(name=team_name)


def createCommonLeagueData(round_count: int = 3, team_count: int = 4) -> None:
    board_count = 2

    league = League.objects.create(name='Team League', tag=league_tag('team'),
                                   competitor_type='team',
                                   rating_type='classical')
    season = Season.objects.create(league=league, name='Test Season', tag=season_tag('team'),
                                   rounds=round_count, boards=board_count)
    league2 = League.objects.create(name='Lone League', tag=league_tag('lone'),
                                    competitor_type='lone',
                                    rating_type='classical')
    season2 = Season.objects.create(league=league2, name='Test Season', tag=season_tag('lone'),
                                    rounds=round_count)

    player_num = 1
    for n in range(1, team_count + 1):
        team = Team.objects.create(season=season, number=n, name='Team %s' % n)
        TeamScore.objects.create(team=team)
        for b in range(1, board_count + 1):
            player = Player.objects.create(lichess_username='Player%d' % player_num)
            sp = SeasonPlayer.objects.create(season=season2, player=player)
            LonePlayerScore.objects.create(season_player=sp)
            player_num += 1
            TeamMember.objects.create(team=team, player=player, board_number=b)


class Shush:
    def __enter__(self):
        logging.disable(logging.CRITICAL)
        return self

    def __exit__(self, exc_type, exc_value, exc_traceback):
        logging.disable(logging.NOTSET)
        if exc_type is not None:
            logging.getLogger(__name__).error(f"Error {exc_type}: {exc_value}")
        return True


def can_run_javafo():
    """Check if we can run JavaFo tests."""
    if not hasattr(settings, "JAVAFO_COMMAND"):
        print(
            "\nWARNING: Skipping JavaFo tests - JAVAFO_COMMAND not configured in settings"
        )
        return False
    try:
        import subprocess

        result = subprocess.run(["java", "-version"], capture_output=True)
        return result.returncode == 0
    except:
        return False
