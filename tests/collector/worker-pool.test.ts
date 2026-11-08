import { describe, expect, it } from 'vitest'
import { WorkerPoolSource } from '../../collector/worker-pool.js'

function sourceWith(payloads: Record<string, unknown>): WorkerPoolSource {
  const fetcher = (async (url: string) => {
    const path = new URL(String(url)).pathname
    const body = payloads[path]
    return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 })
  }) as typeof fetch
  return new WorkerPoolSource({ baseUrl: 'http://hub', token: 'token', fetcher })
}

describe('worker pool source', () => {
  it('maps active and queued leases and exposes task deadlines', async () => {
    const now = Math.floor(Date.now() / 1000)
    const source = sourceWith({
      '/api/worker-pool/status': { data: { capacity_by_model: {} } },
      '/api/worker-pool/queues': {
        data: {
          items: [
            {
              id: 'q1',
              status: 'queued',
              worker_id: 'worker-1',
              ollama_model: 'qwen',
              queue_position: 2,
              acquired_at: now - 10,
              deadline_at: now + 100,
              parent_task_id: 'task-q',
            },
          ],
        },
      },
      '/api/worker-pool/leases': {
        data: {
          items: [
            {
              id: 'a1',
              status: 'active',
              worker_id: 'worker-1',
              ollama_model: 'qwen',
              acquired_at: now - 30,
              deadline_at: now + 570,
              parent_task_id: 'task-a',
            },
          ],
        },
      },
    })
    const ops = await source.poll()
    expect(ops.active).toHaveLength(1)
    expect(ops.queued).toHaveLength(1)
    expect(ops.active[0]?.taskId).toBe('task-a')
    expect(ops.queued[0]?.queuePosition).toBe(2)
    expect(source.leaseForTask('task-a')?.deadline_at).toBeGreaterThan(now)
    expect(source.leaseForTask('missing')).toBeNull()
    expect(source.status.reachable).toBe(true)
  })

  it('keeps the last snapshot when the hub is unavailable', async () => {
    let fail = false
    const fetcher = (async (url: string) => {
      if (fail) return new Response('{}', { status: 503 })
      const path = new URL(String(url)).pathname
      if (path === '/api/worker-pool/queues' || path === '/api/worker-pool/leases') {
        return new Response(JSON.stringify({ data: { items: [] } }), { status: 200 })
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 })
    }) as typeof fetch
    const source = new WorkerPoolSource({ baseUrl: 'http://hub', token: 'token', fetcher })
    await source.poll()
    fail = true
    const ops = await source.poll()
    expect(ops.active).toEqual([])
    expect(source.status.reachable).toBe(false)
  })

  it('throws when no token is configured', async () => {
    const source = new WorkerPoolSource({ baseUrl: 'http://hub', token: null, fetcher: (async () => new Response('')) as typeof fetch })
    await expect(source.poll()).rejects.toThrow(/TOKEN/)
  })
})
