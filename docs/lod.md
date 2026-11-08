# LOD and culling

## Avatars

| Distance | Detail |
|---|---|
| < 32 m | full: body, head, arms, legs, status ring, beacon |
| 32–55 m | body + legs + arms, beacon/ring |
| 55–90 m | body only |
| > 90 m | disabled |

Gait frequency follows real movement speed (`src/render/avatar-layer.ts`), so
the swing does not slide when walking or sprinting.

## Buildings and rooms

- Room-portal culling (`CampusWorld.updateCulling`): the current room plus rooms
  whose door is within 16/22/30 m (low/medium/high quality) and ahead of the
  camera stay visible. All other room groups (walls, accents, ceilings, lights,
  desks) are disabled.
- Outer shells, slabs and windows remain for orientation.
- Building streaming uses 70 m / 95 m hysteresis (`streamBuildings`); meshes are
  pre-built, so load/unload causes no allocation hitch and memory stays at the
  startup baseline.

## Measured effect

Reference camera path, Chromium headless (SwiftShader), 50 agents:

| Waypoint | Culled draw calls | Naive (no culling) | Drop |
|---|---|---|---|
| Plaza | 650 | 1487 | 56.3% |
| Lobby | 326 | 1480 | 78.0% |
| Office | 265 | 1456 | 81.8% |

Budgets: `perf/budget.json` (max 900 draw calls, ≥40% culling drop, 35% max
regression). Results are produced by `npm run perf`.
