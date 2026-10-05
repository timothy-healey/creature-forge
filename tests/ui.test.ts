import { describe, expect, test } from 'vitest'

import { columnsFor } from '../src/ui'

/**
 * A picker lays itself out from how many options it has. Hand-written column
 * counts are what left `fan` alone on a row of its own after the tail list
 * changed length.
 */
describe('how wide a row of choices lays itself out', () => {
  test('a short list puts every option on one line', () => {
    expect(columnsFor(3)).toBe(3)
    expect(columnsFor(5)).toBe(5)
  })

  test('a long list splits into even rows rather than leaving an orphan', () => {
    expect(columnsFor(6)).toBe(3)
    expect(columnsFor(8)).toBe(4)
  })

  test('never asks for more columns than there are options', () => {
    for (let count = 1; count <= 12; count++) {
      expect(columnsFor(count), `${count} options`).toBeLessThanOrEqual(count)
      expect(columnsFor(count), `${count} options`).toBeGreaterThan(0)
    }
  })
})
