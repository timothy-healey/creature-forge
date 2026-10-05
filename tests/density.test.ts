import { describe, expect, test } from 'vitest'
import { DENSITY_LEVELS, fitDensity } from '../src/density'

/** Content that shrinks as the level tightens, against a fixed rail height. */
const shrinking = (at: readonly number[], available: number) => (level: number) => ({
  needed: at[level] ?? at[at.length - 1]!,
  available,
})

describe('picking a density', () => {
  test('stays loose when everything already fits', () => {
    expect(fitDensity(shrinking([600, 520, 460, 420], 720))).toBe(0)
  })

  test('tightens only as far as it has to', () => {
    expect(fitDensity(shrinking([1000, 860, 700, 640], 720))).toBe(2)
  })

  test('bottoms out rather than failing when nothing fits', () => {
    expect(fitDensity(shrinking([1400, 1300, 1200, 1100], 400))).toBe(DENSITY_LEVELS - 1)
  })

  test('takes the first level that fits, not the tightest that would', () => {
    // Compression is a cost: a tall screen should not be cramped for no reason.
    expect(fitDensity(shrinking([700, 500, 300, 200], 720))).toBe(0)
  })

  test('forgives a sub-pixel overhang, which is rounding and not overflow', () => {
    expect(fitDensity(shrinking([720.4, 600, 500, 400], 720))).toBe(0)
  })

  test('falls back to loose when a measurement is not a number', () => {
    expect(fitDensity(() => ({ needed: Number.NaN, available: 720 }))).toBe(0)
  })

  test('reports every level it was given, never beyond', () => {
    for (let levels = 1; levels <= 6; levels++) {
      const level = fitDensity(shrinking([9999], 100), levels)
      expect(level).toBe(levels - 1)
    }
  })
})
