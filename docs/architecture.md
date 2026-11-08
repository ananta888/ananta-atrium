# Architecture

Ananta Atrium is a projection of agent state, not a game with its own truth.
This note records the decisions that the code and the todo plan depend on.

## Layers

```
app  ──► render / net / world ──► sim / shared
```

| Layer | Owns | May import |
|---|---|---|
| `src/sim` | agent state, schedules, desk/room assignment, path intents, fixed-step tick | `src/shared` only |
| `src/shared` | `AgentState` contract, campus layout types | nothing external |
| `src/world` | `scene.json` loading and validation | `src/shared` |
| `src/render` | Babylon scene, meshes, materials, HUD, avatar views | `src/shared`, `src/sim` (read-only reads) |
| `src/net` | collector WebSocket client, fake fallback | `src/shared` |
| `src/app` | bootstrap, controller, frame loop, wiring | everything below |
| `collector` | Ananta/llama.cpp → normalized stream | `src/shared`, `src/sim` (fake source) |

`src/sim` must never import `@babylonjs/*`. `npm run check:boundary` fails the
build otherwise; `npm run build` runs it first.

## Simulation

- Fixed step at 30 Hz (`FixedStepDriver`); rendering interpolates but never
  advances gameplay state.
- Determinism comes from seeded `mulberry32` PRNGs keyed by agent id. There is
  no `Math.random`, `Date.now` or `performance.now` in state transitions;
  `updatedAt` is derived from `startTick × tickSeconds` and an injected start
  time.
- The campus layout is data (`src/world/scene.json`). The navigation graph is
  derived from that data at runtime: room centre → corridor point → stair hub →
  other floors → outdoor gate → plaza.
- **ECS decision:** a hand-written store, not Koota. At ~50 agents the data set
  is small, the tick is trivial, and a dependency-free sim keeps headless tests
  and a future renderer swap cheap.

## Product shell and state

- `src/app/overlay.ts` owns the DOM UI (menu, connect, settings, agent list,
  minimap, replay bar); `src/render/hud.ts` keeps the in-world Babylon GUI.
- `src/app/settings.ts` is pure and sanitises persisted values; `i18n.ts` holds
  the en/de dictionaries (parity enforced by `npm run check:i18n`).
- `src/sim/replay.ts` records snapshots with caller-supplied timestamps; the
  replay scrubber renders them without the collector.
- `src/app/audio.ts` synthesises ambience, footsteps and cues with Web Audio
  after a user gesture; no audio assets are shipped.
- `src/app/touch.ts` adds a joystick and look area only for coarse pointers.

## Rendering

- Babylon.js, WebGPU when an adapter exists, otherwise WebGL2.
- `CampusWorld` builds the blockout from scene data (slabs, corridor walls with
  door gaps, stair ramps, desks via instances, facade windows, signage).
- `AvatarLayer` owns one capsule/head/beacon/ring per agent and syncs from
  `AgentState.position` each frame. It culls by distance and disposes views for
  agents that disappear.
- `Hud` is a Babylon GUI fullscreen texture: source badge, stats, room, culling
  counters and a nearest/focused-agent inspection panel.
- Culling and streaming are described in `docs/adr/005-culling-and-streaming.md`;
  lighting probes in `docs/adr/003-lighting-probes.md`.

## Data flow

```
Ananta hub ─┐
            ├─► collector (normalize, validate, broadcast) ─► WS ─► client sim ─► renderer
llama.cpp ──┘
```

The client always keeps a labelled fake simulation. If the collector is absent
or disconnects, the HUD says `SOURCE: FAKE`; it never silently pretends the
stream is live. See `docs/integration-ananta.md`.
