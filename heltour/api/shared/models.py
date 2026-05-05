"""API-side re-export of ORM models.

The FastAPI worker disables cacheops globally (see
``heltour/api/main.py``: ``LITOUR_CACHEOPS_DISABLED=1`` →
``settings.CACHEOPS_ENABLED = False``), so these are just thin
re-exports of the legacy models with no per-call ``.nocache()``
gymnastics. Importing from here keeps API call sites pinned to a
single namespace and makes it easy to grep for "API ORM access" if we
ever need to revisit the caching policy.

The legacy Django web/admin side still uses cacheops. Don't import
from this module on that side — go straight to ``heltour.tournament.models``.
"""

from __future__ import annotations

from django.contrib.auth.models import User as _User  # noqa: F401
from django.contrib.sessions.models import Session as _Session  # noqa: F401

from heltour.tournament.models import (  # noqa: F401
    Alternate,
    BackgroundJob,
    CockpitAuditEntry,
    JobLagBucket,
    JobLagSample,
    KnockoutBracket,
    League,
    LonePlayerPairing,
    ModRequest,
    PlayerPairing,
    PlayerPresenceEvent,
    Registration,
    Round,
    Season,
    SeasonPlayer,
    TeamMember,
    TeamPairing,
    TeamPlayerPairing,
)

User = _User
Session = _Session
