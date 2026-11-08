/** Tiny deterministic PRNG — no Math.random anywhere in the simulation. */

export function hashString(value: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createRng(seed: string | number): () => number {
  return mulberry32(typeof seed === 'number' ? seed : hashString(seed))
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick() called with an empty list')
  const item = items[Math.floor(rng() * items.length) % items.length]
  if (item === undefined) throw new Error('pick() index out of range')
  return item
}
