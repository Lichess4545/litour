"""
Utility functions for tournament tests.
"""

from django.conf import settings


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

