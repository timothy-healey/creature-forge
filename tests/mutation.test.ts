import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { CORE_JOINTS } from '../src/joints'
import { generate } from '../src/generate'
import { BUILDS, MESH_MODES, SEGMENT_COUNTS, defaultSpec, type CreatureSpec } from '../src/spec'

const mutated = (edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
  const spec = defaultSpec()
  spec.body.mutation = 'radial'
  edit(spec)
  return spec
}

const footJoints = (creature: ReturnType<typeof generate>) =>
  Object.keys(creature.joints).filter((name) => name.includes('Foot'))

describe('the radial mutation', () => {
  test('replaces bilateral pairs with a ring of more limbs than a body has sides', () => {
    expect(footJoints(generate(mutated())).length).toBeGreaterThan(footJoints(generate(defaultSpec())).length)
  })

  test('spaces its limbs evenly around the axis', () => {
    const creature = generate(mutated())
    creature.root.updateMatrixWorld(true)

    const angles = footJoints(creature)
      .map((name) => creature.joints[name]!.getWorldPosition(new THREE.Vector3()))
      .map((point) => Math.atan2(point.z, point.x))
      .sort((a, b) => a - b)

    const gaps = angles.map((angle, i) => {
      const next = i === angles.length - 1 ? angles[0]! + Math.PI * 2 : angles[i + 1]!
      return next - angle
    })

    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.05)
  })

  test('stands every limb on the same ground', () => {
    const creature = generate(mutated())
    creature.root.updateMatrixWorld(true)

    const heights = footJoints(creature).map(
      (name) => new THREE.Box3().expandByObject(creature.joints[name]!).min.y,
    )

    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.02)
  })

  test('drops the tail, because a ring has no side to hang one from', () => {
    const spec = mutated((s) => {
      s.tail.type = 'long'
    })

    expect(Object.keys(generate(spec).joints).filter((name) => name.startsWith('tail'))).toHaveLength(0)
  })

  test('stands upright whatever build it is given, since a ring has no front', () => {
    for (const build of BUILDS) {
      const creature = generate(mutated((spec) => void (spec.body.build = build)))
      creature.root.updateMatrixWorld(true)

      const spine = new THREE.Vector3(0, 1, 0).applyQuaternion(
        creature.joints.spine!.getWorldQuaternion(new THREE.Quaternion()),
      )
      expect(spine.y, build).toBeGreaterThan(0.99)
    }
  })

  test('takes its limb count from the body’s segments', () => {
    const counts = SEGMENT_COUNTS.map(
      (segments) => footJoints(generate(mutated((spec) => void (spec.torso.segments = segments)))).length,
    )

    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeGreaterThan(counts[i - 1]!)
  })

  test('still builds every joint a gait poses, so the walk drives it unchanged', () => {
    const creature = generate(mutated())

    for (const name of CORE_JOINTS) expect(creature.joints[name], name).toBeDefined()
  })

  test('works in both mesh modes and lands on the ground in each', () => {
    for (const mesh of MESH_MODES) {
      const creature = generate(mutated((spec) => void (spec.body.mesh = mesh)))
      creature.root.updateMatrixWorld(true)

      expect(new THREE.Box3().setFromObject(creature.root).min.y, mesh).toBeCloseTo(0, 1)
      expect(creature.triangleCount, mesh).toBeGreaterThan(0)
    }
  })
})
