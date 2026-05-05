# Architecture

Litour follows **screaming architecture** — top-level folders name chess
concepts, not technical layers. When you look at the codebase you should
immediately see *what the application does*, not *what frameworks it
uses*.

## Domains

The application is split into six chess domains. They are intentionally
loose-coupled and own their own DTOs, services, routes, and permissions:

1. **Event setup** — creating leagues, seasons, sections, schedules.
   Independent from running the event.
2. **Registration** — players (and captains) signing up. Independent
   from team formation.
3. **Roster formation** — captains form teams and rosters/lineups,
   arbiters approve them, then they're set in stone. Arbiters move
   teams/individuals between sections or remove them. Between-round
   roster changes (withdrawals, byes, late registration) live here too
   — they're a state of the same domain, not a separate concept.
4. **Round management** — pairing creation, publishing, broadcast
   creation, starting clocks, recording results, presence tracking,
   live websocket fan-out. Supports swiss / knockout / round robin etc.
5. **Final standings** — final score, prize tiebreaks, and (for staged
   tournaments) qualification for the next stage.
6. **Discovery** — the public read surface. Lists discoverable events
   on `/v2/` (home), drives the per-event detail page, and fans out
   real-time card / detail updates over `events:home` and
   `events:slug:<slug>` websocket channels.

## FastAPI layout (`heltour/api/`)

```
heltour/api/
  main.py                # mounts every domain router under /v1, plus the multiplexed /ws
  middleware.py
  deps.py                # in_thread (sync_to_async helper)
  shared/
    auth.py              # Viewer + Django session resolution
    permissions.py       # 4-tier permission protocols
    pubsub.py            # Redis subscribe helper
    paths.py             # SLUG_PATTERN, SlugPath
    health.py
    ws_multiplex.py      # the single /ws endpoint + ChannelSpec registry
    jobs.py              # @background_job decorator + JobContext (Celery-backed)
    jobs_routes.py       # /v1/jobs REST snapshot
    jobs_lag.py          # Celery queue-depth pulses (jobs:lag channel)
    ws_channels_jobs.py  # ChannelSpecs for jobs:* and jobs:lag
    models.py            # BackgroundJob + per-API helpers
  event_setup/           # Each domain owns:
    routes.py            #   - HTTP routes (thin)
    schemas.py           #   - Pydantic DTOs
    service.py           #   - sync Django-talking functions
    permissions.py       #   - domain-specific permission predicates (when needed)
    tests/
  registration/
  roster_formation/
  round_management/
    routes.py
    schemas.py
    service.py
    dto_builders.py      # DB-instance -> DTO builders
    presence.py
    permissions.py
    ws_channels.py       # ChannelSpecs registered with ws_multiplex
    cockpit/             # round-management *organizer* surface
      routes.py          #   - cockpit DTO + primary-action endpoints
      schemas.py
      service.py
      actions.py         #   - primary-action dispatch (generate pairings, close round, …)
      jobs.py            #   - @background_job-registered cockpit actions
      attention.py       #   - "needs you" detection
      mode.py            #   - live / pre_round / history mode resolution
      ws_channels.py     #   - cockpit:event:<slug>:round:<id> spec
      tests/
    tests/
      builders.py        # shared test data builders
      test_*.py          # sync-service tests (fast)
      test_permissions.py
      # HTTP-layer integration coverage runs through schemathesis at
      # preflight time, not TestClient — see test_http.py for the
      # rationale (asgiref worker thread + psycopg2 + Django teardown).
  standings/
  discovery/
    routes.py            # /v1/discovery/events[, /{slug}]
    schemas.py
    services.py
    permissions.py       # visible_queryset / can_view_season
    ws_channels.py       # discovery:home, discovery:event:<slug> ChannelSpecs
    tests/
```

Cockpit is a sub-domain of `round_management` rather than a top-level
domain because it's the organizer-facing surface of the same chess
concept (pairings + presence + interventions on a running round).

Adding a new chess domain is one `include_router(...)` line in
`main.py`.

### Routes are thin

A route validates the path, resolves the viewer, and hands off to a sync
service function via `in_thread`. Tests exercise the service directly
for speed; HTTP integration tests cover the wiring between layers.

### Dependency injection

Use simple constructor / property injection **only when it aids
testability**. The pattern: a service or permission class accepts a
callable (or a small object) as a constructor argument with a sensible
default. Tests pass a stub. Example: `ChangePairingPermission` accepts
a `has_perm_fn` so tests can swap the real Django check without
provisioning django-guardian permissions. Do **not** introduce DI
frameworks, registries, or service locators.

## Permissions

Browsers connect to a websocket on every page, so the API streams data
to many viewers and is the single boundary that decides who can see
what. Permissions are checked at four tiers, in increasing specificity:

