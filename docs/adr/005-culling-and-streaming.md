# ADR 005 — Room-portal culling and visibility streaming

Status: accepted.

## Context

A five-building campus with 60 rooms is too much to draw per frame, especially
on integrated GPUs. Babylon frustum culling alone still draws rooms behind
walls once their bounding box enters the view frustum.

## Decision

- **Room-portal culling.** Every room owns a group of meshes (corridor walls,
  ceiling, accent, light panel, desks). A room is visible when it is the player's
  room, or its door portal is within range and in front of the camera.
- **Visibility streaming.** Whole buildings are enabled within 70 m and disabled
  beyond 95 m (hysteresis). Meshes stay allocated, so there is no load hitch and
  memory returns to the startup baseline; no per-entry allocation occurs.
- **Naive baseline.** `debugSetNaiveRendering(true)` disables culling and
  frustum selection for measurement only.

## Evidence

`npm run perf` measures culled and naive draw calls on the plaza, lobby and
office waypoints. The gate requires a ≥40% drop; the measured drop is 51–79%.
See `docs/lod.md`.

## Consequences

- Aggressive: rooms behind the camera vanish, including their interior light,
  which is invisible anyway.
- Exterior shells remain, so orientation is preserved and there is no pop when
  walking through a door (the current room is always visible).
- Streaming state and culling counts are exposed in `getDebugState()` and the
  HUD.
