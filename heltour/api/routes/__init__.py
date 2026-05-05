"""Compatibility shim. Routes live in per-domain packages:

- health -> heltour.api.shared.health
- v1     -> heltour.api.round_management.routes (round / match endpoints),
            heltour.api.event_setup.routes (current-round endpoint)
- ws     -> heltour.api.shared.ws_multiplex (single multiplexed endpoint)
"""
