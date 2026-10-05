import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { CORE_JOINTS } from '../src/joints'
import { poseAt } from '../src/animate'
import { generate } from '../src/generate'
import { LEG_TYPES, MESH_MODES, PAIR_COUNTS, defaultSpec, randomSpec, type CreatureSpec } from '../src/spec'

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
            s.limbs = { ...s.limbs, pairs, back, front }
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

describe('how many bones a limb has', () => {
  const boned = (segments: number): CreatureSpec =>
    walker((spec) => void (spec.limbs.segments = segments as CreatureSpec['limbs']['segments']))

  test.each([2, 3, 4, 5])('%i bones makes a chain of that many joints plus a foot', (segments) => {
    const creature = generate(boned(segments))

    expect(creature.limbs[0]!.joints).toHaveLength(segments + 1)
  })

  test.each([2, 3, 4, 5])('%i bones still starts Upper and ends Foot, whatever is between', (segments) => {
    const joints = generate(boned(segments)).limbs[0]!.joints

    expect(joints[0]).toBe('backUpperL')
    expect(joints[joints.length - 1]).toBe('backFootL')
    expect(joints).toContain('backLowerL')
  })

  test.each([2, 3, 4, 5])('a %i-boned limb still plants its foot on the floor', (segments) => {
    const heights = feetOn(boned(segments))

    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.05)
  })

  test('longer limbs cost more', () => {
    const counts = [2, 3, 4, 5].map((segments) => generate(boned(segments)).triangleCount)

    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeGreaterThan(counts[i - 1]!)
  })
})

describe('the gait, handed a creature nobody wrote it for', () => {
  const boned = (segments: number): CreatureSpec =>
    walker((spec) => void (spec.limbs.segments = segments as CreatureSpec['limbs']['segments']))

  const drives = (spec: CreatureSpec): [number, number] => {
    const creature = generate(spec)
    const pose = poseAt(0.3, 'walk', spec.body, creature.limbs)
    const joints = creature.limbs.flatMap((limb) => limb.joints)
    return [joints.filter((joint) => pose[joint]).length, joints.length]
  }

  test.each([2, 3, 4, 5])('drives every joint of a %i-boned limb', (segments) => {
    const [driven, total] = drives(boned(segments))

    expect(total).toBeGreaterThan(0)
    expect(driven).toBe(total)
  })

  test.each([
    ['a radial ring', (spec: CreatureSpec) => void (spec.body.mutation = 'radial')],
    ['a segmented crawler', (spec: CreatureSpec) => void (spec.body.mutation = 'segmented')],
    ['four pairs', (spec: CreatureSpec) => void (spec.limbs.pairs = 4)],
    ['one pair of five-boned legs', (spec: CreatureSpec) => {
      spec.limbs.pairs = 1
      spec.limbs.segments = 5
    }],
  ])('drives every limb of %s', (_name, edit) => {
    const [driven, total] = drives(walker(edit))

    expect(total).toBeGreaterThan(0)
    expect(driven).toBe(total)
  })

  test('registers no limb for a part that was left off', () => {
    const spec = walker((s) => {
      s.legs.type = 'none'
      s.body.frontLimb = 'none'
    })

    expect(generate(spec).limbs).toHaveLength(0)
  })

  test('phases the two sides of a pair against each other', () => {
    const limbs = generate(walker()).limbs
    const left = limbs.find((limb) => limb.joints[0] === 'backUpperL')!
    const right = limbs.find((limb) => limb.joints[0] === 'backUpperR')!

    expect(Math.abs(left.phase - right.phase)).toBeCloseTo(Math.PI, 5)
  })
})

describe('a limb’s phase', () => {
  test('is an angle in [0, 2π), never a bare sum that reads as nonsense', () => {
    for (const spec of [walker(), walker((s) => void (s.limbs.pairs = 4)), randomSpec()]) {
      for (const limb of generate(spec).limbs) {
        expect(limb.phase, limb.joints[0]).toBeGreaterThanOrEqual(0)
        expect(limb.phase, limb.joints[0]).toBeLessThan(Math.PI * 2)
      }
    }
  })

  test('still opposes the two sides of a pair after wrapping', () => {
    const limbs = generate(walker()).limbs
    const left = limbs.find((limb) => limb.joints[0] === 'frontUpperL')!
    const right = limbs.find((limb) => limb.joints[0] === 'frontUpperR')!
    const apart = Math.abs(left.phase - right.phase)

    expect(Math.min(apart, Math.PI * 2 - apart)).toBeCloseTo(Math.PI, 5)
  })
})

describe('standing over its feet', () => {
  /** How far the footprint sits ahead of the body's axis, as a share of height. */
  function lean(spec: CreatureSpec): number {
    const creature = generate(spec)
    creature.root.updateMatrixWorld(true)

    const print = new THREE.Box3()
    for (const name of Object.keys(creature.joints)) {
      if (name.includes('Foot')) print.union(new THREE.Box3().expandByObject(creature.joints[name]!))
    }
    if (print.isEmpty()) return 0

    const hip = creature.joints.hip!.getWorldPosition(new THREE.Vector3())
    const height = new THREE.Box3().setFromObject(creature.root).getSize(new THREE.Vector3()).y
    return ((print.min.z + print.max.z) / 2 - hip.z) / Math.max(0.01, height)
  }

  test.each(LEG_TYPES.filter((type) => type !== 'none'))(
    'a %s creature plants its feet under itself, not ahead of itself',
    (type) => {
      // Hung from the heel the body stands on the backs of its feet, which
      // reads as leaning away from them.
      expect(Math.abs(lean(walker((spec) => void (spec.legs.type = type))))).toBeLessThan(0.02)
    },
  )

  test('holds for an upright biped with arms, not only for a walker', () => {
    expect(Math.abs(lean(defaultSpec()))).toBeLessThan(0.02)
  })

  test('holds however long the legs are', () => {
    for (const length of [0, 0.5, 1]) {
      expect(Math.abs(lean(walker((spec) => void (spec.legs.length = length)))), `legs ${length}`).toBeLessThan(0.03)
    }
  })

  test('holds however thick they are, since the foot is sized from thickness', () => {
    for (const thickness of [0, 0.5, 1]) {
      expect(Math.abs(lean(walker((spec) => void (spec.legs.thickness = thickness)))), `${thickness}`).toBeLessThan(0.03)
    }
  })

  test('the heel still projects behind the ankle, as a foot does', () => {
    const creature = generate(walker())
    creature.root.updateMatrixWorld(true)

    const ankle = creature.joints.backFootL!.getWorldPosition(new THREE.Vector3())
    const foot = new THREE.Box3().expandByObject(creature.joints.backFootL!)

    expect(foot.min.z).toBeLessThan(ankle.z)
    expect(foot.max.z).toBeGreaterThan(ankle.z)
  })
})
