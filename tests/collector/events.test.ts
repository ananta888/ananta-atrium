import { describe, expect, it } from 'vitest'
import { AnantaEventStream, parseSseBlock } from '../../collector/event-stream.js'

describe('SSE event stream', () => {
  it('parses SSE blocks', () => {
    expect(parseSseBlock('id: 7\nevent: task\ndata: {"ok":true}')).toEqual({
      id: '7',
      event: 'task',
      data: '{"ok":true}',
    })
    expect(parseSseBlock('event: heartbeat')).toBeNull()
  })

  it('maps task events and exposes them by task/session', async () => {
    const encoder = new TextEncoder()
    const blocks = [
      'id: 1\ndata: {"id":"1","timestamp":1760000000,"task_id":"task-1","type":"task","payload":{"status":"running"}}\n\n',
      'id: 2\ndata: {"id":"2","timestamp":1760000001,"session_id":"session-1","type":"session","payload":{"message":"tool finished"}}\n\n',
    ]
    const fetcher = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const block of blocks) controller.enqueue(encoder.encode(block))
            controller.close()
          },
        }),
        { status: 200 },
      )) as typeof fetch
    const stream = new AnantaEventStream({ baseUrl: 'http://hub', token: 'token', fetcher })
    stream.start()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(stream.status.connected).toBe(true)
    expect(stream.eventsFor('task-1', undefined)).toEqual([
      { at: new Date(1_760_000_000_000).toISOString(), kind: 'task', summary: 'running' },
    ])
    expect(stream.eventsFor(undefined, 'session-1')[0]?.summary).toBe('tool finished')
    stream.stop()
  })

  it('reports a failed stream without throwing', async () => {
    const stream = new AnantaEventStream({
      baseUrl: 'http://hub',
      token: 'token',
      fetcher: (async () => new Response('denied', { status: 401 })) as typeof fetch,
    })
    stream.start()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(stream.status.connected).toBe(false)
    expect(stream.status.lastError).toContain('401')
    stream.stop()
  })
})
