# Changelog

All notable changes are documented here. Format: Keep a Changelog, semantic
versioning.

## [0.1.0] — 2026-11-08

### Added

- Babylon.js first-person campus with five two-storey buildings, 120 desks,
  rooms, stairs, plaza and outdoor paths.
- Deterministic 30 Hz simulation with seeded RNG, desk assignment, waypoint
  navigation, walking agents and life-cycle states.
- `AgentState` v1 contract, JSON Schema and validation.
- Collector with fake and live sources, Ananta hub adapter (`/api/sessions`,
  `/api/tasks`), llama.cpp `/slots` throughput adapter, `/health`, WebSocket
  snapshot/delta stream, spectator revocation and JSON logging.
- Client WebSocket layer with exponential backoff and labelled 2 s fake fallback.
- Procedural avatars with gait, typing, beacons, status rings and distance LOD.
- Room-portal culling, building visibility streaming, light-probe interior
  approximation and procedural sky.
- Main menu, Ananta connect flow, settings and persistence, agent list with
  filters, minimap, replay recorder/scrubber, spectator mode, touch controls,
  German/English localisation, reduced motion and colour-blind-safe palette.
- Procedural audio (ambience, footsteps, status cues) with independent volumes.
- Performance harness with committed baseline and CI regression budgets.
- CI, perf and release workflows; BSD-3-Clause licence, attribution and contributor docs.
