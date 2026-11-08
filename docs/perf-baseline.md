# Performance baseline

Reference scene: five-building campus, 120 desks, 50 agents, default spawn and
the `perf-check` camera waypoints. Method: `npm run perf` (two runs, twelve
samples per waypoint, medians), Chromium headless with SwiftShader.

> SwiftShader numbers are a **regression proxy**, not the product target. The
> 60 fps dGPU / 30 fps iGPU acceptance still needs a real-GPU run.

## Environment

| Item | Value |
|---|---|
| CPU | CI/host container, software rasterizer |
| GPU | SwiftShader (no hardware acceleration) |
| Resolution | 1280 × 720 |
| Build | Vite dev server, production-style bundle |
| Agents | 50 |

## Baseline (2026-11-08)

| Waypoint | FPS | Draw calls | Naive draw calls | Culling drop |
|---|---|---|---|---|
| Plaza | 4.0 | 650 | 1487 | 56.3% |
| Lobby | 4.3 | 326 | 1480 | 78.0% |
| Office | 4.4 | 265 | 1456 | 81.8% |
| Stairs | 4.9 | 234 | — | — |
| Floor 1 | 4.9 | 345 | — | — |
| Forge | 4.1 | 429 | — | — |
| Observatory | 4.2 | 311 | — | — |
| Library | 4.6 | 116 | — | — |
| Studio | 5.0 | 113 | — | — |

Scene: 1758 meshes, ~650 building meshes, ~900 cullable room/prop meshes.

Budgets

`perf/budget.json`:

- minimum headless FPS: 2 (flake guard)
- maximum draw calls: 900
- maximum regression vs baseline: 35%
- minimum culling drop: 40%

## Other budgets

| Budget | Target | Evidence |
|---|---|---|
| Sim tick, 50 agents | < 16 ms | `tests/sim/agents.test.ts` |
| 50 path computations | < 1000 ms | `tests/sim/agents.test.ts` |
| Per-client broadcast CPU | < 5 ms | `tests/collector/server.test.ts` |
| Collector state rate | 5–10 Hz | `ATRIUM_STATE_HZ=8` |
| Client reconnect fallback | ≤ 2 s | `tests/net/state-client.test.ts` |

## Reproducing

```bash
npm run perf:update   # write a new baseline on this machine
npm run perf          # compare against perf/baseline.json
```

The nightly `Performance` workflow uploads `perf/results.json` as an artifact.
