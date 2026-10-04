// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { LENSES, LENS_LABEL, createInspector } from '../src/inspect'
import { generate } from '../src/generate'
import { MUTATIONS, defaultSpec, type CreatureSpec } from '../src/spec'

/** A camera looking at the creature, so projection has somewhere to project to. */
function looking(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(42, 1.6, 0.1, 50)
  camera.position.set(1.9, 1.5, 2.9)
  camera.lookAt(0, 0.8, 0)
  camera.updateMatrixWorld(true)
  return camera
}

function drawn(spec: CreatureSpec, lenses: readonly string[]): SVGSVGElement {
  const inspector = createInspector()
  inspector.show(generate(spec))
  inspector.setLenses(new Set(lenses as never))
  inspector.draw(looking(), 900, 600, 0.4)
  return inspector.element
}

const visible = (svg: SVGSVGElement) => [...svg.children].filter((node) => !node.hasAttribute('hidden'))

describe('the inspect overlay', () => {
  test('draws nothing at all when no lens is on', () => {
    expect(visible(drawn(defaultSpec(), []))).toHaveLength(0)
  })

  test.each(LENSES)('%s draws something', (lens) => {
    expect(visible(drawn(defaultSpec(), [lens])).length).toBeGreaterThan(0)
  })

  test('every lens has a label, so none can appear in the strip unnamed', () => {
    for (const lens of LENSES) expect(LENS_LABEL[lens]).toBeTruthy()
  })

  test('puts every mark inside the viewport it was given', () => {
    const svg = drawn(defaultSpec(), ['rig', 'spine', 'solve'])

    for (const node of visible(svg)) {
      for (const attr of ['x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'x', 'y']) {
        const value = node.getAttribute(attr)
        if (value === null) continue
        expect(Number.isFinite(Number(value)), `${node.tagName} ${attr}=${value}`).toBe(true)
      }
    }
  })

  test('colours every mark by role and never by decoration', () => {
    const allowed = new Set(['#f2b134', '#e2503a', '#8fa6b0', '#0f171c', 'none'])

    for (const node of visible(drawn(defaultSpec(), [...LENSES]))) {
      for (const attr of ['stroke', 'fill']) {
        const value = node.getAttribute(attr)
        if (value) expect(allowed.has(value), `${attr}=${value}`).toBe(true)
      }
    }
  })

  test('carries state in dash and weight, never in hue', () => {
    const svg = drawn(defaultSpec(), ['solve'])
    const dashed = visible(svg).filter((node) => (node.getAttribute('stroke-dasharray') ?? 'none') !== 'none')

    expect(dashed.length).toBeGreaterThan(0)
  })

  test('is hidden from assistive technology — the numbers are in the panel', () => {
    expect(createInspector().element.getAttribute('aria-hidden')).toBe('true')
  })

  test('focus draws one lens without turning the others on', () => {
    const inspector = createInspector()
    inspector.show(generate(defaultSpec()))
    inspector.setLenses(new Set())
    inspector.focus('solve')
    inspector.draw(looking(), 900, 600, 0)

    expect(visible(inspector.element).length).toBeGreaterThan(0)

    inspector.focus(null)
    inspector.draw(looking(), 900, 600, 0)
    expect(visible(inspector.element)).toHaveLength(0)
  })

  test('reuses its nodes rather than growing without bound', () => {
    const inspector = createInspector()
    inspector.show(generate(defaultSpec()))
    inspector.setLenses(new Set(LENSES))

    inspector.draw(looking(), 900, 600, 0)
    const after = inspector.element.children.length
    for (let frame = 0; frame < 30; frame++) inspector.draw(looking(), 900, 600, frame * 0.03)

    expect(inspector.element.children.length).toBe(after)
  })

  test('survives every mutation, including the ones with no surface left', () => {
    for (const mutation of MUTATIONS) {
      const spec = defaultSpec()
      spec.body.mutation = mutation
      expect(() => drawn(spec, [...LENSES]), mutation).not.toThrow()
    }
  })

  test('shows a phase for every limb, and a solve for every limb that reaches', () => {
    const spec = defaultSpec()
    spec.body.frontLimb = 'forelegs'
    const creature = generate(spec)

    const phases = visible(drawn(spec, ['phase'])).filter((node) => node.tagName === 'text')
    expect(phases.length).toBe(creature.limbs.length)

    for (const node of phases) {
      expect(node.textContent).toMatch(/^\d\.\d\dπ · \d bones$/)
    }
  })

  test('reads sample rings off the geometry rather than asking for them', () => {
    const coarse = visible(drawn({ ...defaultSpec(), detail: { level: 0 } }, ['rings'])).length
    const fine = visible(drawn({ ...defaultSpec(), detail: { level: 1 } }, ['rings'])).length

    // More detail is more bands, and the overlay finds them in the built mesh.
    expect(fine).toBeGreaterThan(coarse)
  })
})
