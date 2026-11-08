import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AssetError,
  chooseVariant,
  loadAsset,
  sha256Hex,
  validateManifest,
  type ManifestEntry,
} from '../../src/world/assets.js'

const here = dirname(fileURLToPath(import.meta.url))
const manifest = validateManifest(
  JSON.parse(readFileSync(join(here, '../../public/assets/manifest.json'), 'utf8')),
)

const entry: ManifestEntry = {
  id: 'test',
  kind: 'texture',
  licence: 'CC0-1.0',
  source: 'test',
  variants: { ktx2: 'a.ktx2', webp: 'a.webp', png: 'a.png' },
}

describe('asset manifest', () => {
  it('accepts the committed manifest', () => {
    expect(manifest.version).toBe(1)
    expect(manifest.assets.length).toBeGreaterThan(0)
  })

  it('rejects duplicate ids and missing licences', () => {
    expect(() => validateManifest({ version: 1, assets: [{ ...entry }, { ...entry }] })).toThrow(/duplicate/)
    expect(() => validateManifest({ version: 1, assets: [{ ...entry, licence: '' }] })).toThrow(/licence/)
  })

  it('rejects entries without any file variant', () => {
    expect(() => validateManifest({ version: 1, assets: [{ ...entry, variants: {} }] })).toThrow(/variant/)
  })
})

describe('variant selection', () => {
  it('prefers KTX2 when supported', () => {
    expect(chooseVariant(entry, true)).toBe('a.ktx2')
  })

  it('falls back to WebP then PNG without KTX2', () => {
    expect(chooseVariant(entry, false)).toBe('a.webp')
    expect(chooseVariant({ ...entry, variants: { png: 'a.png' } }, false)).toBe('a.png')
  })

  it('throws when no supported variant exists', () => {
    expect(() => chooseVariant({ ...entry, variants: { ktx2: 'a.ktx2' } }, false)).toThrow(AssetError)
  })
})

describe('loadAsset', () => {
  it('verifies hashes and loads the chosen file', async () => {
    const bytes = new TextEncoder().encode('hello')
    const digest = await sha256Hex(bytes.buffer)
    const loaded: string[] = []
    const result = await loadAsset(
      { ...entry, sha256: digest, variants: { png: 'texture.png' } },
      {
        supportsKtx2: false,
        baseUrl: 'https://example.test/',
        fetch: (async (url: string) => {
          expect(url).toBe('https://example.test/texture.png')
          return new Response(bytes, { status: 200 })
        }) as typeof fetch,
        load: async (url) => {
          loaded.push(url)
          return { url }
        },
      },
    )
    expect(result).toEqual({ url: 'https://example.test/texture.png' })
    expect(loaded).toHaveLength(1)
  })

  it('fails loudly on a missing file', async () => {
    await expect(
      loadAsset(entry, {
        supportsKtx2: false,
        fetch: (async () => new Response('', { status: 404 })) as typeof fetch,
        load: async () => undefined,
      }),
    ).rejects.toThrow(/404/)
  })

  it('fails loudly on a hash mismatch', async () => {
    await expect(
      loadAsset(
        { ...entry, sha256: 'deadbeef', variants: { png: 'a.png' } },
        {
          supportsKtx2: false,
          fetch: (async () => new Response('bytes', { status: 200 })) as typeof fetch,
          load: async () => undefined,
        },
      ),
    ).rejects.toThrow(/hash mismatch/)
  })
})
