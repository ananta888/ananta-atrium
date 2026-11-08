import { describe, expect, it } from 'vitest'
import { QueueFullError, RequestScheduler } from '../../proxy/scheduler.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('request scheduler', () => {
  it('starts interactive work before queued background work', async () => {
    const scheduler = new RequestScheduler({ maxConcurrent: 1 })
    const order: string[] = []
    const first = deferred<void>()

    const a = scheduler.enqueue('background', async () => {
      order.push('bg1')
      await first.promise
      order.push('bg1-done')
    })
    const b = scheduler.enqueue('background', async () => {
      order.push('bg2')
    })
    const c = scheduler.enqueue('interactive', async () => {
      order.push('int')
    })

    await Promise.resolve()
    expect(order).toEqual(['bg1'])
    first.resolve()
    await Promise.all([a, b, c])
    expect(order).toEqual(['bg1', 'bg1-done', 'int', 'bg2'])
  })

  it('limits concurrency and reports queue sizes', async () => {
    const scheduler = new RequestScheduler({ maxConcurrent: 2 })
    const gate = deferred<void>()
    const running = Array.from({ length: 4 }, () =>
      scheduler.enqueue('background', async () => gate.promise),
    )
    await Promise.resolve()
    expect(scheduler.stats().active).toBe(2)
    expect(scheduler.stats().queuedBackground).toBe(2)
    gate.resolve()
    await Promise.all(running)
    expect(scheduler.stats().servedBackground).toBe(4)
  })

  it('rejects when the queue is full', async () => {
    const scheduler = new RequestScheduler({ maxConcurrent: 1, maxQueue: 1 })
    const gate = deferred<void>()
    const active = scheduler.enqueue('background', async () => gate.promise)
    const queued = scheduler.enqueue('background', async () => undefined)
    await expect(scheduler.enqueue('interactive', async () => undefined)).rejects.toBeInstanceOf(QueueFullError)
    gate.resolve()
    await Promise.all([active, queued])
  })
})
