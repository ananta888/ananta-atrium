import type { OpsEntry, OpsStatus } from '../src/shared/agent-state.js'

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function mapLease(item: unknown): OpsEntry | null {
  const lease = asRecord(item)
  if (!lease) return null
  const id = stringValue(lease.id)
  const status = stringValue(lease.status) ?? 'unknown'
  if (!id) return null
  const queuePosition = numberValue(lease.queue_position)
  const acquired = numberValue(lease.acquired_at)
  const deadline = numberValue(lease.deadline_at)
  const taskId = stringValue(lease.parent_task_id)
  const workerId = stringValue(lease.worker_id)
  const model = stringValue(lease.ollama_model) ?? stringValue(lease.runtime_kind)
  return {
    id,
    status,
    ...(taskId ? { taskId } : {}),
    ...(workerId ? { workerId } : {}),
    ...(model ? { model } : {}),
    ...(queuePosition !== null ? { queuePosition } : {}),
    ...(acquired !== null && acquired > 0 ? { acquiredAt: new Date(acquired * 1000).toISOString() } : {}),
    ...(deadline !== null && deadline > 0 ? { deadlineAt: new Date(deadline * 1000).toISOString() } : {}),
  }
}

/**
 * Read-only view of the Ananta worker pool. Atrium never modifies the queue;
 * it only displays leases and model capacity.
 */
export class WorkerPoolSource {
  readonly status: { reachable: boolean; lastError: string | null; lastSuccessAt: number | null } = {
    reachable: false,
    lastError: null,
    lastSuccessAt: null,
  }
  private readonly baseUrl: string
  private readonly token: string | null
  private readonly fetcher: typeof fetch
  private lastOps: OpsStatus | null = null

  constructor(options: { baseUrl: string; token: string | null; fetcher?: typeof fetch }) {
    this.baseUrl = options.baseUrl
    this.token = options.token
    this.fetcher = options.fetcher ?? fetch
  }

  private async get(path: string): Promise<unknown> {
    if (!this.token) throw new Error('ATRIUM_HUB_TOKEN is not configured')
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) throw new Error(`${path} returned ${response.status}`)
    return response.json()
  }

  async poll(): Promise<OpsStatus> {
    const now = Date.now()
    try {
      const [status, queues, leases] = await Promise.all([
        this.get('/api/worker-pool/status'),
        this.get('/api/worker-pool/queues'),
        this.get('/api/worker-pool/leases'),
      ])
      const queueItems = Array.isArray(asRecord(asRecord(queues)?.data)?.items)
        ? ((asRecord(asRecord(queues)?.data)?.items as unknown[]) ?? [])
        : []
      const leaseItems = Array.isArray(asRecord(asRecord(leases)?.data)?.items)
        ? ((asRecord(asRecord(leases)?.data)?.items as unknown[]) ?? [])
        : []
      const all = [...leaseItems, ...queueItems].map(mapLease).filter((item): item is OpsEntry => item !== null)
      const deduped = new Map<string, OpsEntry>()
      for (const entry of all) deduped.set(entry.id, entry)
      const entries = [...deduped.values()]
      const statusData = asRecord(asRecord(status)?.data) ?? {}
      const ops: OpsStatus = {
        generatedAt: new Date(now).toISOString(),
        active: entries.filter((entry) => entry.status === 'active'),
        queued: entries.filter((entry) => entry.status === 'queued'),
        ...(statusData.interactive_reserved === true ? { interactiveReserved: true } : {}),
      }
      this.status.reachable = true
      this.status.lastError = null
      this.status.lastSuccessAt = now
      this.lastOps = ops
      return ops
    } catch (error) {
      this.status.reachable = false
      this.status.lastError = (error as Error).message
      if (this.lastOps) return this.lastOps
      throw error
    }
  }

  get latest(): OpsStatus | null {
    return this.lastOps
  }

  leaseForTask(taskId: string): { acquired_at: number; deadline_at: number } | null {
    const ops = this.lastOps
    if (!ops) return null
    const entry = [...ops.active, ...ops.queued].find((item) => item.taskId === taskId)
    if (!entry) return null
    const deadline = entry.deadlineAt ? Date.parse(entry.deadlineAt) / 1000 : null
    const acquired = entry.acquiredAt ? Date.parse(entry.acquiredAt) / 1000 : null
    if (deadline === null || acquired === null) return null
    return { acquired_at: acquired, deadline_at: deadline }
  }
}
