# Assets

## Manifest and import path

`assets/manifest.json` is the only entry point for external assets. Every entry
needs an `id`, `kind`, `licence`, `source`, an optional deterministic `sha256`
and one or more `variants`.

```json
{
  "id": "plaza-grid",
  "kind": "texture",
  "licence": "CC0-1.0",
  "source": "generated in-repo",
  "sha256": "…",
  "variants": { "ktx2": "assets/textures/plaza-grid.ktx2", "png": "assets/textures/plaza-grid.svg" }
}
```

Loading (`src/world/assets.ts`):

1. `chooseVariant` prefers KTX2 when the device reports support, then WebP, then
   PNG. Meshes require a `glb` variant.
2. The file is fetched; a non-2xx response throws.
3. If `sha256` is set, the bytes are hashed and a mismatch throws.
4. Only then is the Babylon loader called (`Texture`, `LoadAssetContainerAsync`
   for glTF).
5. Any failure aborts startup with a visible error — never an invisible mesh.

The app currently loads the plaza ground texture this way. Failing to load it
fails the boot, which is intentional.

## Adding an asset

1. Put the file under `assets/`.
2. Add the manifest entry with source URL and licence.
3. Compute `sha256sum <file>` and paste it into the entry.
4. Add a row to `ATTRIBUTION.md`.
5. Run `npm run check:assets` (also part of CI).

## KTX2 / WebGL

KTX2 transcoding needs the Babylon KTX2 loader and a transcoder WASM file. The
manifest path is in place; when the first KTX2 asset is added, configure the
transcoder URL in the texture factory. Until then the PNG/WebP fallback is used
and tested.
