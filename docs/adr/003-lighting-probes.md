# ADR 003 — Interior lighting: probe approximation, no realtime shadows

Status: accepted for M2 blockout.

## Context

The atrium is archviz-realistic and must stay cheap indoors: 50 agents, 10
interior floors, integrated graphics as the lower bound. Realtime shadow maps
indoors would add a shadow pass per light and flake on low-end GPUs.

## Decision

- Use a **light-probe approximation baked at scene build**: each room stores
  `{floor, window, level}` in `CampusWorld.roomProbes`. `level` combines
  window proximity and floor attenuation.
- Apply the probe to the room's emissive ceiling panel and accent floor; no
  runtime shadow maps indoors.
- Keep one global directional sun for exteriors and one point light per building
  for general fill; both are punctual, not shadow-casting.

## Consequences

- Deterministic, zero per-frame cost, consistent look across rooms.
- No dynamic shadows or agent shadows; acceptable for the blockout.
- Replacing the approximation with baked lightmaps or reflection probes later
  only touches `roomAccents` and the probe table, not gameplay code.

## Verification

- Probe table is populated for every room.
- `docs/lod.md` records the resulting budgets; `npm run perf` gates regressions.
- No `ShadowGenerator` is instantiated anywhere in `src/render`.
