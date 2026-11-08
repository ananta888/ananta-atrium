# Release process

## Versioning

Semantic versioning in `package.json`. Tags are `vMAJOR.MINOR.PATCH`.
`CHANGELOG.md` must contain a `## [x.y.z]` section before a tag is cut.

## Cutting a release

```bash
npm ci
npm run build
npm test
node devtools/release-check.mjs v0.1.0
git tag v0.1.0
git push origin v0.1.0
```

The `Release` workflow then:

1. verifies the tag matches `package.json` and a changelog section exists,
2. builds from a clean checkout with `npm ci`,
3. zips `dist/` into `ananta-atrium-<version>.zip`, including `LICENSE` and
   `ATTRIBUTION.md`,
4. publishes a GitHub release with that asset.

The build is reproducible: same lockfile, same Node version (`.nvmrc`), no
network at build time beyond the dependency install.

## Static hosting

`dist/` is a static bundle with relative asset paths (`base: './'`). It can be
served by any static host; the `Deploy` workflow publishes it to GitHub Pages.

## Rollback

Releases are immutable tags. To roll back:

1. Download the previous release asset (or check out the previous tag and run
   `npm ci && npm run build`).
2. Replace the deployed `dist/` contents with that bundle.
3. If the problem is client-only, users can hard-reload; there is no server
   state.

Rollback was exercised once during 0.1.0 by rebuilding the previous tag and
diffing the bundle hash.
