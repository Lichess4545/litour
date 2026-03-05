from django.test import TestCase

from heltour.tournament.models import (
    League,
    Player,
    Registration,
    Season,
    ValidationMode,
)


def _create_season(
    validation_mode=ValidationMode.STANDARD,
    predefined_player_list="",
    tag_prefix="test",
):
    league = League.objects.create(
        name=f"{tag_prefix} League",
        tag=f"{tag_prefix}league",
        competitor_type="lone",
        rating_type="classical",
    )
    return Season.objects.create(
        league=league,
        name=f"{tag_prefix} Season",
        tag=f"{tag_prefix}season",
        rounds=3,
        validation_mode=validation_mode,
        predefined_player_list=predefined_player_list,
    )


def _create_reg(season, username, fide_id=""):
    player, _ = Player.objects.get_or_create(lichess_username=username)
    return Registration.objects.create(
        season=season,
        status="pending",
        player=player,
        email="a@test.com",
        has_played_20_games=True,
        can_commit=True,
        agreed_to_rules=True,
        agreed_to_tos=True,
        alternate_preference="full_time",
        fide_id=fide_id,
    )


class PredefinedListParsingTest(TestCase):
    def test_empty_list(self):
        season = _create_season()
        self.assertEqual(season.parse_predefined_player_list(), {})

    def test_valid_lines(self):
        season = _create_season(predefined_player_list="alice,12345\nbob,67890")
        result = season.parse_predefined_player_list()
        self.assertEqual(result, {"alice": "12345", "bob": "67890"})

    def test_whitespace_and_blank_lines_skipped(self):
        season = _create_season(
            predefined_player_list="  alice , 12345 \n\n  \nbob,67890\n"
        )
        result = season.parse_predefined_player_list()
        self.assertEqual(result, {"alice": "12345", "bob": "67890"})

    def test_case_insensitive_usernames(self):
        season = _create_season(predefined_player_list="Alice,12345\nBOB,67890")
        result = season.parse_predefined_player_list()
        self.assertEqual(result, {"alice": "12345", "bob": "67890"})

    def test_fide_to_username_reverse_map(self):
        season = _create_season(predefined_player_list="alice,12345\nbob,67890")
        result = season.predefined_fide_to_username()
        self.assertEqual(result, {"12345": "alice", "67890": "bob"})


class PredefinedListValidationTest(TestCase):
    def setUp(self):
        self.season = _create_season(
            validation_mode=ValidationMode.PREDEFINED_LIST,
            predefined_player_list="player1,12345\nplayer2,67890",
        )

    def test_both_match(self):
        reg = _create_reg(self.season, "player1", fide_id="12345")
        self.assertTrue(reg.validation_ok)
        self.assertFalse(reg.validation_warning)
        check = reg.predefined_list_check()
        self.assertTrue(check.username_match)
        self.assertTrue(check.fide_match)

    def test_username_match_fide_mismatch(self):
        reg = _create_reg(self.season, "player1", fide_id="99999")
        self.assertTrue(reg.validation_ok)
        self.assertTrue(reg.validation_warning)
        check = reg.predefined_list_check()
        self.assertTrue(check.username_match)
        self.assertFalse(check.fide_match)
        self.assertIn("Known player", check.detail)

    def test_fide_match_username_mismatch(self):
        reg = _create_reg(self.season, "unknown_player", fide_id="12345")
        self.assertFalse(reg.validation_ok)
        self.assertFalse(reg.validation_warning)
        check = reg.predefined_list_check()
        self.assertFalse(check.username_match)
        self.assertTrue(check.fide_match)
        self.assertIn("belongs to player1", check.detail)

    def test_neither_match(self):
        reg = _create_reg(self.season, "unknown_player", fide_id="99999")
        self.assertTrue(reg.validation_ok)
        self.assertTrue(reg.validation_warning)
        check = reg.predefined_list_check()
        self.assertFalse(check.username_match)
        self.assertFalse(check.fide_match)
        self.assertIn("Not in predefined list", check.detail)

    def test_standard_mode_unchanged(self):
        season = _create_season(
            validation_mode=ValidationMode.STANDARD,
            predefined_player_list="player1,12345",
            tag_prefix="std",
        )
        reg = _create_reg(season, "stdplayer", fide_id="99999")
        # Standard mode: validation_ok depends on rating and account status
        # Player has no profile so rating=0 → validation_ok=False
        self.assertFalse(reg.validation_ok)
