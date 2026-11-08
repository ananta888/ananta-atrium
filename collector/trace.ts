import type {
  AgentBudget,
  AgentDiff,
  AgentTrace,
  TraceEvent,
} from '../src/shared/agent-state.js'

interface UnknownRecord {
  [key: string]: unknown
}

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isoFromSeconds(value: unknown): string | null {
  const seconds = numberValue(value)
  if (seconds === null || seconds <= 0) return null
  return new Date(seconds * 1000).toISOString()
}

function isoFromAny(value: unknown): string | null {
  const seconds = isoFromSeconds(value)
  if (seconds) return seconds
  const text = textValue(value)
  if (!text) return null
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

/** Parses a unified diff into file stats and a bounded preview. */
export function parseUnifiedDiff(
  diff: string,
  options: { maxFiles?: number; maxPreviewLines?: number } = {},
): AgentDiff {
  const maxFiles = options.maxFiles ?? 40
  const maxPreviewLines = options.maxPreviewLines ?? 60
  const files: AgentDiff['files'] = []
  const preview: string[] = []
  let current: { path: string; additions: number; deletions: number } | null = null
  let additions = 0
  let deletions = 0
  let truncated = false

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = /\sb\/(.+)$/.exec(line)
      if (current) files.push(current)
      current = { path: match?.[1] ?? line.slice(11).trim(), additions: 0, deletions: 0 }
      if (files.length + 1 > maxFiles) {
        truncated = true
        break
      }
      continue
    }
    if (line.startsWith('+++ ')) {
      if (current) current.path = line.slice(4).replace(/^b\//, '').trim()
      continue
    }
    if (line.startsWith('--- ')) continue

    if (line.startsWith('+')) {
      additions += 1
      if (current) current.additions += 1
      if (preview.length < maxPreviewLines) preview.push(line)
      else truncated = true
    } else if (line.startsWith('-')) {
      deletions += 1
      if (current) current.deletions += 1
      if (preview.length < maxPreviewLines) preview.push(line)
      else truncated = true
    } else if (line.startsWith('@@')) {
      if (preview.length < maxPreviewLines) preview.push(line)
    }
  }
  if (current) files.push(current)

  return {
    files: files.slice(0, maxFiles),
    additions,
    deletions,
    preview,
    truncated,
  }
}

/** Picks the newest workspace_diff artifact from a task-detail payload. */
export function pickWorkspaceDiffArtifact(
  artifacts: unknown,
): { id: string; filename: string | null; createdAt: number } | null {
  if (!Array.isArray(artifacts)) return null
  const candidates = artifacts
    .map((item) => record(item))
    .filter((item): item is UnknownRecord => item !== null)
    .map((item) => {
      const metadata = record(item.artifact_metadata) ?? {}
      const media = textValue(item.latest_media_type) ?? textValue(item.media_type)
      const filename = textValue(item.latest_filename) ?? textValue(item.filename)
      const kind = textValue(metadata.type) ?? textValue(metadata.artifact_type)
      const id = textValue(item.id)
      if (!id) return null
      const isDiff =
        media === 'text/x-diff' ||
        (filename ? filename.endsWith('.diff') : false) ||
        kind === 'workspace_diff'
      if (!isDiff) return null
      return { id, filename, createdAt: numberValue(item.created_at) ?? numberValue(item.updated_at) ?? 0 }
    })
    .filter((item): item is { id: string; filename: string | null; createdAt: number } => item !== null)
  candidates.sort((a, b) => b.createdAt - a.createdAt)
  return candidates[0] ?? null
}

function historyItems(detail: UnknownRecord): UnknownRecord[] {
  const task = record(detail.task) ?? detail
  const history = task.history
  return Array.isArray(history)
    ? history.map((item) => record(item)).filter((item): item is UnknownRecord => item !== null)
    : []
}

export function traceEventsFromTaskDetail(detail: unknown, limit = 8): TraceEvent[] {
  const payload = record(detail)
  if (!payload) return []
  return historyItems(payload)
    .map((item) => {
      const at =
        isoFromAny(item.at) ??
        isoFromAny(item.timestamp) ??
        isoFromAny(item.created_at) ??
        isoFromAny(item.updated_at)
      const kind =
        textValue(item.kind) ??
        textValue(item.type) ??
        textValue(item.event) ??
        textValue(item.action) ??
        'event'
      const summary =
        textValue(item.summary) ??
        textValue(item.message) ??
        textValue(item.reason) ??
        textValue(item.status) ??
        kind
      if (!at) return null
      return { at, kind, summary: summary.slice(0, 180) }
    })
    .filter((item): item is TraceEvent => item !== null)
    .slice(-limit)
}

