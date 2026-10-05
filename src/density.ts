/**
 * How tightly the sheet is packed.
 *
 * A drawing sheet does not scroll, so the controls have to fit the sheet rather
 * than the sheet growing to fit the controls. Rather than tune one layout to one
 * window height, each rail measures itself and steps down through density levels
 * until its content fits — and only scrolls if it runs out of compression, which
 * is an honest last resort rather than the normal state.
 */

export const DENSITY_LEVELS = 4

export interface Fit {
  /** How much room the content wants at this level. */
  needed: number
  /** How much room there is. */
  available: number
}

/**
 * The loosest level whose content still fits, or the tightest if none does.
 *
 * Loosest-that-fits rather than tightest-that-fits: compression is a cost, and
 * a rail that always jumped to the tightest level would be cramped on a tall
 * screen for no reason.
 */
export function fitDensity(measure: (level: number) => Fit, levels = DENSITY_LEVELS): number {
  for (let level = 0; level < levels; level++) {
    const { needed, available } = measure(level)
    if (!Number.isFinite(needed) || !Number.isFinite(available)) return 0
    // A sub-pixel overhang is a rounding artefact, not an overflow.
    if (needed <= available + 1) return level
  }
  return levels - 1
}

/** Steps a live element through its levels and leaves it at the one that fits. */
export function fitElement(element: HTMLElement, levels = DENSITY_LEVELS): number {
  const level = fitDensity((candidate) => {
    element.dataset.density = String(candidate)
    return { needed: element.scrollHeight, available: element.clientHeight }
  }, levels)

  element.dataset.density = String(level)
  element.dataset.overflowing = String(element.scrollHeight > element.clientHeight + 1)
  return level
}

/** Keeps a set of rails fitted as the window changes shape. */
export function keepFitted(elements: readonly HTMLElement[]): () => void {
  const fitAll = () => {
    for (const element of elements) fitElement(element)
  }

  fitAll()
  const observer = new ResizeObserver(fitAll)
  for (const element of elements) observer.observe(element)
  return () => observer.disconnect()
}
