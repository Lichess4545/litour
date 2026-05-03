# TODOS

Deferred work captured during planning. Each entry includes context
sufficient for someone picking it up months later.

## Discovery domain (branch: lakin/basic-new-nav and follow-ups)

### Initial-join race on /ws/discovery/home

**What:** Add a last-event-id (or server cursor) contract on
`/ws/discovery/home` so that on reconnect or initial subscribe the
server can replay any lifecycle envelopes the client may have missed
between snapshot read and subscribe.

**Why:** Today the home page does a REST snapshot then opens the WS.
Envelopes published in that window can be missed or duplicated.
Invisible at single-digit Season counts and short sessions; surfaces
when concurrent active Seasons grow or a long-open page rides through
multiple status transitions.

**Pros:** Eliminates a subtle staleness class; sets up the same
mechanism for any future channel that needs replay.

**Cons:** Adds server cursor management and a small replay buffer.
Real complexity for an effect that's invisible today.

**Context:** Discovery domain plan `~/.gstack/projects/lichess4545-litour/lakin-lakin-basic-new-nav-design-*.md`
Open Question 1 region. The doc explicitly defers this. The fix
threads through `discovery/ws.py` (initial-join handler) and the
publishers in `signals_pubsub.py` (must include monotonic envelope
ids).

**Trigger:** When concurrent active Seasons exceeds ~10 OR
session-length-multiplied-by-transition-rate makes the race
empirically observable.

**Depends on / blocked by:** Nothing — can land independently.

---

### Per-event WS close on Season hard-delete

**What:** When `Season.post_delete` fires, publish a second envelope
on `events:slug:<slug>` (`event.removed` shape) and have
`/ws/discovery/events/{slug}` catch it and close the connection with
WS close code 4410 (Gone). Today only `events:home` gets the removal
envelope; per-event subscribers keep listening on a dead Redis channel
until the user navigates away.

**Why:** Closes the lifecycle loop on Season deletion. Without it,
clients accumulate idle WS connections to deleted Seasons over long
sessions.

**Pros:** Symmetric with the `events:home` removal envelope. Honors
"systems over heroes" — doesn't rely on users refreshing.

**Cons:** Slight increase in publisher and WS-handler surface area.

**Context:** Discovery domain plan, "Real-time strategy" and
"Data flow diagram" sections. The post_delete handler the plan adds
is currently single-channel; this TODO extends it.

**Trigger:** When Season hard-delete is observed in production OR
WS connection counts become a problem.

**Depends on / blocked by:** The post_delete handler from the plan
must already exist (it does, by design).

---

### Save-vs-change guards on signal publishers

**What:** Add initial-vs-current value guards to the Season / Round /
Registration / SeasonPlayer post_save handlers in
`heltour/tournament/signals_pubsub.py`, mirroring the existing
`_emit_match` "only emit when something visible changed" pattern.
Today the discovery domain's publishers fire on every save by
deliberate decision (see plan, "Save-vs-change guards: explicitly
omitted").

**Why:** At single-digit Seasons the noise is invisible. At higher
scale, every admin edit (including unrelated fields like
`welcome_message`) fans out to every home subscriber. Wasted
bandwidth and visible UI churn.

**Pros:** Aligns the discovery publishers with the project's existing
pattern. Saves bandwidth at scale.

**Cons:** Each guard is bespoke per signal — small but real
implementation cost. The matching `initial_*` fields must be tracked
on the model (Season already does this for several fields in
`__init__`).

**Context:** Discovery domain plan, "Real-time strategy" section's
"Save-vs-change guards: explicitly omitted" paragraph. The pattern to
mirror is in `heltour/tournament/signals_pubsub.py:_emit_match`.

**Trigger:** When concurrent active Seasons exceeds ~20 OR
active home subscribers exceeds ~50 (whichever lands first).

**Depends on / blocked by:** Nothing — incremental refinement.
