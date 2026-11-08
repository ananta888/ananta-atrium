import { describe, expect, it } from 'vitest'
import { applyLook, DEFAULT_LOOK } from '../../src/app/look.js'

describe('mouse look axes', () => {
  it('turns right when the mouse moves right', () => {
    const next = applyLook({ yaw: 0, pitch: 0 }, 100, 0, DEFAULT_LOOK)
    expect(next.yaw).toBeGreaterThan(0)
  })

  it('looks up when the mouse moves up', () => {
    const next = applyLook({ yaw: 0, pitch: 0 }, 0, -100, DEFAULT_LOOK)
    expect(next.pitch).toBeLessThan(0)
  })

  it('inverts each axis independently', () => {
    const x = applyLook({ yaw: 0, pitch: 0 }, 100, 0, { ...DEFAULT_LOOK, invertX: true })
    const y = applyLook({ yaw: 0, pitch: 0 }, 0, -100, { ...DEFAULT_LOOK, invertY: true })
    expect(x.yaw).toBeLessThan(0)
    expect(y.pitch).toBeGreaterThan(0)
  })

  it('scales with sensitivity and clamps pitch', () => {
    const slow = applyLook({ yaw: 0, pitch: 0 }, 10, 0, { ...DEFAULT_LOOK, sensitivity: 0.001 })
    const fast = applyLook({ yaw: 0, pitch: 0 }, 10, 0, { ...DEFAULT_LOOK, sensitivity: 0.004 })
    expect(fast.yaw).toBeGreaterThan(slow.yaw)
    expect(applyLook({ yaw: 0, pitch: 0 }, 0, -100000, DEFAULT_LOOK).pitch).toBe(-1.35)
    expect(applyLook({ yaw: 0, pitch: 0 }, 0, 100000, DEFAULT_LOOK).pitch).toBe(1.35)
  })
})
