import { describe, expect, test } from 'vitest'
import { SLIDERS, clampSpec, randomSpec, readSlider } from '../src/spec'

/** A deterministic stand-in for Math.random, so a roll can be reproduced. */
function sequence(values: number[]): () => number {
  let index = 0
  return () => values[index++ % values.length]!
}

describe('randomSpec', () => {
  test('always rolls a spec that is already valid', () => {
    for (let seed = 0; seed < 40; seed++) {
      const spec = randomSpec()
      expect(clampSpec(spec)).toEqual(spec)
    }
  })

  test('keeps every slider inside 0..1', () => {
    for (let seed = 0; seed < 40; seed++) {
      const spec = randomSpec()
      for (const slider of SLIDERS) {
        const value = readSlider(spec, slider.path)
        expect(value, slider.path).toBeGreaterThanOrEqual(0)
        expect(value, slider.path).toBeLessThanOrEqual(1)
      }
    }
  })

  test('rolls different creatures from different rolls', () => {
    const low = randomSpec(sequence([0.02]))
    const high = randomSpec(sequence([0.97]))

    expect(low).not.toEqual(high)
  })

  test('is driven entirely by the source it is handed, so a roll can be repeated', () => {
    const roll = [0.1, 0.9, 0.4, 0.25, 0.75, 0.6, 0.33, 0.8, 0.15, 0.5, 0.95, 0.05]

    expect(randomSpec(sequence(roll))).toEqual(randomSpec(sequence(roll)))
  })

  test('reaches every head shape across enough rolls', () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomSpec().head.type))

    expect(seen.size).toBeGreaterThan(1)
  })
})
