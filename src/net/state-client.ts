import type { AgentState } from '../shared/agent-state.js'
import { isStateMessage, type OpsStatus, type StateMessage } from '../shared/agent-state.js'

export type ConnectionStatus = 'connecting' | 'live' | 'offline'

export interface SocketLike {
  readyState: number
  close(): void
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: ((event: unknown) => void) | null
}

export interface StateClientOptions {
  url: string
  onSnapshot: (snapshot: { agents: AgentState[]; source: 'live' | 'fake' }) => void
  onUpsert: (agents: AgentState[]) => void
  onRemove: (ids: string[]) => void
  onStatus: (status: ConnectionStatus) => void
  onOps?: (ops: OpsStatus) => void
  /** How long to wait for the first frame before the UI calls the source fake. */
  fallbackDelayMs?: number
  /** Injectable for tests; defaults to the browser WebSocket. */
  socketFactory?: (url: string) => SocketLike
}

const BACKOFF_MS = [500, 1000, 2000, 4000, 8000]
const OPEN = 1

export class StateClient {
  private readonly options: StateClientOptions
  private socket: SocketLike | null = null
  private stopped = false
  private attempt = 0
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: StateClientOptions) {
    this.options = options
  }

  start(): void {
    this.stopped = false
    this.connect()
  }

  /** Switch collectors at runtime without a page reload. */
  restart(url: string): void {
    this.stop()
    this.options.url = url
    this.start()
  }

  stop(): void {
    this.stopped = true
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.fallbackTimer = null
    this.reconnectTimer = null
    this.socket?.close()
    this.socket = null
  }

  private connect(): void {
    if (this.stopped) return
    this.options.onStatus('connecting')

    this.fallbackTimer = setTimeout(() => {
      // No first frame in time: the session keeps running on the fake source.
      if (!this.stopped && this.socket?.readyState !== OPEN) {
        this.options.onStatus('offline')
      }
    }, this.options.fallbackDelayMs ?? 2000)

    let socket: SocketLike
    try {
      const factory = this.options.socketFactory ?? ((url: string) => new WebSocket(url))
      socket = factory(this.options.url) as SocketLike
    } catch {
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.onopen = () => {
      this.attempt = 0
    }

    socket.onmessage = (event) => {
      if (this.fallbackTimer) clearTimeout(this.fallbackTimer)
      this.fallbackTimer = null
      let parsed: unknown
      try {
        parsed = JSON.parse(String(event.data))
      } catch {
        return
      }
      // Malformed frames are dropped without disturbing a healthy connection.
      if (!isStateMessage(parsed)) return
      this.options.onStatus('live')
      this.apply(parsed)
    }

    socket.onerror = () => {
      socket.close()
    }

    socket.onclose = () => {
      if (this.fallbackTimer) clearTimeout(this.fallbackTimer)
      this.fallbackTimer = null
      this.options.onStatus('offline')
      this.scheduleReconnect()
    }
  }

  private apply(message: StateMessage): void {
    switch (message.type) {
      case 'snapshot':
        this.options.onSnapshot(message.snapshot)
        break
      case 'upsert':
        this.options.onUpsert(message.agents)
        break
      case 'remove':
        this.options.onRemove(message.ids)
        break
      case 'ops':
        this.options.onOps?.(message.ops)
        break
      case 'heartbeat':
        break
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 8000
    this.attempt += 1
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
  }
}

export function resolveCollectorUrl(): string {
  const params = new URLSearchParams(window.location.search)
  const explicit = params.get('collector')
  if (explicit) return explicit
  const env = import.meta.env.VITE_COLLECTOR_URL
  if (typeof env === 'string' && env.length > 0) return env
  return 'ws://127.0.0.1:8787/stream'
}
