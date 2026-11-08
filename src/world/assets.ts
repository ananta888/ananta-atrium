export type AssetKind = 'texture' | 'mesh'

export interface AssetVariants {
  ktx2?: string
  webp?: string
  png?: string
  glb?: string
}

export interface ManifestEntry {
  id: string
  kind: AssetKind
  licence: string
  source: string
  sha256?: string
  variants: AssetVariants
}

export interface AssetManifest {
  version: 1
  assets: ManifestEntry[]
}

export class AssetError extends Error {}

export function validateManifest(raw: unknown): AssetManifest {
  if (typeof raw !== 'object' || raw === null) throw new AssetError('manifest must be an object')
  const value = raw as Record<string, unknown>
  if (value.version !== 1) throw new AssetError('unsupported asset manifest version')
  if (!Array.isArray(value.assets)) throw new AssetError('manifest.assets must be an array')
  const ids = new Set<string>()
  const assets = value.assets.map((item, index) => {
    if (typeof item !== 'object' || item === null) throw new AssetError(`assets[${index}] invalid`)
    const entry = item as Record<string, unknown>
    if (typeof entry.id !== 'string' || entry.id.length === 0) throw new AssetError(`assets[${index}].id missing`)
    if (ids.has(entry.id)) throw new AssetError(`duplicate asset id ${entry.id}`)
    ids.add(entry.id)
    if (entry.kind !== 'texture' && entry.kind !== 'mesh') throw new AssetError(`${entry.id}: invalid kind`)
    if (typeof entry.licence !== 'string' || entry.licence.length === 0) {
      throw new AssetError(`${entry.id}: licence is required`)
    }
    if (typeof entry.source !== 'string' || entry.source.length === 0) {
      throw new AssetError(`${entry.id}: source is required`)
    }
    if (typeof entry.variants !== 'object' || entry.variants === null) {
      throw new AssetError(`${entry.id}: variants missing`)
    }
    const variants = entry.variants as Record<string, unknown>
    const allowed = ['ktx2', 'webp', 'png', 'glb']
    if (!allowed.some((key) => typeof variants[key] === 'string')) {
      throw new AssetError(`${entry.id}: at least one file variant is required`)
    }
    return {
      id: entry.id,
      kind: entry.kind as AssetKind,
      licence: entry.licence,
      source: entry.source,
      ...(typeof entry.sha256 === 'string' ? { sha256: entry.sha256 } : {}),
      variants: {
        ...(typeof variants.ktx2 === 'string' ? { ktx2: variants.ktx2 } : {}),
        ...(typeof variants.webp === 'string' ? { webp: variants.webp } : {}),
        ...(typeof variants.png === 'string' ? { png: variants.png } : {}),
        ...(typeof variants.glb === 'string' ? { glb: variants.glb } : {}),
      },
    }
  })
  return { version: 1, assets }
}

/** KTX2 is preferred when the device supports it; WebP/PNG follow. */
export function chooseVariant(entry: ManifestEntry, supportsKtx2: boolean): string {
  if (entry.kind === 'mesh') {
    if (entry.variants.glb) return entry.variants.glb
    throw new AssetError(`${entry.id}: mesh has no glb variant`)
  }
  const order = supportsKtx2
    ? [entry.variants.ktx2, entry.variants.webp, entry.variants.png]
    : [entry.variants.webp, entry.variants.png]
  const url = order.find((candidate) => typeof candidate === 'string' && candidate.length > 0)
  if (!url) throw new AssetError(`${entry.id}: no texture variant supported by this device`)
  return url
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer)
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  throw new AssetError('SHA-256 is unavailable: WebCrypto is required')
}

export interface AssetLoadDeps {
  fetch: typeof fetch
  supportsKtx2: boolean
  baseUrl?: string
  load: (url: string, entry: ManifestEntry) => Promise<unknown>
}

/** Fails loudly: network errors, hash mismatch and missing variants all throw. */
export async function loadAsset(entry: ManifestEntry, deps: AssetLoadDeps): Promise<unknown> {
  const variant = chooseVariant(entry, deps.supportsKtx2)
  const url = `${deps.baseUrl ?? ''}${variant}`
  const response = await deps.fetch(url)
  if (!response.ok) throw new AssetError(`${entry.id}: ${url} returned ${response.status}`)
  if (entry.sha256) {
    const bytes = await response.clone().arrayBuffer()
    const digest = await sha256Hex(bytes)
    if (digest !== entry.sha256) {
      throw new AssetError(`${entry.id}: hash mismatch (expected ${entry.sha256}, got ${digest})`)
    }
  }
  try {
    return await deps.load(url, entry)
  } catch (error) {
    throw new AssetError(`${entry.id}: failed to load ${url}: ${(error as Error).message}`)
  }
}

export async function loadManifest(baseUrl: string, fetcher: typeof fetch): Promise<AssetManifest> {
  const response = await fetcher(`${baseUrl}assets/manifest.json`)
  if (!response.ok) throw new AssetError(`manifest returned ${response.status}`)
  return validateManifest(await response.json())
}
