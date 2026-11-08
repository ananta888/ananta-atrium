import { describe, expect, it } from 'vitest'
import { buildNavGraph, findPath } from '../../src/sim/nav-graph.js'
import { campus } from '../../src/world/campus.js'

const graph = buildNavGraph(campus)

describe('navigation graph', () => {
  it('connects every room to every other room', () => {
    const roomNodes = [...graph.roomNode.values()]
    const from = roomNodes[0]
    expect(from).toBeDefined()
    for (const target of roomNodes.slice(1)) {
      const path = findPath(graph, from as string, target)
      expect(path.length).toBeGreaterThan(1)
    }
  })

  it('routes between buildings through the plaza gates', () => {
    const path = findPath(graph, 'room:atrium-hq-office-a', 'room:observatory-office-c')
    expect(path.length).toBeGreaterThan(4)
    expect(path.some((node) => node.startsWith('gate:'))).toBe(true)
    expect(path.some((node) => node.startsWith('plaza-'))).toBe(true)
  })

  it('is deterministic for equal inputs', () => {
    const a = findPath(graph, 'room:forge-office-a', 'room:observatory-lounge')
    const b = findPath(graph, 'room:forge-office-a', 'room:observatory-lounge')
    expect(a).toEqual(b)
  })

  it('returns an empty path for unknown nodes', () => {
    expect(findPath(graph, 'room:does-not-exist', 'room:atrium-hq-lobby')).toEqual([])
  })
})
