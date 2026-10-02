import { describe, expect, test } from 'vitest'
import {
  BUILDS,
  EAR_TYPES,
  FRONT_LIMBS,
  RIDGE_TYPES,
  SEGMENT_COUNTS,
  SLIDERS,
  WING_TYPES,
  clampSpec,
  defaultSpec,
  randomSpec,
} from '../src/spec'

describe('the body plan', () => {
  test('carries a build, a front-limb role and a torso segment count', () => {
    const spec = defaultSpec()

    expect(BUILDS).toContain(spec.body.build)
    expect(FRONT_LIMBS).toContain(spec.body.frontLimb)
    expect(SEGMENT_COUNTS).toContain(spec.torso.segments)
  })

  test('coerces an unknown build back to the default', () => {
    const spec = defaultSpec()
    ;(spec.body as { build: string }).build = 'hovering'

    expect(clampSpec(spec).body.build).toBe(defaultSpec().body.build)
  })

  test('coerces an impossible segment count back to the default', () => {
    const spec = defaultSpec()
    ;(spec.torso as { segments: number }).segments = 97

    expect(clampSpec(spec).torso.segments).toBe(defaultSpec().torso.segments)
  })

  test('coerces unknown decoration back to the default', () => {
    const spec = defaultSpec()
    ;(spec.back as { ridge: string }).ridge = 'antennae'
    ;(spec.wings as { type: string }).type = 'jet'
    ;(spec.head as { ears: string }).ears = 'satellite'

    const clamped = clampSpec(spec)

    expect(RIDGE_TYPES).toContain(clamped.back.ridge)
    expect(WING_TYPES).toContain(clamped.wings.type)
    expect(EAR_TYPES).toContain(clamped.head.ears)
  })

  test('exposes neck length as a slider, so the panel picks it up for free', () => {
    expect(SLIDERS.map((slider) => slider.path)).toContain('neck.length')
  })
})

describe('randomSpec, across the plan', () => {
  const rolls = Array.from({ length: 300 }, () => randomSpec())

  test('rolls only valid plans', () => {
    for (const spec of rolls) expect(clampSpec(spec)).toEqual(spec)
  })

  test('reaches every build, so quadrupeds actually turn up', () => {
    expect(new Set(rolls.map((spec) => spec.body.build)).size).toBe(BUILDS.length)
  })

  test('reaches both front-limb roles', () => {
    expect(new Set(rolls.map((spec) => spec.body.frontLimb)).size).toBe(FRONT_LIMBS.length)
  })

  test('reaches every ridge, ear and wing', () => {
    expect(new Set(rolls.map((spec) => spec.back.ridge)).size).toBe(RIDGE_TYPES.length)
    expect(new Set(rolls.map((spec) => spec.head.ears)).size).toBe(EAR_TYPES.length)
    expect(new Set(rolls.map((spec) => spec.wings.type)).size).toBe(WING_TYPES.length)
  })
})

describe('the rolled palette', () => {
  const rolls = Array.from({ length: 200 }, () => randomSpec().colors)

  test('is always a valid six-digit hex per slot', () => {
    for (const colors of rolls) {
      for (const value of Object.values(colors)) {
        expect(value).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  test('is generated rather than drawn from a short fixed list', () => {
    const distinct = new Set(rolls.map((colors) => colors.body))

    expect(distinct.size).toBeGreaterThan(100)
  })

  test('keeps the eye darker than the body it sits in', () => {
    const luminance = (hex: string) =>
      Number.parseInt(hex.slice(1, 3), 16) * 0.299 +
      Number.parseInt(hex.slice(3, 5), 16) * 0.587 +
      Number.parseInt(hex.slice(5, 7), 16) * 0.114

    for (const colors of rolls) {
      expect(luminance(colors.eye)).toBeLessThan(luminance(colors.body))
    }
  })

  test('keeps the belly lighter than the body, the way a real animal is countershaded', () => {
    const luminance = (hex: string) =>
      Number.parseInt(hex.slice(1, 3), 16) * 0.299 +
      Number.parseInt(hex.slice(3, 5), 16) * 0.587 +
      Number.parseInt(hex.slice(5, 7), 16) * 0.114

    for (const colors of rolls) {
      expect(luminance(colors.belly)).toBeGreaterThan(luminance(colors.body))
    }
  })
})
