"""Tournament cockpit — the running-the-tournament surface.

A clearly-bounded subfolder inside the round-management domain. Reuses
existing primitives (`MatchDTO`, `ChangePairingPermission`,
`set_match_result_sync`, `signals_pubsub`) and adds:

- `schemas.py`        — `CockpitMatchDTO(MatchDTO)`, `CockpitDTO(RoundMatchesDTO)`,
                        intervention request shapes
- `attention.py`      — `compute_attention` pure logic
- `mode.py`           — `resolve_current_round` precedence
- `service.py`        — `build_cockpit` + intervention service functions
- `routes.py`         — GET cockpit + 3 intervention POSTs
- `ws.py`             — handshake-only WS, subscribes to matches:round +
                        permissions:user

See `~/.gstack/projects/lichess4545-litour/lakin-dashboard-running-tournament-design-20260503-183528.md`
"""
