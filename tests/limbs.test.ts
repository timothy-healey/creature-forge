import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { CORE_JOINTS } from '../src/joints'
import { generate } from '../src/generate'
import { MESH_MODES, PAIR_COUNTS, defaultSpec, randomSpec, type CreatureSpec } from '../src/spec'

const walker = (edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
  const spec = defaultSpec()
  spec.body.frontLimb = 'forelegs'
  edit(spec)
  return spec
}

function feetOn(spec: CreatureSpec): number[] {
  const creature = generate(spec)
  creature.root.updateMatrixWorld(true)

  return Object.keys(creature.joints)
    .filter((name) => name.includes('Foot'))
    .map((name) => new THREE.Box3().expandByObject(creature.joints[name]!))
    .filter((box) => !box.isEmpty())
    .map((box) => box.min.y)
}

describe('limb pairs', () => {
  test.each(PAIR_COUNTS)('%i pairs puts that many on the ground', (pairs) => {
    expect(feetOn(walker((spec) => void (spec.limbs.pairs = pairs)))).toHaveLength(pairs * 2)
  })

  test.each(PAIR_COUNTS)('%i pairs all reach the same floor', (pairs) => {
    const heights = feetOn(walker((spec) => void (spec.limbs.pairs = pairs)))

    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.05)
  })

  test('still builds every joint a gait poses, even with one pair', () => {
    const creature = generate(walker((spec) => void (spec.limbs.pairs = 1)))

    for (const name of CORE_JOINTS) expect(creature.joints[name], name).toBeDefined()
  })

  test('a single pair hangs no geometry off the slot it does not use', () => {
    const creature = generate(walker((spec) => void (spec.limbs.pairs = 1)))

    expect(new THREE.Box3().expandByObject(creature.joints.frontUpperL!).isEmpty()).toBe(true)
    expect(new THREE.Box3().expandByObject(creature.joints.backUpperL!).isEmpty()).toBe(false)
  })

  test('more pairs cost more', () => {
    const counts = PAIR_COUNTS.map(
      (pairs) => generate(walker((spec) => void (spec.limbs.pairs = pairs))).triangleCount,
    )

    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeGreaterThan(counts[i - 1]!)
  })
})

describe('where a pair sits', () => {
  test('the foremost pair rides further up the body as it is moved forward', () => {
    const shoulder = (front: number) => {
      const creature = generate(walker((spec) => void (spec.limbs.front = front)))
      creature.root.updateMatrixWorld(true)
      return creature.joints.frontUpperL!.getWorldPosition(new THREE.Vector3()).y
    }

    expect(shoulder(0.9)).toBeGreaterThan(shoulder(0.5))
    expect(shoulder(0.5)).toBeGreaterThan(shoulder(0.1))
  })

  test('a pair moved up the body grows a longer leg to reach the same floor', () => {
    const reach = (front: number) => {
      const creature = generate(walker((spec) => void (spec.limbs.front = front)))
      creature.root.updateMatrixWorld(true)
      const shoulder = creature.joints.frontUpperL!.getWorldPosition(new THREE.Vector3())
      const foot = creature.joints.frontFootL!.getWorldPosition(new THREE.Vector3())
      return shoulder.y - foot.y
    }

    expect(reach(0.9)).toBeGreaterThan(reach(0.4))
  })

  test('stands on the ground wherever the pairs are put', () => {
    for (const back of [0, 0.3]) {
      for (const front of [0.4, 0.75, 1]) {
        for (const pairs of PAIR_COUNTS) {
          const spec = walker((s) => {
            s.limbs = { pairs, back, front }
          })
          const creature = generate(spec)
          creature.root.updateMatrixWorld(true)

          const label = `${pairs} pairs ${back}–${front}`
          expect(new THREE.Box3().setFromObject(creature.root).min.y, label).toBeCloseTo(0, 1)
        }
      }
    }
  })
})

describe('bilateral symmetry', () => {
  test('a limb and its opposite number are exact mirrors, not merely similar', () => {
    const creature = generate(defaultSpec())
    creature.root.updateMatrixWorld(true)

    // Measured on the geometry itself. A world-space box would differ merely
    // because a swayed spine hangs the two sides at different angles.
    const size = (joint: string) => {
      const box = new THREE.Box3()
      creature.joints[joint]!.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.geometry.computeBoundingBox()
        box.union(mesh.geometry.boundingBox!)
      })
      return box.getSize(new THREE.Vector3())
    }

    // An odd-sided prism is chiral, so this only holds because the left side is
    // built by reflecting the right rather than by re-running the same builder.
    for (const [left, right] of [
      ['backUpperL', 'backUpperR'],
      ['frontUpperL', 'frontUpperR'],
      ['backFootL', 'backFootR'],
    ]) {
      expect(size(left!).distanceTo(size(right!)), left).toBeLessThan(1e-9)
    }
  })

  test('holds in both mesh modes and across rolled creatures', () => {
    for (const mesh of MESH_MODES) {
      for (let seed = 0; seed < 10; seed++) {
        const spec = randomSpec()
        spec.body.mesh = mesh
        spec.body.mutation = 'none'
        const creature = generate(spec)
        creature.root.updateMatrixWorld(true)

        const span = (joint: string) => {
          const box = new THREE.Box3()
          creature.joints[joint]!.traverse((node) => {
            const mesh = node as THREE.Mesh
            if (!mesh.isMesh) return
            mesh.geometry.computeBoundingBox()
            box.union(mesh.geometry.boundingBox!)
          })
          return box
        }
        const left = span('backUpperL')
        if (left.isEmpty()) continue

        expect(left.getSize(new THREE.Vector3()).distanceTo(span('backUpperR').getSize(new THREE.Vector3()))).toBeLessThan(1e-9)
      }
    }
  })
})
