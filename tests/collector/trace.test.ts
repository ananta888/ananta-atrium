import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'
import {
  attemptsFromTaskDetail,
  buildTrace,
  parseUnifiedDiff,
  pickWorkspaceDiffArtifact,
  timeBudgetFromLease,
  toolCallEvents,
} from '../../collector/trace.js'
import type { AgentState } from '../../src/shared/agent-state.js'

const here = dirname(fileURLToPath(import.meta.url))
const schema = JSON.parse(
  readFileSync(join(here, '../../src/shared/agent-state.schema.json'), 'utf8'),
) as object
const validate = new Ajv({ strict: false, validateFormats: false }).compile(schema)

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
-old line
+new line
+another line
 context
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-old
+new
`

const TASK_DETAIL = {
  task: {
    id: 'task-1',
    title: 'Build the thing',
    attempts: 2,
    max_attempts: 4,
    history: [
      { type: 'created', summary: 'Task created', created_at: 1_760_000_000 },
      { type: 'retry', summary: 'Retry 1', created_at: 1_760_000_100 },
    ],
    cost_summary: { tokens_total: 1234, cost_units: 0.42 },
    worker_execution_context: { tokens_limit: 4000 },
  },
  artifacts: [
    { id: 'artifact-old', latest_media_type: 'text/x-diff', created_at: 10 },
    { id: 'artifact-new', latest_media_type: 'text/x-diff', created_at: 20, latest_filename: 'task.workspace.diff' },
    { id: 'other', latest_media_type: 'application/json', created_at: 30 },
  ],
}

describe('trace parsing', () => {
  it('parses file stats and preview from a unified diff', () => {
    const diff = parseUnifiedDiff(DIFF)
    expect(diff.files.map((file) => file.path)).toEqual(['src/a.ts', 'README.md'])
    expect(diff.additions).toBe(3)
    expect(diff.deletions).toBe(2)
    expect(diff.preview.length).toBeGreaterThan(2)
    expect(diff.truncated).toBe(false)
  })

  it('truncates large diffs', () => {
    const big = Array.from({ length: 100 }, (_, index) => `+line ${index}`).join('\n')
    expect(parseUnifiedDiff(big, { maxPreviewLines: 10 }).truncated).toBe(true)
  })

  it('picks the newest workspace diff artifact', () => {
    expect(pickWorkspaceDiffArtifact(TASK_DETAIL.artifacts)?.id).toBe('artifact-new')
    expect(pickWorkspaceDiffArtifact([])).toBeNull()
  })

  it('extracts attempts, budgets, events and leases', () => {
    expect(attemptsFromTaskDetail(TASK_DETAIL)).toEqual({ attempts: 2, maxAttempts: 4 })
    expect(timeBudgetFromLease({ acquired_at: 100, deadline_at: 700 }, 400_000)).toEqual({
      unit: 'ms',
      limit: 600_000,
      used: 300_000,
    })
    const events = toolCallEvents([
      { tool_name: 'repo.write_file', target_path: 'src/a.ts', created_at: 1_760_000_200 },
      { tool_name: 'read_file', target_path: 'src/a.ts', created_at: 1_760_000_300 },
    ])
    expect(events).toHaveLength(1)
    expect(events[0]?.summary).toContain('src/a.ts')
  })

  it('builds a schema-valid AgentState with trace data', () => {
    const diff = parseUnifiedDiff(DIFF)
    diff.artifactId = 'artifact-new'
    const trace = buildTrace({
      taskDetail: TASK_DETAIL,
      diff,
      lease: { acquired_at: 1_760_000_000, deadline_at: 1_760_000_600 },
      toolCalls: [{ tool_name: 'repo.write_file', target_path: 'src/a.ts', created_at: 1_760_000_500 }],
      taskId: 'task-1',
      sessionId: 'session-1',
      nowMs: 1_760_000_300_000,
    })
    const state: AgentState = {
      schemaVersion: 1,
      id: 'session-1',
      name: 'Ada',
      role: 'Engineer',
      status: 'working',
      buildingId: 'b',
      roomId: 'r',
      deskId: 'd',
      task: { title: 'Build the thing', progress: 0.5, taskId: 'task-1' },
      activity: { kind: 'typing' },
      updatedAt: '2026-01-01T09:00:00.000Z',
      source: 'live',
      stale: false,
      ...(trace ? { trace } : {}),
    }
    expect(validate(state)).toBe(true)
    expect(trace?.budget?.time?.limit).toBe(600_000)
    expect(trace?.budget?.tokens).toEqual({ unit: 'tokens', used: 1234, limit: 4000 })
    expect(trace?.attempts).toBe(2)
    expect(trace?.diff?.files).toHaveLength(2)
  })

  it('leaves unknown budget fields null instead of inventing numbers', () => {
    const trace = buildTrace({ taskDetail: { task: { id: 't' } }, taskId: 't' })
    expect(trace?.budget).toBeUndefined()
    expect(trace?.attempts).toBeUndefined()
  })
})
