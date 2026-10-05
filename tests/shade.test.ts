import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { bakeShading, createBlobShadow, fitBlobShadow } from '../src/shade'
import { generate } from '../src/generate'
import { SCENERY } from '../src/render'
import { defaultSpec, randomSpec, type CreatureSpec } from '../src/spec'

const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

function surfaceValue(spec: CreatureSpec, match: (name: string) => boolean = () => true): number {
  const creature = generate(spec)
  let sum = 0
  let count = 0
  creature.root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || !match(mesh.name)) return
    const colour = mesh.geometry.getAttribute('color')
    for (let i = 0; i < colour.count; i += 3) {
      sum += luminance(colour.getX(i), colour.getY(i), colour.getZ(i))
      count++
    }
  })
  return count ? sum / count : 0
}

const baked = (amount: number): CreatureSpec => {
  const spec = defaultSpec()
  spec.bake.amount = amount
  return spec
}

describe('reading a creature at a couple of hundred pixels', () => {
  test('it carries enough value to stand off the ground it stands on', () => {
    const ground = new THREE.Color(SCENERY.void.ground!)
    const floor = luminance(ground.r, ground.g, ground.b)

    expect(contrast(surfaceValue(defaultSpec()), floor)).toBeGreaterThan(3)
  })

  test('and so does every creature the roll can produce', () => {
    const ground = new THREE.Color(SCENERY.void.ground!)
    const floor = luminance(ground.r, ground.g, ground.b)

    for (let seed = 0; seed < 40; seed++) {
      expect(contrast(surfaceValue(randomSpec()), floor)).toBeGreaterThan(2)
    }
  })

  test('a limb reads against the torso behind it', () => {
    const torso = surfaceValue(defaultSpec(), (name) => name.startsWith('torso'))
    const limb = surfaceValue(defaultSpec(), (name) => name.includes('Upper') || name.includes('Lower'))

    expect(contrast(torso, limb)).toBeGreaterThan(1.5)
  })
})

describe('baked light', () => {
  test('leaves the palette untouched at zero', () => {
    const plain = generate(baked(0))
    let changed = false
    plain.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh || mesh.name !== 'skull') return
      const colour = mesh.geometry.getAttribute('color')
      const body = new THREE.Color(defaultSpec().colors.body)
      for (let i = 0; i < colour.count; i += 3) {
        if (Math.abs(colour.getX(i) - body.r) < 1e-6) changed = true
      }
    })

    expect(changed).toBe(true)
  })

  test('brightens what points up and darkens what points down', () => {
    const creature = generate(baked(1))
    let up = 0
    let upCount = 0
    let down = 0
    let downCount = 0

    creature.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh || !mesh.name.startsWith('torso')) return
      const position = mesh.geometry.getAttribute('position')
      const colour = mesh.geometry.getAttribute('color')

      for (let i = 0; i < position.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(position, i)
        const b = new THREE.Vector3().fromBufferAttribute(position, i + 1)
        const c = new THREE.Vector3().fromBufferAttribute(position, i + 2)
        const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize()
        const value = luminance(colour.getX(i), colour.getY(i), colour.getZ(i))

        if (normal.y > 0.5) {
          up += value
          upCount++
        } else if (normal.y < -0.5) {
          down += value
          downCount++
        }
      }
    })

    expect(upCount).toBeGreaterThan(0)
    expect(downCount).toBeGreaterThan(0)
    // Baking that only ever subtracts makes a dark creature darker, which is
    // the opposite of what it is for.
    expect(up / upCount).toBeGreaterThan(down / downCount)
  })

  test('never pushes a colour past white', () => {
    const creature = generate(baked(1))

    creature.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const colour = mesh.geometry.getAttribute('color')
      for (let i = 0; i < colour.count; i += 13) {
        expect(colour.getX(i)).toBeLessThanOrEqual(1)
        expect(colour.getY(i)).toBeLessThanOrEqual(1)
      }
    })
  })

  test('does nothing when handed no joints to crease against', () => {
    const geometry = generate(defaultSpec())
    let sample: THREE.BufferGeometry | null = null
    geometry.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (mesh.isMesh && !sample) sample = mesh.geometry
    })

    const before = (sample as unknown as THREE.BufferGeometry).getAttribute('color').getX(0)
    bakeShading([{ geometry: sample as unknown as THREE.BufferGeometry, node: new THREE.Object3D() }], {
      amount: 0,
      joints: [],
      scale: 0.4,
    })

    expect((sample as unknown as THREE.BufferGeometry).getAttribute('color').getX(0)).toBe(before)
  })
})

describe('the blob shadow', () => {
  test('lies flat on the floor under the creature', () => {
    const creature = generate(defaultSpec())
    creature.root.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(creature.root)

    const blob = createBlobShadow()
    fitBlobShadow(blob, bounds)

    expect(blob.position.y).toBeCloseTo(bounds.min.y, 2)
    expect(blob.scale.y).toBe(1)
  })

  test('covers what the creature stands over, whatever shape it is', () => {
    for (const mutation of ['none', 'segmented', 'coiled'] as const) {
      const spec = defaultSpec()
      spec.body.mutation = mutation
      const creature = generate(spec)
      creature.root.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(creature.root)
      const size = bounds.getSize(new THREE.Vector3())

      const blob = createBlobShadow()
      fitBlobShadow(blob, bounds)

      expect(blob.scale.x, mutation).toBeGreaterThanOrEqual(Math.max(size.x, size.z))
    }
  })

  test('never collapses to nothing for a tiny creature', () => {
    const blob = createBlobShadow()
    fitBlobShadow(blob, new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(0.001, 0.001, 0.001)))

    expect(blob.scale.x).toBeGreaterThan(0.1)
  })
})
