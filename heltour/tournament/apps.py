from django.apps import AppConfig


class TournamentConfig(AppConfig):
    name = "heltour.tournament"

    def ready(self):
        # Force-import the pubsub receivers so any Django process
        # (legacy web, management commands, Celery worker) registers
        # them at startup. Otherwise post_save → no pubsub publish, and
        # cockpit/discovery WS subscribers stay stuck on stale state
        # whenever a save happens outside the FastAPI worker.
        from . import signals_pubsub  # noqa: F401
