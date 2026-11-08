import { describe, expect, it } from 'vitest'
import { LlamaMetricsSource } from '../../collector/llama-source.js'

function fakeFetch(slots: unknown): typeof fetch {
  return (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => slots,
    }) as Response) as typeof fetch
}

describe('llama metrics source', () => {
  it('computes throughput from slot counters', async () => {
    let decoded = 100
    const source = new LlamaMetricsSource(['http://llama'], (async () => {
      decoded += 50
      return {
        ok: true,
        status: 200,
        json: async () => [{ is_processing: true, n_decoded: decoded }],
      } as Response
    }) as typeof fetch)

    await source.poll()
    await new Promise((resolve) => setTimeout(resolve, 20))
    const rate = await source.poll()
    expect(rate).toBeGreaterThan(0)
    expect(source.statuses[0]?.activeSlots).toBe(1)
    expect(source.statuses[0]?.reachable).toBe(true)
  })

  it('degrades to zero instead of throwing when llama is unreachable', async () => {
    const source = new LlamaMetricsSource(['http://llama'], (async () => {
      throw new Error('ECONNREFUSED')
    }) as typeof fetch)
    await expect(source.poll()).resolves.toBe(0)
    expect(source.statuses[0]?.reachable).toBe(false)
    expect(source.statuses[0]?.lastError).toContain('ECONNREFUSED')
  })

  it('accepts an object envelope with slots', async () => {
    const source = new LlamaMetricsSource(['http://llama'], fakeFetch({ slots: [{ n_decoded: 5 }] }))
    await expect(source.poll()).resolves.toBe(0)
    expect(source.statuses[0]?.reachable).toBe(true)
  })
})
