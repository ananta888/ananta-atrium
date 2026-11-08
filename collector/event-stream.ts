import type { TraceEvent } from '../src/shared/agent-state.js'
import { log } from './logger.js'

interface StreamedEvent {
  id: string | null
  at: string
  taskId?: string
  sessionId?: string
  event: TraceEvent
}

interface EventEnvelope {
  id?: unknown
  timestamp?: unknown
  created_at?: unknown
  at?: unknown
  task_id?: unknown
  session_id?: unknown
  type?: unknown
  channel?: unknown
  payload?: unknown
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function iso(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString()
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  return new Date().toISOString()
}

/** Parses one SSE field block into event/data pairs. */
export function parseSseBlock(block: string): { id?: string; event?: string; data: string } | null {
  let id: string | undefined
  let event: string | undefined
  const data: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('id:')) id = line.slice(3).trim()
    else if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (data.length === 0) return null
  return { ...(id ? { id } : {}), ...(event ? { event } : {}), data: data.join('\n') }
}

function mapEvent(envelope: EventEnvelope, fallbackId: string | null): StreamedEvent | null {
  const payload = asRecord(envelope.payload) ?? {}
  const taskId =
    (typeof envelope.task_id === 'string' && envelope.task_id) ||
    (typeof payload.task_id === 'string' && payload.task_id) ||
    undefined
  const sessionId =
    (typeof envelope.session_id === 'string' && envelope.session_id) ||
    (typeof payload.session_id === 'string' && payload.session_id) ||
    undefined
  const kind =
    (typeof envelope.type === 'string' && envelope.type) ||
    (typeof payload.type === 'string' && payload.type) ||
    (typeof envelope.channel === 'string' && envelope.channel) ||
    'event'
  const summary =
    (typeof payload.message === 'string' && payload.message) ||
    (typeof payload.summary === 'string' && payload.summary) ||
    (typeof payload.status === 'string' && payload.status) ||
    (typeof payload.reason === 'string' && payload.reason) ||
    kind
  return {
    id: typeof envelope.id === 'string' ? envelope.id : fallbackId,
    at: iso(envelope.timestamp ?? envelope.created_at ?? envelope.at),
    ...(taskId ? { taskId } : {}),
    ...(sessionId ? { sessionId } : {}),
    event: { at: iso(envelope.timestamp ?? envelope.created_at ?? envelope.at), kind, summary: String(summary).slice(0, 180) },
  }
}

/**
 * Consumes the hub SSE feed with Last-Event-ID and reconnects with backoff.
 * Polling remains the source of truth; this stream only adds low-latency events.
 */
export class AnantaEventStream {
  readonly status: { connected: boolean; lastEventAt: number | null; lastError: string | null } = {
    connected: false,
    lastEventAt: null,
    lastError: null,
  }
  private readonly baseUrl: string
  private readonly token: string
  private readonly fetcher: typeof fetch
  private readonly onEvent: ((event: StreamedEvent) => void) | undefined
  private controller: AbortController | null = null
  private lastEventId: string | null = null
  private stopped = false
  private attempt = 0
  private recent: StreamedEvent[] = []

  constructor(options: {
    baseUrl: string
    token: string
    fetcher?: typeof fetch
    onEvent?: (event: StreamedEvent) => void
  }) {
    this.baseUrl = options.baseUrl
    this.token = options.token
    this.fetcher = options.fetcher ?? fetch
    this.onEvent = options.onEvent
  }

  start(): void {
    this.stopped = false
    void this.run()
  }

  stop(): void {
    this.stopped = true
    this.controller?.abort()
    this.controller = null
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      this.controller = new AbortController()
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${this.token}`,
          Accept: 'text/event-stream',
        }
        if (this.lastEventId) headers['Last-Event-ID'] = this.lastEventId
        const response = await this.fetcher(`${this.baseUrl}/api/events/stream`, {
          headers,
          signal: this.controller.signal,
        })
        if (!response.ok || !response.body) throw new Error(`stream returned ${response.status}`)
        this.status.connected = true
        this.status.lastError = null
        this.attempt = 0
        await this.consume(response.body)
        if (this.stopped) break
        await new Promise((resolve) => setTimeout(resolve, 250))
      } catch (error) {
        if (this.stopped) break
        this.status.connected = false
        this.status.lastError = (error as Error).message
        log('warn', 'event stream unavailable', { error: (error as Error).message })
        const delay = Math.min(8000, 500 * 2 ** this.attempt)
        this.attempt += 1
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  private async consume(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (!this.stopped) {
      const { value, done } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf('\n\n')
      while (index >= 0) {
        const block = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const parsed = parseSseBlock(block)
        if (parsed) this.handle(parsed)
        index = buffer.indexOf('\n\n')
      }
    }
  }

  private handle(parsed: { id?: string; data: string }): void {
    if (parsed.id) this.lastEventId = parsed.id
    let envelope: EventEnvelope
    try {
      envelope = JSON.parse(parsed.data) as EventEnvelope
    } catch {
      return
    }
    const mapped = mapEvent(envelope, parsed.id ?? null)
    if (!mapped) return
    this.status.lastEventAt = Date.now()
    this.recent.push(mapped)
    if (this.recent.length > 400) this.recent.shift()
    this.onEvent?.(mapped)
  }

  eventsFor(taskId: string | undefined, sessionId: string | undefined, limit = 8): TraceEvent[] {
    return this.recent
      .filter(
        (item) =>
          (taskId && item.taskId === taskId) || (sessionId && item.sessionId === sessionId),
      )
      .slice(-limit)
      .map((item) => item.event)
  }
}
