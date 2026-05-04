"""Mint a Django session for schemathesis to run authenticated.

Used by `inv preflight` to swap in a `Cookie: sessionid=...` header so
the contract tests exercise 200 / 422 response shapes, not just the 401
paths. Idempotent: ensures a `schemathesis` superuser exists, then
creates and prints a fresh session key.

Output is the bare session key on stdout — designed for shell capture.
"""

from __future__ import annotations

from django.contrib.auth.models import User
from django.contrib.sessions.backends.db import SessionStore
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Print a fresh sessionid for the schemathesis test user."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--username",
            default="schemathesis",
            help="Username to mint the session for (created if missing).",
        )

    def handle(self, *args, **options) -> None:
        username = options["username"]
        user, _created = User.objects.get_or_create(
            username=username,
            defaults={
                "is_staff": True,
                "is_superuser": True,
                "is_active": True,
                "email": f"{username}@invalid.local",
            },
        )
        if not (user.is_active and user.is_staff and user.is_superuser):
            user.is_active = True
            user.is_staff = True
            user.is_superuser = True
            user.save(update_fields=["is_active", "is_staff", "is_superuser"])
        if not user.has_usable_password():
            user.set_unusable_password()
            user.save(update_fields=["password"])

        session = SessionStore()
        session["_auth_user_id"] = str(user.pk)
        session["_auth_user_backend"] = "django.contrib.auth.backends.ModelBackend"
        session["_auth_user_hash"] = user.get_session_auth_hash()
        session.create()
        self.stdout.write(session.session_key or "")