1. **endpoint** — can the viewer call this route at all?
2. **type** — for objects of this kind, what can the viewer read/write?
3. **instance** — for *this* particular object, what can the viewer do?
4. **field** — which fields on this instance are visible / editable?

`heltour/api/shared/permissions.py` defines `PermissionContext` plus
`EndpointGuard` / `TypePermission` / `InstancePermission` /
`FieldPermission` protocols. Each domain plugs in its own predicates
in `<domain>/permissions.py`. The websocket layer uses the same
predicates as the HTTP layer; field-level redaction must happen before
the DTO is published to the channel.

## Frontend layout (`frontend/ui/src/`)

Four layers, separated by folder:

```
src/
  app/                       # 4. Pages — Next.js routes that compose layer 3
  components/
    ui/                      # 1. Raw shadcn primitives — never edit by hand
    primitives/              # 2. Design-customized primitives shared across domains
    round_management/        # 3. Domain logic components (chess-aware)
    event_setup/             #    (one folder per chess domain)
    ...
    theme/                   #    Cross-domain non-chess UI (theme provider, etc.)
  lib/                       # cross-cutting utilities, api client, scores, etc.
```

Rules:

- `components/ui/` is shadcn output — leave it untouched. Customize via
  the layers above.
- `components/primitives/` holds small visual building blocks
  (`ColorDot`, `ScorePill`, `CaptainBadge`, etc.) that more than one
  domain needs. They depend only on `ui/` and lib utilities.
- `components/<domain>/` holds the chess-aware logic components — they
  consume primitives and `ui/`, and know about DTOs.
- Pages in `app/...` compose domain components and own data fetching
  (server clients, cookies, etc.).

## Real-time updates

Every page connects a websocket so navigation and round-page features
(results, presence) update without a full reload. The publisher is
`heltour/tournament/signals_pubsub.py` (Django post_save handlers). WS
payloads are the same DTOs as the HTTP responses, so the client can
replace state with the streamed payload — no diffing, no refetch.

### One socket, many channels

The browser opens **a single multiplexed WebSocket** at `/ws` (see
`heltour/api/shared/ws_multiplex.py`). Clients send
`{"type":"subscribe","channel":"<name>"}` envelopes; the server matches
the name against a registry of `ChannelSpec` regexes that resolves
backing Redis pubsub channels, authorizes the viewer, and optionally
runs a sync transform on each envelope before forwarding it. One
client channel can fan in multiple Redis channels — e.g. the cockpit
channel composes `match.update`, `round.update`, and
`management.update` from three publishers into one stream.

The connection negotiates `permessage-deflate` (RFC 7692) so payloads
compress on the wire. The multiplex provider is mounted in the Next.js
root layout, which keeps the socket open across client-side navigation
— each domain registers its `ChannelSpec`s under
`heltour/api/<domain>/ws_channels.py` (jobs lives in
`shared/ws_channels_jobs.py`).

## Background jobs

Long-running organizer actions (generate pairings, close round, backfill
FIDE data, validate tokens, …) run as tracked background jobs, not
inline HTTP requests. The runtime lives in
`heltour/api/shared/jobs.py`:

- `@background_job(kind=…, label=…, scope=…, permission=…)` registers
  a function as a Celery task and gives it `.enqueue(user=…, season=…)`
- each invocation creates a `BackgroundJob` row (queued → running →
  ok / warning / failed) and pushes lifecycle envelopes to the
  `jobs:season:<id>` / `jobs:league:<id>` / `jobs:all` channels
- `JobContext.progress(pct, msg)` writes incremental progress that
  fans out as `job.progress` events
- the FastAPI process disables cacheops globally; the Celery worker
  bypasses it per-query via `.nocache()` so published envelopes never
  read a stale row

The cockpit's primary-action endpoints enqueue these jobs and return
the job id; the UI subscribes to the matching `jobs:*` channel and
reflects status without polling.

## Frontend state

Client state is held in a small set of Zustand stores so that any
component reading from a store stays in sync with the WebSocket-driven
updates without local prop-drilling or refetches:

- `lib/jobsStore.ts` — `bySlug` map of background jobs (the cockpit's
  jobs button + panel both consume this)
- `lib/lagStore.ts` — single global Celery queue-lag value
- `components/round_management/cockpit/cockpitStore.ts` — per-round
  cockpit DTO snapshots
- `components/round_management/matchesStore.ts` — public match-stream
  buckets per round
- `components/discovery/discoveryStore.ts` — home grid cards + per-slug
  detail

Each store exposes a `useXSync(...)` hook that owns the HTTP snapshot
fetch + WebSocket subscribe; consumers just read selectors.
