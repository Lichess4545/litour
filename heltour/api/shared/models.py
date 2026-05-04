"""API-side re-export of ORM models with cacheops bypassed.

Importing from here gives the API a copy of each model whose
``.objects`` is the legacy manager's ``.nocache()`` queryset. The
legacy ``heltour.tournament.models`` keeps caching for the Django/admin
side; only API call sites bypass it.

Why: cacheops's invalidation of ``select_related`` variants is not
reliably synchronous, which surfaced as BackgroundJob completion
envelopes carrying pre-completion snapshots (``status`` rolled back
from "ok" to "running" in the WS feed). The API never benefited from
that cache anyway.
"""

from __future__ import annotations

from django.contrib.auth.models import User as _User
from django.contrib.sessions.models import Session as _Session

from heltour.tournament import models as _t


def _proxy(model):
    """Return a proxy whose ``objects`` is the model's nocache queryset."""

    class M:
        objects = model.objects.nocache()
        DoesNotExist = model.DoesNotExist

    M.__name__ = M.__qualname__ = model.__name__
    return M


BackgroundJob = _proxy(_t.BackgroundJob)
CockpitAuditEntry = _proxy(_t.CockpitAuditEntry)
JobLagBucket = _proxy(_t.JobLagBucket)
JobLagSample = _proxy(_t.JobLagSample)
KnockoutBracket = _proxy(_t.KnockoutBracket)
League = _proxy(_t.League)
LonePlayerPairing = _proxy(_t.LonePlayerPairing)
ModRequest = _proxy(_t.ModRequest)
PlayerPairing = _proxy(_t.PlayerPairing)
PlayerPresenceEvent = _proxy(_t.PlayerPresenceEvent)
Registration = _proxy(_t.Registration)
Round = _proxy(_t.Round)
Season = _proxy(_t.Season)
SeasonPlayer = _proxy(_t.SeasonPlayer)
TeamMember = _proxy(_t.TeamMember)
TeamPairing = _proxy(_t.TeamPairing)
TeamPlayerPairing = _proxy(_t.TeamPlayerPairing)
Alternate = _proxy(_t.Alternate)

User = _proxy(_User)
Session = _proxy(_Session)
