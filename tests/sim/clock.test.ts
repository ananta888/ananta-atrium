import { describe, expect, it } from 'vitest'
import { FixedStepDriver } from '../../src/sim/clock.js'

describe('FixedStepDriver', () => {
  it('runs whole ticks only', () => {
    const clock = new FixedStepDriver({ tickSeconds: 1 / 30 })
    let ticks = 0
    clock.advance(0.1, () => ticks++)
    expect(ticks).toBe(3)
    expect(clock.tick).toBe(3)
  })

  it('clamps long frame gaps instead of spiralling', () => {
    const clock = new FixedStepDriver({ tickSeconds: 1 / 30, maxStepsPerFrame: 4 })
    let ticks = 0
    clock.advance(10, () => ticks++)
    expect(ticks).toBe(4)
  })

  it('exposes an interpolation fraction within a tick', () => {
    const clock = new FixedStepDriver({ tickSeconds: 0.5 })
    clock.advance(0.75, () => undefined)
    expect(clock.interpolate).toBeCloseTo(0.5, 5)
  })

  it('ignores negative or non-finite deltas', () => {
    const clock = new FixedStepDriver({ tickSeconds: 0.1 })
    expect(clock.advance(-1, () => undefined)).toBe(0)
    expect(clock.advance(Number.NaN, () => undefined)).toBe(0)
  })
})
