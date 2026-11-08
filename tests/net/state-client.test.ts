import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StateClient, type ConnectionStatus, type SocketLike } from '../../src/net/state-client.js'

class FakeSocket implements SocketLike {
  readyState = 0
  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onclose: ((event: unknown) => void) | null = null
  closed = false

  constructor(readonly url: string) {}

  open(): void {
    this.readyState = 1
    this.onopen?.({})
  }

  receive(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  close(): void {
    this.closed = true
    this.readyState = 3
    this.onclose?.({})
  }
}

function harness() {
  const sockets: FakeSocket[] = []
  const snapshots: Array<{ agents: unknown[]; source: string }> = []
  const statuses: ConnectionStatus[] = []
  const client = new StateClient({
    url: 'ws://test/stream',
    fallbackDelayMs: 2000,
    socketFactory: (url) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    },
    onSnapshot: (snapshot) => snapshots.push(snapshot as unknown as { agents: unknown[]; source: string }),
    onUpsert: () => undefined,
    onRemove: () => undefined,
    onStatus: (status) => statuses.push(status),
  })
  return { client, sockets, snapshots, statuses }
}

const agent = {
  schemaVersion: 1,
  id: 'a1',
  name: 'Ada',
  role: 'Engineer',
  status: 'working',
  buildingId: 'b',
  roomId: 'r',
  deskId: 'd',
  task: { title: 't', progress: 0.5 },
  activity: { kind: 'typing' },
  updatedAt: '2026-01-01T09:00:00.000Z',
  source: 'fake',
  stale: false,
}

describe('StateClient', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('accepts a valid snapshot and reports live', () => {
    const { client, sockets, snapshots, statuses } = harness()
    client.start()
    const socket = sockets[0]
    expect(socket).toBeDefined()
    socket?.open()
    socket?.receive({ type: 'snapshot', snapshot: { schemaVersion: 1, generatedAt: '', source: 'fake', agents: [agent] } })
    expect(statuses).toContain('live')
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.agents).toHaveLength(1)
    client.stop()
  })

  it('drops malformed frames without breaking the connection', () => {
    const { client, sockets, snapshots } = harness()
    client.start()
    const socket = sockets[0]
    socket?.open()
    socket?.onmessage?.({ data: 'not json' })
    socket?.receive({ type: 'snapshot' })
    socket?.receive({ type: 'remove', ids: 'nope' })
    expect(snapshots).toHaveLength(0)
    expect(socket?.closed).toBe(false)
    client.stop()
  })

  it('falls back to offline when no first frame arrives', () => {
    const { client, statuses } = harness()
    client.start()
    vi.advanceTimersByTime(2001)
    expect(statuses).toContain('offline')
    client.stop()
  })

  it('reconnects with backoff after a close', () => {
    const { client, sockets, statuses } = harness()
    client.start()
    sockets[0]?.open()
    sockets[0]?.close()
    expect(statuses).toContain('offline')
    expect(sockets).toHaveLength(1)
    vi.advanceTimersByTime(500)
    expect(sockets).toHaveLength(2)
    client.stop()
  })

  it('does not reconnect after stop()', () => {
    const { client, sockets } = harness()
    client.start()
    client.stop()
    vi.advanceTimersByTime(10_000)
    expect(sockets).toHaveLength(1)
  })
})
