export type Priority = 'interactive' | 'background'

export interface SchedulerOptions {
  maxConcurrent: number
  maxQueue?: number
  interactiveBurst?: number
}

export interface SchedulerStats {
  active: number
  queuedInteractive: number
  queuedBackground: number
  servedInteractive: number
  servedBackground: number
  rejected: number
  maxWaitMs: number
}

interface QueueEntry {
  priority: Priority
  enqueuedAt: number
  run: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

export class QueueFullError extends Error {}
export class AbortedError extends Error {}

/**
 * Two-lane admission control in front of the local model runtime.
 * Running requests are never preempted (llama.cpp cannot do that); interactive
 * requests jump the queue and get the next free slot, with a starvation guard
 * so background work is still served.
 */
export class RequestScheduler {
  private readonly maxConcurrent: number
  private readonly maxQueue: number
  private readonly interactiveBurst: number
  private active = 0
  private readonly interactive: QueueEntry[] = []
  private readonly background: QueueEntry[] = []
  private servedInteractive = 0
  private servedBackground = 0
  private rejected = 0
  private maxWaitMs = 0
  private interactiveStreak = 0

  constructor(options: SchedulerOptions) {
    if (options.maxConcurrent < 1) throw new Error('maxConcurrent must be >= 1')
    this.maxConcurrent = options.maxConcurrent
    this.maxQueue = options.maxQueue ?? 200
    this.interactiveBurst = options.interactiveBurst ?? 5
  }

  private get queued(): number {
    return this.interactive.length + this.background.length
  }

  enqueue<T>(priority: Priority, run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new AbortedError('request aborted'))
    if (this.queued >= this.maxQueue) {
      this.rejected += 1
      return Promise.reject(new QueueFullError('proxy queue is full'))
    }
    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry = {
        priority,
        enqueuedAt: Date.now(),
        run: run as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        ...(signal ? { signal } : {}),
      }
      const onAbort = (): void => {
        const lane = priority === 'interactive' ? this.interactive : this.background
        const index = lane.indexOf(entry)
        if (index >= 0) lane.splice(index, 1)
        reject(new AbortedError('request aborted'))
        this.pump()
      }
      entry.onAbort = onAbort
      signal?.addEventListener('abort', onAbort, { once: true })
      const lane = priority === 'interactive' ? this.interactive : this.background
      lane.push(entry)
      this.pump()
    })
  }

  private nextEntry(): QueueEntry | null {
    const hasInteractive = this.interactive.length > 0
    const hasBackground = this.background.length > 0
    if (!hasInteractive && !hasBackground) return null
    if (hasInteractive && (!hasBackground || this.interactiveStreak < this.interactiveBurst)) {
      this.interactiveStreak += 1
      return this.interactive.shift() ?? null
    }
    this.interactiveStreak = 0
    return this.background.shift() ?? null
  }

  private pump(): void {
    while (this.active < this.maxConcurrent) {
      const entry = this.nextEntry()
      if (!entry) return
      this.start(entry)
    }
  }

  private start(entry: QueueEntry): void {
    this.active += 1
    const wait = Date.now() - entry.enqueuedAt
    if (wait > this.maxWaitMs) this.maxWaitMs = wait
    if (entry.signal) entry.signal.removeEventListener('abort', entry.onAbort as () => void)
    void entry
      .run()
      .then((value) => {
        if (entry.priority === 'interactive') this.servedInteractive += 1
        else this.servedBackground += 1
        entry.resolve(value)
      })
      .catch((error) => {
        if (entry.priority === 'interactive') this.servedInteractive += 1
        else this.servedBackground += 1
        entry.reject(error)
      })
      .finally(() => {
        this.active -= 1
        this.pump()
      })
  }

  stats(): SchedulerStats {
    return {
      active: this.active,
      queuedInteractive: this.interactive.length,
      queuedBackground: this.background.length,
      servedInteractive: this.servedInteractive,
      servedBackground: this.servedBackground,
      rejected: this.rejected,
      maxWaitMs: this.maxWaitMs,
    }
  }
}
