import { describe, expect, test } from 'vitest'
import { SLIDERS, clampSpec, defaultSpec, readSlider } from '../src/spec'

describe('defaultSpec', () => {
  test('puts every slider inside 0..1', () => {
    const spec = defaultSpec()

    for (const slider of SLIDERS) {
      const value = readSlider(spec, slider.path)
      expect(value, slider.path).toBeGreaterThanOrEqual(0)
      expect(value, slider.path).toBeLessThanOrEqual(1)
    }
  })

  test('hands back a fresh object each call, so edits do not leak', () => {
    const a = defaultSpec()
    a.head.length = 0.01

    expect(defaultSpec().head.length).not.toBe(0.01)
  })
})

describe('clampSpec', () => {
  test('pulls a slider above 1 back down to 1', () => {
    const spec = defaultSpec()
    spec.head.length = 4.2

    expect(clampSpec(spec).head.length).toBe(1)
  })

  test('pulls a slider below 0 back up to 0', () => {
    const spec = defaultSpec()
    spec.legs.thickness = -3

    expect(clampSpec(spec).legs.thickness).toBe(0)
  })

  test('replaces a NaN slider with the default, so geometry can never see NaN', () => {
    const spec = defaultSpec()
    spec.torso.width = NaN

    expect(clampSpec(spec).torso.width).toBe(defaultSpec().torso.width)
  })

  test('coerces an unknown head type to the default', () => {
    const spec = defaultSpec()
    ;(spec.head as { type: string }).type = 'trumpet'

    expect(clampSpec(spec).head.type).toBe(defaultSpec().head.type)
  })

  test('coerces an out-of-range horn count to the default', () => {
    const spec = defaultSpec()
    ;(spec.head as { horns: number }).horns = 9

    expect(clampSpec(spec).head.horns).toBe(defaultSpec().head.horns)
  })

  test('coerces a malformed colour to the default', () => {
    const spec = defaultSpec()
    ;(spec.colors as { body: string }).body = 'not-a-colour'

    expect(clampSpec(spec).colors.body).toBe(defaultSpec().colors.body)
  })

  test('leaves a valid spec untouched', () => {
    const spec = defaultSpec()

    expect(clampSpec(spec)).toEqual(spec)
  })
})
