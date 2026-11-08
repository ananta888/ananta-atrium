export interface LlamaStatus {
  url: string
  reachable: boolean
  lastError: string | null
  lastSuccessAt: number | null
  tokensPerSecond: number
  activeSlots: number
}

interface Sample {
  decoded: number
  at: number
}

interface Slot {
  id?: number
  is_processing?: boolean
  n_decoded?: number
}

/**
 * llama.cpp exposes /slots (per-slot counters) and /metrics (Prometheus).
 * Only throughput is used here: identity and task text come from Ananta.
 */
export class LlamaMetricsSource {
  readonly statuses: LlamaStatus[]
  private readonly previous = new Map<string, Sample>()
  private readonly fetcher: typeof fetch

  constructor(urls: readonly string[], fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher
    this.statuses = urls.map((url) => ({
      url,
      reachable: false,
      lastError: null,
      lastSuccessAt: null,
      tokensPerSecond: 0,
      activeSlots: 0,
    }))
  }

  async poll(): Promise<number> {
    const now = Date.now()
    let total = 0
    await Promise.all(
      this.statuses.map(async (status) => {
        try {
          const response = await this.fetcher(`${status.url}/slots`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(2500),
          })
          if (!response.ok) throw new Error(`/slots returned ${response.status}`)
          const payload = (await response.json()) as Slot[] | { slots?: Slot[] }
          const slots = Array.isArray(payload) ? payload : (payload.slots ?? [])
          const decoded = slots.reduce((sum, slot) => sum + Number(slot.n_decoded ?? 0), 0)
          status.activeSlots = slots.filter((slot) => slot.is_processing).length
          status.reachable = true
          status.lastError = null
          status.lastSuccessAt = now
          total += this.rate(status.url, decoded, now)
        } catch (error) {
          status.reachable = false
          status.lastError = (error as Error).message
          status.tokensPerSecond = 0
        }
      }),
    )
    return total
  }

  private rate(url: string, decoded: number, now: number): number {
    const previous = this.previous.get(url)
    this.previous.set(url, { decoded, at: now })
    if (!previous || now <= previous.at) return 0
    const delta = decoded - previous.decoded
    if (delta < 0) return 0 // slot counter reset after a model reload
    const perSecond = (delta / (now - previous.at)) * 1000
    const status = this.statuses.find((item) => item.url === url)
    if (status) status.tokensPerSecond = perSecond
    return perSecond
  }
}
