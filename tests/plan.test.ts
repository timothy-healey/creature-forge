import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { generate } from '../src/generate'
import {
  BUILDS,
  EAR_TYPES,
  FRONT_LIMBS,
  RIDGE_TYPES,
  TAIL_TYPES,
  WING_TYPES,
  defaultSpec,
  randomSpec,
  type CreatureSpec,
} from '../src/spec'

function boxOf(spec: CreatureSpec): THREE.Box3 {
  const creature = generate(spec)
  creature.root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(creature.root)
  creature.dispose()
  return box
}

function footHeight(spec: CreatureSpec, joint: string): number {
  const creature = generate(spec)
  creature.root.updateMatrixWorld(true)
  const box = new THREE.Box3().expandByObject(creature.joints[joint]!)
  creature.dispose()
  return box.min.y
}

const quadruped = (): CreatureSpec => {
  const spec = defaultSpec()
  spec.body.build = 'quadruped'
  spec.body.frontLimb = 'forelegs'
  return spec
}

describe('the detail slider', () => {
  const levels = [0, 0.25, 0.5, 0.75, 1]

  test('adds triangles as it rises', () => {
    const counts = levels.map((level) => {
      const spec = defaultSpec()
      spec.detail.level = level
      const creature = generate(spec)
      const count = creature.triangleCount
      creature.dispose()
      return count
    })

    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]!, `level ${levels[i]}`).toBeGreaterThan(counts[i - 1]!)
    }
  })

  test('keeps the same silhouette while it does, which is the whole point', () => {
    const reference = boxOf({ ...defaultSpec(), detail: { level: 0.5 } })
    const size = reference.getSize(new THREE.Vector3())

    for (const level of levels) {
      const box = boxOf({ ...defaultSpec(), detail: { level } })
      const other = box.getSize(new THREE.Vector3())

      for (const axis of ['x', 'y', 'z'] as const) {
        const drift = Math.abs(other[axis] - size[axis]) / size[axis]
        expect(drift, `${axis} at level ${level}`).toBeLessThan(0.12)
      }
    }
  })

  test('never produces a NaN vertex at any level', () => {
    for (const level of levels) {
      const spec = randomSpec()
      spec.detail.level = level
      const creature = generate(spec)

      creature.root.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh) return
        const position = mesh.geometry.getAttribute('position')
        for (let i = 0; i < position.count * 3; i++) {
          expect(Number.isFinite(position.array[i]), `${mesh.name} at level ${level}`).toBe(true)
        }
      })
      creature.dispose()
    }
  })
})

describe('body plans', () => {
  test('stands a quadruped on all four feet, at one height', () => {
    const spec = quadruped()

    expect(footHeight(spec, 'frontFootL')).toBeCloseTo(footHeight(spec, 'backFootL'), 1)
  })

  test('stands a quadruped on the ground rather than above or through it', () => {
    expect(footHeight(quadruped(), 'frontFootL')).toBeCloseTo(0, 1)
  })

  test('holds a biped’s hands clear of the ground', () => {
    const spec = defaultSpec()

    expect(footHeight(spec, 'frontFootL')).toBeGreaterThan(0.1)
  })

  test('carries a quadruped’s head lower and further forward than an upright’s', () => {
    const upright = defaultSpec()
    upright.neck.length = 0.7
    const onAllFours = {
      ...upright,
      body: { ...upright.body, build: 'quadruped' as const, frontLimb: 'forelegs' as const },
    }

    const a = generate(upright)
    const b = generate(onAllFours)
    a.root.updateMatrixWorld(true)
    b.root.updateMatrixWorld(true)
    const uprightHead = a.joints.head!.getWorldPosition(new THREE.Vector3())
    const quadrupedHead = b.joints.head!.getWorldPosition(new THREE.Vector3())
    a.dispose()
    b.dispose()

    expect(quadrupedHead.y).toBeLessThan(uprightHead.y)
    expect(quadrupedHead.z).toBeGreaterThan(uprightHead.z)
  })

  test('keeps a quadruped’s head roughly level rather than pointing at the sky', () => {
    const creature = generate(quadruped())
    creature.root.updateMatrixWorld(true)
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(creature.joints.head!.getWorldQuaternion(new THREE.Quaternion()))
    creature.dispose()

    expect(Math.abs(forward.y), 'head pitch away from level').toBeLessThan(0.4)
  })

  test('builds every plan, decoration and tail without a degenerate creature', () => {
    for (const build of BUILDS) {
      for (const frontLimb of FRONT_LIMBS) {
        for (const ridge of RIDGE_TYPES) {
          for (const tail of TAIL_TYPES) {
            const spec = defaultSpec()
            spec.body = { ...spec.body, build, frontLimb }
            spec.back.ridge = ridge
            spec.tail.type = tail
            const label = `${build}/${frontLimb}/${ridge}/${tail}`

            const box = boxOf(spec)
            expect(box.isEmpty(), label).toBe(false)
            expect(box.min.y, label).toBeCloseTo(0, 1)
            expect(Number.isFinite(box.max.y), label).toBe(true)
          }
        }
      }
    }
  })

  test('builds every ear and wing without a degenerate creature', () => {
    for (const ears of EAR_TYPES) {
      for (const wings of WING_TYPES) {
        const spec = defaultSpec()
        spec.head.ears = ears
        spec.wings.type = wings

        const creature = generate(spec)
        expect(creature.triangleCount, `${ears}/${wings}`).toBeGreaterThan(0)
        creature.dispose()
      }
    }
  })

  test('gives ears and wings their own joints only when the creature has them', () => {
    const bare = generate(defaultSpec())
    const decorated = generate({
      ...defaultSpec(),
      head: { ...defaultSpec().head, ears: 'long' },
      wings: { type: 'large' },
    })

    expect(bare.joints.earL).toBeUndefined()
    expect(bare.joints.wingL).toBeUndefined()
    expect(decorated.joints.earL).toBeDefined()
    expect(decorated.joints.wingL).toBeDefined()
  })
})
