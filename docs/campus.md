# Campus

The campus is data, not code: `src/world/scene.json` defines five buildings,
60 rooms and 120 desks, connected by an outdoor path network around a central
plaza.

| Building | Rooms | Desks | Walk from Atrium HQ |
|---|---|---|---|
| Atrium HQ | 12 | 24 | 0 s |
| Forge | 12 | 24 | 66 s |
| Observatory | 12 | 24 | 81 s |
| Library | 12 | 24 | 78 s |
| Studio | 12 | 24 | 105 s |

Walk times are calculated from the navigation graph at 1.6 m/s and exclude
elevator/stair dwell time. Reproduce with the graph in `src/sim/nav-graph.ts`.

- Walkable ground: 240 m × 240 m (collision plane).
- Plaza: 30 m diameter disc at `(4, 20)` with six lamps.
- Outdoor path nodes: 13, edges: 12.
- Props: trees and lamps are instanced; desks and chairs are `InstancedMesh`es.
- No floating props: trees sit on `y = 0`; the plaza is a thin disc above ground.

The landscape art pass (terrain detail, paving, vegetation density) is the next
visual milestone; geometry and collision are in place.
