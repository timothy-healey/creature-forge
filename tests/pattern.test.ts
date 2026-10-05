import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { generate } from '../src/generate'
import { MESH_MODES, MUTATIONS, PATTERNS, defaultSpec, randomSpec, type CreatureSpec } from '../src/spec'

/** One number per face, so two creatures can be compared colour for colour. */
function faceColours(spec: CreatureSpec): number[] {
  const out: number[] = []
  generate(spec).root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    const colour = mesh.geometry.getAttribute('color')
    for (let i = 0; i < colour.count; i += 3) {
      out.push(colour.getX(i) * 1e6 + colour.getY(i) * 1e3 + colour.getZ(i))
    }
  })
  return out
}

const painted = (edit: (spec: CreatureSpec) => void): CreatureSpec => {
  const spec = defaultSpec()
  edit(spec)
  return spec
}

function sharePainted(pattern: CreatureSpec['skin']['pattern']): number {
  const plain = faceColours(defaultSpec())
  const marked = faceColours(painted((spec) => void (spec.skin.pattern = pattern)))

  let changed = 0
  for (let i = 0; i < plain.length; i++) if (Math.abs(plain[i]! - marked[i]!) > 1e-4) changed++
  return changed / plain.length
}

describe('markings', () => {
  test('none leaves every face exactly as it was', () => {
    expect(sharePainted('none')).toBe(0)
  })

  test.each(PATTERNS.filter((pattern) => pattern !== 'none'))('%s marks some of the creature, not all of it', (pattern) => {
    const share = sharePainted(pattern)

    expect(share).toBeGreaterThan(0.1)
    expect(share).toBeLessThan(0.75)
  })

  test('add no triangles — a marking is a colour, not a part', () => {
    for (const pattern of PATTERNS) {
      const spec = painted((s) => void (s.skin.pattern = pattern))
      expect(generate(spec).triangleCount, pattern).toBe(generate(defaultSpec()).triangleCount)
    }
  })

  test('mark whole faces, so the edges stay hard the way the era wanted', () => {
    const creature = generate(painted((spec) => void (spec.skin.pattern = 'spots')))

    creature.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const colour = mesh.geometry.getAttribute('color')
      for (let i = 0; i < colour.count; i += 3) {
        // All three corners of a face carry one colour — never a gradient.
        expect(colour.getX(i + 1)).toBeCloseTo(colour.getX(i), 6)
        expect(colour.getX(i + 2)).toBeCloseTo(colour.getX(i), 6)
      }
    })
  })

  test('strength decides how far a marked face moves toward the marking colour', () => {
    const faint = faceColours(painted((spec) => {
      spec.skin.pattern = 'spots'
      spec.skin.strength = 0.15
    }))
    const bold = faceColours(painted((spec) => {
      spec.skin.pattern = 'spots'
      spec.skin.strength = 1
    }))
    const plain = faceColours(defaultSpec())

    const drift = (values: number[]) =>
      values.reduce((sum, value, i) => sum + Math.abs(value - plain[i]!), 0)

    expect(drift(bold)).toBeGreaterThan(drift(faint) * 2)
  })

  test('survive every mutation and both mesh modes', () => {
    for (const mutation of MUTATIONS) {
      for (const mesh of MESH_MODES) {
        const spec = randomSpec()
        spec.skin.pattern = 'patches'
        spec.body.mutation = mutation
        spec.body.mesh = mesh
        const creature = generate(spec)
        creature.root.updateMatrixWorld(true)

        const label = `${mutation}/${mesh}`
        expect(new THREE.Box3().setFromObject(creature.root).isEmpty(), label).toBe(false)
        expect(creature.triangleCount, label).toBeGreaterThan(0)
      }
    }
  })

  test('the rolled marking colour stays in the family of the body colour', () => {
    const hue = (hex: string) => new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }).h

    for (let seed = 0; seed < 60; seed++) {
      const colours = randomSpec().colors
      const apart = Math.abs(hue(colours.pattern) - hue(colours.body))

      expect(Math.min(apart, 1 - apart)).toBeLessThan(0.2)
    }
  })
})
