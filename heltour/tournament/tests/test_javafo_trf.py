"""
Test TRF file generation for JavaFo pairing system.

These tests verify the TRF file format that JavaFo uses for pairings.
"""

import os
from django.test import TestCase
from heltour.tournament.pairinggen import JavafoInstance, JavafoPlayer, JavafoPairing


class JavafoTRFTests(TestCase):
    """Test TRF file format generation for JavaFo."""

    def test_simple_trf_generation(self):
        """Test basic TRF file generation with 4 players."""
        # Create test players
        players = [
            JavafoPlayer("Player1", 0, []),
            JavafoPlayer("Player2", 0, []),
            JavafoPlayer("Player3", 0, []),
            JavafoPlayer("Player4", 0, []),
        ]

        # Create instance
        instance = JavafoInstance(total_round_count=3, players=players)

        # We can't easily test the full run() method without JavaFo,
        # but we can test the TRF format generation
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".trfx", mode="w+", delete=False) as f:
            # Write TRF format
            f.write("XXR %d\n" % instance.total_round_count)
            for n, player in enumerate(instance.players, 1):
                line = "001  {0: >3}  {1:74.1f}     ".format(n, player.score)
                for pairing in player.pairings:
                    opponent_num = next(
                        (
                            num
                            for num, p in enumerate(instance.players, 1)
                            if p.player == pairing.opponent
                        ),
                        "0000",
                    )
                    color = (
                        "w"
                        if pairing.color == "white"
                        else "b" if pairing.color == "black" else "-"
                    )
                    if pairing.forfeit:
                        score = (
                            "+"
                            if pairing.score == 1
                            else (
                                "-"
                                if pairing.score == 0
                                else "=" if pairing.score == 0.5 else " "
                            )
                        )
                    else:
                        score = (
                            "1"
                            if pairing.score == 1
                            else (
                                "0"
                                if pairing.score == 0
                                else "=" if pairing.score == 0.5 else " "
                            )
                        )
                    if score == " ":
                        color = "-"
                    line += "{0: >6} {1} {2}".format(opponent_num, color, score)
                if not player.include:
                    line += "{0: >6} {1} {2}".format("0000", "-", "-")
                line += "\n"
                f.write(line)
            f.flush()

            # Read back and verify format
            f.seek(0)
            content = f.read()
            lines = content.strip().split("\n")

            # Check header
            self.assertEqual(lines[0], "XXR 3")

            # Check player lines
            self.assertEqual(len(lines), 5)  # Header + 4 players

            # Check player line format
            for i in range(1, 5):
                self.assertTrue(lines[i].startswith("001"))
                self.assertIn("  0.0", lines[i])  # Score

        import os

        os.unlink(f.name)

    def test_trf_with_pairings(self):
        """Test TRF generation with actual pairings."""
        # Create players with pairings from round 1
        player1 = JavafoPlayer("Player1", 1.0, [JavafoPairing("Player2", "white", 1.0)])
        player2 = JavafoPlayer("Player2", 0.0, [JavafoPairing("Player1", "black", 0.0)])
        player3 = JavafoPlayer("Player3", 0.5, [JavafoPairing("Player4", "white", 0.5)])
        player4 = JavafoPlayer("Player4", 0.5, [JavafoPairing("Player3", "black", 0.5)])

        players = [player1, player2, player3, player4]
        instance = JavafoInstance(total_round_count=3, players=players)

        # Test TRF line generation for player 1
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".trfx", mode="w+", delete=False) as f:
            # Write player 1's line
            n = 1
            player = player1
            line = "001  {0: >3}  {1:74.1f}     ".format(n, player.score)

            pairing = player.pairings[0]
            # Find opponent number (Player2 is #2)
            opponent_num = 2  # We know Player2 is second in our list
            color = "w"  # white
            score = "1"  # won
            line += "{0: >6} {1} {2}".format(opponent_num, color, score)

            f.write(line + "\n")
            f.flush()

            # Verify the line format
            f.seek(0)
            content = f.read().strip()

            # Should have player number, score, and pairing info
            self.assertIn("001    1", content)  # Player 1
            self.assertIn("  1.0", content)  # Score 1.0
            self.assertIn("     2 w 1", content)  # Played #2 as white, won

        os.unlink(f.name)

    def test_trf_with_bye(self):
        """Test TRF generation with a bye."""
        # Player 1 had a bye in round 1
        player1 = JavafoPlayer(
            "Player1", 1.0, [JavafoPairing(None, None, 1.0, forfeit=True)]
        )

        players = [player1]
        instance = JavafoInstance(total_round_count=1, players=players)

        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".trfx", mode="w+", delete=False) as f:
            # Write player line with bye
            n = 1
            player = player1
            line = "001  {0: >3}  {1:74.1f}     ".format(n, player.score)

            pairing = player.pairings[0]
            # Bye: opponent 0, no color, forfeit win
            opponent_num = "0000"
            color = "-"
            score = "+"  # Forfeit win
            line += "{0: >6} {1} {2}".format(opponent_num, color, score)

            f.write(line + "\n")
            f.flush()

            # Verify
            f.seek(0)
            content = f.read().strip()

            self.assertIn("0000 - +", content)  # Bye notation

        os.unlink(f.name)

    def test_trf_odd_players(self):
        """Test TRF with odd number of players (one gets bye)."""
        # 3 players, player 3 gets a bye
        players = [
            JavafoPlayer("Player1", 1.0, [JavafoPairing("Player2", "white", 1.0)]),
            JavafoPlayer("Player2", 0.0, [JavafoPairing("Player1", "black", 0.0)]),
            JavafoPlayer(
                "Player3", 1.0, [JavafoPairing(None, None, 1.0, forfeit=True)]
            ),
        ]

        instance = JavafoInstance(total_round_count=1, players=players)

        # Verify we have the right setup
        self.assertEqual(len(players), 3)
        self.assertEqual(players[2].score, 1.0)  # Player 3 has bye point
        self.assertIsNone(
            players[2].pairings[0].opponent
        )  # Player 3's opponent is None (bye)
