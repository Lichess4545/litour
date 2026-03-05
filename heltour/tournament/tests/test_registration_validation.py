from django.test import TestCase

from heltour.tournament.models import (
    League,
    Player,
    Registration,
    Season,
)

NORMAL_PROFILE = {"perfs": {"classical": {"rating": 1500, "games": 100}}}
PROVISIONAL_PROFILE = {"perfs": {"classical": {"rating": 1500, "prov": True, "games": 5}}}


def _create_season(tag_prefix="val", **overrides):
    league = League.objects.create(
        name=f"{tag_prefix} League",
        tag=f"{tag_prefix}league",
        competitor_type="lone",
        rating_type="classical",
    )
    defaults = dict(
        league=league,
        name=f"{tag_prefix} Season",
        tag=f"{tag_prefix}season",
        rounds=3,
    )
    defaults.update(overrides)
    return Season.objects.create(**defaults)


def _create_player(username, account_status="normal", profile=None):
    player = Player.objects.create(
        lichess_username=username,
        account_status=account_status,
        profile=profile or NORMAL_PROFILE,
    )
    return player


def _create_reg(season, player, agreed_to_rules=True, agreed_to_tos=True, fide_id=""):
    return Registration.objects.create(
        season=season,
        status="pending",
        player=player,
        email="a@test.com",
        has_played_20_games=True,
        can_commit=True,
        agreed_to_rules=agreed_to_rules,
        agreed_to_tos=agreed_to_tos,
        alternate_preference="full_time",
        fide_id=fide_id,
    )


class ValidationOkTest(TestCase):
    def test_defaults_pass(self):
        season = _create_season()
        player = _create_player("goodplayer")
        reg = _create_reg(season, player)
        self.assertTrue(reg.validation_ok)

    def test_closed_account(self):
        season = _create_season()
        player = _create_player("closedplayer", account_status="closed")
        reg = _create_reg(season, player)
        self.assertFalse(reg.validation_ok)

    def test_zero_rating(self):
        season = _create_season()
        player = _create_player("noratingplayer", profile={"perfs": {}})
        reg = _create_reg(season, player)
        self.assertFalse(reg.validation_ok)

    def test_account_check_disabled(self):
        season = _create_season(tag_prefix="noacct", validate_account_status=False)
        player = _create_player("closedok", account_status="closed")
        reg = _create_reg(season, player)
        self.assertTrue(reg.validation_ok)

    def test_rating_check_disabled(self):
        season = _create_season(tag_prefix="norat", validate_has_rating=False)
        player = _create_player("noratok", profile={"perfs": {}})
        reg = _create_reg(season, player)
        self.assertTrue(reg.validation_ok)

    def test_all_disabled(self):
        season = _create_season(
            tag_prefix="alloff",
            validate_account_status=False,
            validate_has_rating=False,
        )
        player = _create_player("anyplayer", account_status="closed", profile={"perfs": {}})
        reg = _create_reg(season, player)
        self.assertTrue(reg.validation_ok)


class ValidationWarningTest(TestCase):
    def test_defaults_no_issues(self):
        season = _create_season(tag_prefix="wok")
        player = _create_player("cleanplayer")
        reg = _create_reg(season, player)
        self.assertFalse(reg.validation_warning)

    def test_provisional(self):
        season = _create_season(tag_prefix="wprov")
        player = _create_player("provplayer", profile=PROVISIONAL_PROFILE)
        reg = _create_reg(season, player)
        self.assertTrue(reg.validation_warning)

    def test_no_rules_agreement(self):
        season = _create_season(tag_prefix="wrule")
        player = _create_player("norules")
        reg = _create_reg(season, player, agreed_to_rules=False)
        self.assertTrue(reg.validation_warning)

    def test_no_tos_agreement(self):
        season = _create_season(tag_prefix="wtos")
        player = _create_player("notos")
        reg = _create_reg(season, player, agreed_to_tos=False)
        self.assertTrue(reg.validation_warning)

    def test_provisional_disabled(self):
        season = _create_season(tag_prefix="wnoprov", validate_not_provisional=False)
        player = _create_player("provok", profile=PROVISIONAL_PROFILE)
        reg = _create_reg(season, player)
        self.assertFalse(reg.validation_warning)

    def test_rules_disabled(self):
        season = _create_season(tag_prefix="wnorule", validate_agreed_to_rules=False)
        player = _create_player("rulesok")
        reg = _create_reg(season, player, agreed_to_rules=False)
        self.assertFalse(reg.validation_warning)

    def test_tos_disabled(self):
        season = _create_season(tag_prefix="wnotos", validate_agreed_to_tos=False)
        player = _create_player("tosok")
        reg = _create_reg(season, player, agreed_to_tos=False)
        self.assertFalse(reg.validation_warning)

    def test_all_disabled(self):
        season = _create_season(
            tag_prefix="walloff",
            validate_not_provisional=False,
            validate_agreed_to_rules=False,
            validate_agreed_to_tos=False,
        )
        player = _create_player("wallplayer", profile=PROVISIONAL_PROFILE)
        reg = _create_reg(season, player, agreed_to_rules=False, agreed_to_tos=False)
        self.assertFalse(reg.validation_warning)


class CombinedStandardAndPredefinedTest(TestCase):
    def test_standard_and_predefined_both_active(self):
        season = _create_season(
            tag_prefix="combo",
            validate_predefined_list=True,
            predefined_player_list="comboplayer,12345",
        )
        player = _create_player("comboplayer")
        reg = _create_reg(season, player, fide_id="12345")
        self.assertTrue(reg.validation_ok)
        self.assertFalse(reg.validation_warning)

    def test_predefined_fails_while_standard_passes(self):
        season = _create_season(
            tag_prefix="combofail",
            validate_predefined_list=True,
            predefined_player_list="someone_else,12345",
        )
        player = _create_player("combofailplayer")
        reg = _create_reg(season, player, fide_id="12345")
        # FIDE matches but username doesn't → validation_ok=False
        self.assertFalse(reg.validation_ok)

    def test_standard_fails_while_predefined_passes(self):
        season = _create_season(
            tag_prefix="combofail2",
            validate_predefined_list=True,
            predefined_player_list="combofail2player,12345",
        )
        player = _create_player("combofail2player", account_status="closed")
        reg = _create_reg(season, player, fide_id="12345")
        # account_status check fails → validation_ok=False
        self.assertFalse(reg.validation_ok)
