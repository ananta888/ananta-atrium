# Attribution

## Art and audio

No third-party models, textures, HDRIs, fonts or audio files are included.
All geometry, materials and signage are generated procedurally from
`src/world/scene.json` and code. The UI uses system fonts.

If you add an asset, add a row here with the source URL and licence before
committing it.

| Asset | Source | Licence |
|---|---|---|
| — | — | — |

## Runtime libraries

| Package | Licence | Use |
|---|---|---|
| `@babylonjs/core` | Apache-2.0 | renderer, math, GUI bridge |
| `@babylonjs/gui` | Apache-2.0 | HUD and inspection panel |
| `@babylonjs/loaders` | Apache-2.0 | future glTF asset pipeline |
| `@babylonjs/havok` | See package | declared for physics; not yet active at runtime |
| `ws` | MIT | collector WebSocket server |
| `ajv` | MIT | JSON-schema validation in tests |

## Development libraries

`vite`, `vitest`, `typescript`, `eslint`, `prettier`, `@playwright/test` and
`typescript-eslint` are MIT/BSD/Apache-2.0 licensed; see their packages.

## Upstream data

The collector integrates with [Ananta](https://github.com/ananta888/ananta)
(Apache-2.0) and llama.cpp. No upstream source code is copied into this
repository; only the HTTP/WebSocket contracts are implemented here.
