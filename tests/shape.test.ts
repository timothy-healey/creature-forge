import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { generate } from '../src/generate'
import { WING_TYPES, defaultSpec, type CreatureSpec } from '../src/spec'

function worldPoints(node: THREE.Object3D): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  node.updateMatrixWorld(true)
  node.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    const position = mesh.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      out.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld))
    }
  })
  return out
}

function torsoBox(creature: ReturnType<typeof generate>): THREE.Box3 {
  const box = new THREE.Box3()
  creature.root.traverse((child) => {
    if (child.name === 'torso') box.expandByObject(child)
  })
  return box
}

const winged = (type: 'small' | 'large'): CreatureSpec => {
  const spec = defaultSpec()
  spec.wings.type = type
  return spec
}

describe('wings', () => {
  test.each(['small', 'large'] as const)('a %s wing never crosses the midline into the other side', (type) => {
    const creature = generate(winged(type))
    creature.root.updateMatrixWorld(true)

    for (const [name, sign] of [
      ['wingR', 1],
      ['wingL', -1],
    ] as const) {
      for (const point of worldPoints(creature.joints[name]!)) {
        expect(point.x * sign, `${name} vertex at x=${point.x.toFixed(3)}`).toBeGreaterThan(-0.02)
      }
    }
  })

  test.each(['small', 'large'] as const)('a %s wing reaches outside the body rather than inside it', (type) => {
    const creature = generate(winged(type))
    creature.root.updateMatrixWorld(true)
    const torso = torsoBox(creature)

    const right = worldPoints(creature.joints.wingR!)
    const left = worldPoints(creature.joints.wingL!)

    expect(Math.max(...right.map((p) => p.x))).toBeGreaterThan(torso.max.x)
    expect(Math.min(...left.map((p) => p.x))).toBeLessThan(torso.min.x)
  })

  test('a wing is a sheet, not a tube — it has no thickness of its own', () => {
    // Measured in the membrane's own space. A flat sheet swung into place has a
    // fat world-aligned box whatever it is, so the world box proves nothing.
    const creature = generate(winged('large'))

    let found = false
    creature.joints.wingR!.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.name !== 'membrane') return
      found = true
      mesh.geometry.computeBoundingBox()
      const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3())
      const widest = Math.max(size.x, size.y, size.z)

      expect(Math.min(size.x, size.y, size.z)).toBeCloseTo(0, 6)
      expect(widest).toBeGreaterThan(0.2)
    })

    expect(found, 'the wing has a membrane at all').toBe(true)
  })

  test('every wing setting still lands the creature on the ground', () => {
    for (const type of WING_TYPES) {
      const spec = defaultSpec()
      spec.wings.type = type
      const creature = generate(spec)
      creature.root.updateMatrixWorld(true)

      expect(new THREE.Box3().setFromObject(creature.root).min.y, type).toBeCloseTo(0, 1)
    }
  })
})

describe('the shape genes', () => {
  const withGene = (gene: 'edge' | 'section' | 'bulk', value: number): CreatureSpec => {
    const spec = defaultSpec()
    spec.shape[gene] = value
    return spec
  }

  test('section trades depth for width, which detail must never do', () => {
    // Measured on the torso: the whole-body box is set by leg spacing and tail
    // length, neither of which this gene touches.
    const ratio = (value: number) => {
      const creature = generate(withGene('section', value))
      creature.root.updateMatrixWorld(true)
      const box = new THREE.Box3()
      creature.root.traverse((child) => {
        if (child.name === 'torso') box.expandByObject(child)
      })
      const size = box.getSize(new THREE.Vector3())
      return size.x / size.z
    }

    expect(ratio(1)).toBeGreaterThan(ratio(0) * 1.6)
  })

  test('edge changes how many corners describe the same creature', () => {
    const soft = generate(withGene('edge', 0)).triangleCount
    const sharp = generate(withGene('edge', 1)).triangleCount

    expect(soft).toBeGreaterThan(sharp * 1.4)
  })

  test('bulk moves where a creature carries its mass', () => {
    const widestHeight = (value: number) => {
      const creature = generate(withGene('bulk', value))
      creature.root.updateMatrixWorld(true)

      let widest = 0
      let height = 0
      creature.root.traverse((child) => {
        if (child.name !== 'torso') return
        const mesh = child as THREE.Mesh
        const position = mesh.geometry.getAttribute('position')
        for (let i = 0; i < position.count; i++) {
          const point = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld)
          if (Math.abs(point.x) > widest) {
            widest = Math.abs(point.x)
            height = point.y
          }
        }
      })
      return height
    }

    expect(widestHeight(1)).toBeGreaterThan(widestHeight(0))
  })

  test('every combination of genes still builds a creature standing on the ground', () => {
    for (const edge of [0, 0.5, 1]) {
      for (const sectionGene of [0, 0.5, 1]) {
        for (const bulk of [0, 0.5, 1]) {
          const spec = defaultSpec()
          spec.shape = { edge, section: sectionGene, bulk }
          const label = `${edge}/${sectionGene}/${bulk}`

          const creature = generate(spec)
          creature.root.updateMatrixWorld(true)
          const box = new THREE.Box3().setFromObject(creature.root)

          expect(box.isEmpty(), label).toBe(false)
          expect(box.min.y, label).toBeCloseTo(0, 1)
          expect(creature.triangleCount, label).toBeGreaterThan(0)
        }
      }
    }
  })
})
