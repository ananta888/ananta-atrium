# AGENTS.md — Ananta Atrium

## Purpose

This file is the contract for humans and AI agents working on **Ananta Atrium**.
Read it before touching code, scenes, assets, or the todo plan. If a request
conflicts with this file, stop and ask — do not silently bend the architecture.

## What this project is

Ananta Atrium is a **first-person 3D campus visualisation of live AI agents**.
Agents working in the local Ananta stack are represented as avatars inside a
two-storey office building; several buildings sit in a walkable landscape.

- **Engine:** Babylon.js (`@babylonjs/core`, Havok physics, GUI).
- **Platform:** browser first (WebGPU, WebGL2 fallback), static deploy.
- **Mode:** first-person exploration; the player walks through rooms and between
  buildings. No combat, no progression — this is an inhabited place, not a shooter.
- **Scale target:** 3–5 buildings, ~50 concurrent agents, 60 fps on a mid-range
  GPU (30 fps minimum on integrated graphics).
- **Data:** live agent state from the Ananta stack (llama.cpp + session events),
  with a deterministic fake source for development.
- **Licence:** open source. Code under a permissive licence (see `LICENSE` once
  created); every asset must carry a compatible, documented licence.

## Non-goals

- Photorealism. Target is **archviz-realistic**: PBR, baked light, modular kit.
- A general-purpose game engine or editor. Scene authoring is data + scripts.
- Re-implementing what Babylon ships (loader, materials, physics, GUI, audio).
- Mobile/touch as a first-class target before M4.
- Microservice sprawl: the collector is one small service, not a platform.

## Architecture rules

```
src/
  sim/       pure TypeScript: agent state, schedules, rooms, pathing intents,
             deterministic fixed-step tick. MUST NOT import Babylon.
  render/    Babylon scene, ECS→Babylon sync, materials, LOD, streaming.
  world/     building modules, campus layout, scene data loaders.
  net/       WebSocket client for the state stream + fake source.
  app/       bootstrap, first-person controller, input, UI wiring.
  shared/    contracts shared by collector and client (AgentState schema/types).
collector/   Node/TS service: Ananta + llama.cpp → normalized state stream.
devtools/    developer tooling (todo validator, asset scripts).
todos/       planning artifacts (see below).
tests/       unit (sim), integration, e2e (Playwright).
```

Rules that are enforced, not advisory:

1. **`src/sim/` never imports `@babylonjs/*` or any renderer type.** Simulation
   must run headless in Node. This is what makes determinism, unit tests and a
   future renderer swap possible.
2. **Rendering is a projection of state, never the source of truth.** The render
   layer may interpolate, cull and optimise; it may not own gameplay state.
3. **Every frame is driven by the fixed-step sim**, not by wall-clock render
   timing. Rendering interpolates between sim ticks.
4. **Data over code.** Buildings, rooms, desks, campus layout and agent spawn
   points live in `scene.json` / prefab-style JSON, not in hand-written
   constructor calls.
5. **No silent fallbacks.** If the live stream is unavailable, the UI says so
   and the fake source is labelled `source: fake`, never disguised as live.
6. **One dependency direction:** `app → render/net/world → sim/shared`. Never
   the reverse.
7. **Assets must be traceable.** Every imported model, texture, HDRI and audio
   file gets an entry in `ATTRIBUTION.md` with source URL and licence.

## Tech stack

- Node.js **24+** (pinned in `.nvmrc` and `package.json#engines`).
- TypeScript strict, ESM.
- Vite for dev/build, Vitest for unit tests, Playwright for e2e.
- ESLint + Prettier; lint is a CI gate.
- Babylon.js core + `@babylonjs/havok` + `@babylonjs/gui` + `@babylonjs/loaders`;
  `@babylonjs/inspector` is dev-only.

## The todo system — how it is used and maintained

The plan is a **machine-readable contract**, not prose. It exists so agents can
pick the next unit of work without guessing, and so progress is auditable.

### Files

| File | Role |
|---|---|
| `todos/todo.track.schema.json` | Schema for the **task-track** format (milestones + tasks). Copied from the Ananta planning contract. |
| `todos/todo.schema.json` | Schema for the **category** format (categories + items). Copied from Ananta; used for broad research/portfolio plans that are not executable tasks. |
| `todos/todo.ananta-atrium.json` | **The single source of truth** for the active plan. Task-track format. |
| `devtools/todo.py` | Validator + summary recomputer. |

