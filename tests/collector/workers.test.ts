import { describe, expect, it } from 'vitest'
import { AnantaHubSource, mapWorkerToAgent } from '../../collector/ananta-source.js'
import { campus } from '../../src/world/campus.js'

describe('worker registry', () => {
  it('maps a worker with current and planned tasks plus organization path', () => {
    const agent = mapWorkerToAgent(
      { id: 'ananta-worker-1', url: 'http://ai-agent-alpha:5000', runtime: 'docker_container', health: 'online', worker_roles: ['coder'] },
      {
        id: 't1',
        title: 'Current task',
        status: 'proposing',
        priority: 'high',
        team_id: 'team-1',
        project_id: 'project-1',
        goal_id: 'goal-1',
        plan_node_id: 'node-1',
      },
      { id: 't2', title: 'Next queued task', status: 'todo', priority: 'high' },
      campus,
      1_760_000_000_000,
      { teamId: 'team-1', teamName: 'Ananta Self Development', roleName: 'Reviewer', memberId: 'm-1' },
    )
    expect(agent.role).toBe('Reviewer')
    expect(agent.assignment?.path?.teamName).toBe('Ananta Self Development')
    expect(agent.id).toBe('worker:ananta-worker-1')
    expect(agent.name).toBe('ananta-worker-1')
    expect(agent.status).toBe('waiting')
    expect(agent.assignment?.planned?.title).toBe('Next queued task')
    expect(agent.assignment?.path).toMatchObject({ teamId: 'team-1', projectId: 'project-1', goalId: 'goal-1' })
    expect(agent.assignment?.workerUrl).toBe('http://ai-agent-alpha:5000')
  })

  it('prefers the worker registry over tasks when building the live agent set', async () => {
    const fetcher = (async (url: string) => {
      const path = new URL(String(url)).pathname
      if (path === '/api/sessions') return new Response(JSON.stringify({ data: { items: [] } }), { status: 200 })
      if (path === '/api/workers') {
        return new Response(
          JSON.stringify({
            data: {
              items: [
                { id: 'w1', url: 'http://w1:5000', health: 'online', runtime: 'docker_container', worker_roles: ['coder'] },
                { id: 'w2', url: 'http://w2:5000', health: 'online', runtime: 'docker_container', worker_roles: ['reviewer'] },
              ],
            },
          }),
          { status: 200 },
        )
      }
      if (path === '/tasks') {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 't1',
                title: 'Assigned current',
                status: 'proposing',
                assigned_agent_url: 'http://w1:5000',
                updated_at: 10,
                team_id: 'team-1',
              },
              { id: 't2', title: 'Queued work', status: 'todo', priority: 'high', updated_at: 9 },
            ],
          }),
          { status: 200 },
        )
      }
      return new Response('{}', { status: 404 })
    }) as typeof fetch
    const source = new AnantaHubSource({ baseUrl: 'http://hub', token: 'token', campus, fetcher, traceEnabled: false })
    const agents = await source.poll()
    expect(agents.map((agent) => agent.id)).toEqual(['worker:w1', 'worker:w2'])
    expect(agents[0]?.task.title).toBe('Assigned current')
    expect(agents[0]?.assignment?.planned?.title).toBe('Queued work')
    expect(agents[1]?.status).toBe('idle')
  })
})