export function attemptsFromTaskDetail(detail: unknown): { attempts?: number; maxAttempts?: number } {
  const payload = record(detail)
  if (!payload) return {}
  const task = record(payload.task) ?? payload
  const attempts =
    numberValue(task.attempts) ??
    numberValue(task.attempt_count) ??
    numberValue(task.repair_attempts) ??
    undefined
  const maxAttempts =
    numberValue(task.max_attempts) ??
    numberValue(task.maximum_attempts) ??
    undefined
  if (attempts !== undefined || maxAttempts !== undefined) {
    return {
      ...(attempts !== undefined ? { attempts } : {}),
      ...(maxAttempts !== undefined ? { maxAttempts } : {}),
    }
  }
  const retries = historyItems(payload).filter((item) => {
    const kind = `${item.kind ?? ''} ${item.type ?? ''} ${item.event ?? ''}`.toLowerCase()
    return kind.includes('retry') || kind.includes('attempt') || kind.includes('recovered')
  }).length
  return retries > 0 ? { attempts: retries } : {}
}

export function budgetFromTaskDetail(detail: unknown): AgentBudget | undefined {
  const payload = record(detail)
  if (!payload) return undefined
  const task = record(payload.task) ?? payload
  const cost = record(task.cost_summary) ?? {}
  const worker = record(task.worker_execution_context) ?? {}
  const budget: AgentBudget = {}

  const tokensUsed =
    numberValue(cost.tokens_total) ??
    numberValue(worker.tokens_used) ??
    numberValue(task.tokens_used)
  const tokensLimit =
    numberValue(worker.tokens_limit) ??
    numberValue(task.token_budget) ??
    numberValue(task.tokens_limit)
  if (tokensUsed !== null || tokensLimit !== null) {
    budget.tokens = { unit: 'tokens', used: tokensUsed, limit: tokensLimit }
  }

  const costUsed = numberValue(cost.cost_units) ?? numberValue(task.cost_used)
  const costLimit = numberValue(task.cost_budget) ?? numberValue(task.cost_limit)
  if (costUsed !== null || costLimit !== null) {
    budget.cost = { unit: 'cost', used: costUsed, limit: costLimit }
  }
  return Object.keys(budget).length > 0 ? budget : undefined
}

/** Time budget comes from the worker lease window, not from the task row. */
export function timeBudgetFromLease(
  lease: { acquired_at?: number; deadline_at?: number } | null | undefined,
  nowMs = Date.now(),
): AgentBudget['time'] | undefined {
  if (!lease) return undefined
  const acquired = numberValue(lease.acquired_at)
  const deadline = numberValue(lease.deadline_at)
  if (acquired === null || deadline === null || deadline <= acquired) return undefined
  return {
    unit: 'ms',
    limit: Math.round((deadline - acquired) * 1000),
    used: Math.max(0, Math.round((nowMs / 1000 - acquired) * 1000)),
  }
}

export function toolCallEvents(items: unknown, limit = 6): TraceEvent[] {
  if (!Array.isArray(items)) return []
  const events: TraceEvent[] = []
  for (const item of items) {
    const call = record(item)
    if (!call) continue
    const name = (textValue(call.tool_name) ?? '').toLowerCase()
    const target = textValue(call.target_path) ?? textValue(call.path)
    const changesFile =
      target !== null &&
      (name.includes('write') || name.includes('patch') || name.includes('edit') || name.includes('replace'))
    if (!changesFile) continue
    const at = isoFromAny(call.created_at) ?? isoFromAny(call.started_at) ?? isoFromAny(call.finished_at)
    if (!at) continue
    events.push({
      at,
      kind: 'file-change',
      summary: `${textValue(call.tool_name) ?? 'edit'} → ${target}`.slice(0, 180),
    })
  }
  return events.slice(-limit)
}

export function buildTrace(input: {
  taskDetail?: unknown
  diff?: AgentDiff
  lease?: { acquired_at?: number; deadline_at?: number } | null
  toolCalls?: unknown
  taskId?: string
  sessionId?: string
  nowMs?: number
}): AgentTrace | undefined {
  const trace: AgentTrace = {}
  if (input.taskId) trace.taskId = input.taskId
  if (input.sessionId) trace.sessionId = input.sessionId

  const attempts = attemptsFromTaskDetail(input.taskDetail)
  if (attempts.attempts !== undefined) trace.attempts = attempts.attempts
  if (attempts.maxAttempts !== undefined) trace.maxAttempts = attempts.maxAttempts

  const budget = budgetFromTaskDetail(input.taskDetail) ?? {}
  const time = timeBudgetFromLease(input.lease, input.nowMs)
  if (time) budget.time = time
  if (Object.keys(budget).length > 0) trace.budget = budget

  if (input.diff) trace.diff = input.diff

  const events = [
    ...traceEventsFromTaskDetail(input.taskDetail),
    ...toolCallEvents(input.toolCalls),
  ].sort((a, b) => a.at.localeCompare(b.at))
  if (events.length > 0) trace.events = events.slice(-10)

  return Object.keys(trace).length > 0 ? trace : undefined
}