Use **task-track** for implementation work. Use **category** only when the work
is still exploratory (research a library, compare options) and cannot be cut
into verifiable tasks yet. Never keep two competing plans for the same scope.

### Update workflow (required after every edit)

```bash
python3 devtools/todo.py recompute   # derive summaries + milestone status
python3 devtools/todo.py validate    # schema + quality gates
```

`recompute` owns these fields — **never hand-edit them**:

- `tasks_status_summary`, `tasks_type_summary`, `progress_summary`
- each milestone's `status` (derived from its tasks)

`validate` additionally enforces:

- task ids are unique, every `depends_on` / `critical_path_tasks` id exists,
- `status` is one of the scale below,
- `progress_percent` matches the status (`todo`=0, `done`=100, others 1–99),
- milestone `task_ids` reference real tasks,
- summaries are not stale.

### Scales

- `status`: `todo` · `in_progress` · `partial` · `blocked` · `done`
- `priority`: `P0` (must have) · `P1` (should have) · `P2` (nice) · `P3` (later)
- `risk`: `low` · `medium` · `high` · `critical`

### Field semantics

- **`id`** — stable, never renumbered. Format `AT-<milestone><nn>`; new work gets
  the next free number in its milestone, not a reused id.
- **`acceptance_criteria`** — the Definition of Done. Binary, observable, and
  verifiable without reading the implementation (a test, a measurement, a file,
  a screenshot). "Works well" is not a criterion.
- **`type`** — `bootstrap` · `foundation` · `data` · `world` · `render` ·
  `gameplay` · `product` · `qa` · `docs` · `release` · `research`.
- **`depends_on`** — task ids that must reach `done` first. Keep the graph
  acyclic; the validator rejects unknown ids.
- **`critical_path_tasks`** — the ids that determine the earliest possible
  finish. Update it when dependencies change.
- **`milestone.task_ids`** — the complete membership of a milestone. A task
  belongs to exactly one milestone.

### Status transitions

1. Pick the highest-priority `todo` task whose `depends_on` are all `done`.
2. Set it `in_progress`, `progress_percent` 1–99, and add a one-line note.
3. On completion set `done` + `progress_percent: 100`, then run `recompute`.
4. If blocked, set `blocked`, record the blocker in `notes`, and open a task for
   the unblocking work instead of hiding it.
5. Never mark a task `done` because time ran out. Partial work is `partial`.

### Adding work

- Add the task with a new id, a concrete title, at least one acceptance
  criterion, `depends_on`, and the milestone it belongs to.
- Add the id to its milestone's `task_ids`.
- If it is on the critical path, add it to `critical_path_tasks`.
- Run `recompute` + `validate`.

### Removing work

Do not delete completed tasks — they are the project history. Set `status: done`
and leave them. Only delete a task that was never started, and only if it is
demonstrably obsolete; note the reason in the commit message.

## Definition of Done (code)

A task is done when all of the following hold:

- acceptance criteria met and evidenced,
- `npm run typecheck`, `npm run lint`, `npm test` pass,
- new behaviour has a test (unit for `sim`, e2e for player-visible flows),
- no new `@babylonjs/*` import under `src/sim/`,
- perf budget not regressed (draw calls / frame ms measured on the reference scene),
- docs updated if the contract, data format or setup changed,
- assets added to `ATTRIBUTION.md`.

## Working agreements for AI agents

- Read `todos/todo.ananta-atrium.json` before starting. Work on one task at a
  time; do not batch unrelated changes.
- State which task id you are working on in the first line of your response.
- Prefer small, verifiable increments over large rewrites.
- If you discover work that is not in the plan, add it as a task first, then do it.
- If a requirement is ambiguous, ask — do not invent product decisions.
- Never commit secrets, machine-local paths, device IDs or model weights.
- Do not copy code from other projects without checking its licence and adding
  attribution. Concepts may be reimplemented; code must be licensed.

## Repository conventions

- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `perf:`).
- Branch per task or milestone; PRs reference the task id (`AT-202`).
- Keep `main` deployable; CI must be green before merge.
