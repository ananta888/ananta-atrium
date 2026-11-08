# ADR 004 — 50-agent crowd technique

Status: accepted for M3.

## Options

1. **Skinned clones** — best animation fidelity, highest CPU/GPU cost per agent.
2. **VAT / vertex animation textures** — cheap draw calls, needs baked clips and
   a fixed rig; overkill before the final art pass.
3. **Procedural per-agent meshes (chosen)** — one body, head, two arms, two legs,
   ring and beacon per agent, animated in code.

## Decision

Use procedural meshes with distance LOD for the blockout. Desks, chairs and trees
are `InstancedMesh`es so the repeated props cost almost nothing; agents stay
individual because their colours, poses and status beacons differ.

## Measurements

- Sim tick, 50 agents: < 16 ms per tick hard ceiling; observed well below in
  `tests/sim/agents.test.ts`.
- 50 concurrent agents walk and change rooms at 30 Hz.
- Render: ~1117 meshes total, 75–426 draw calls after room culling (see
  `perf/baseline.json`).
- Headless SwiftShader is a regression proxy only; the 60 fps dGPU / 30 fps iGPU
  target still needs a reference-hardware run.

## Revisit

Move to skinned clones or VAT when final character art arrives, or if a real GPU
run misses the budget. The avatar layer is the only file that changes.
