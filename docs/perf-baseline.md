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
| Plaza | 5.0 | 688 | 1558 | 55.8% |
| Lobby | 6.6 | 341 | 1563 | 78.2% |
| Office | 8.1 | 278 | 1530 | 81.8% |
| Stairs | 8.2 | 247 | — | — |
| Floor 1 | 8.6 | 331 | — | — |
| Forge | 7.4 | 455 | — | — |
| Observatory | 8.3 | 332 | — | — |
| Library | 9.2 | 136 | — | — |
| Studio | 8.3 | 143 | — | — |

Scene: 1946 meshes, ~650 building meshes, ~1000 cullable room/prop/avatar meshes.

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
