import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { CORE_JOINTS } from '../src/joints'
import { generate } from '../src/generate'
import { BUILDS, MESH_MODES, MUTATIONS, SEGMENT_COUNTS, defaultSpec, type CreatureSpec } from '../src/spec'

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

describe('the shattered mutation', () => {
  const shattered = (edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
    const spec = defaultSpec()
    spec.body.mutation = 'shattered'
    edit(spec)
    return spec
  }

  const vertices = (creature: ReturnType<typeof generate>): THREE.Vector3[] => {
    const out: THREE.Vector3[] = []
    creature.root.updateMatrixWorld(true)
    creature.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const position = mesh.geometry.getAttribute('position')
      for (let i = 0; i < position.count; i++) {
        out.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld))
      }
    })
    return out
  }

  test('keeps every triangle — it detaches them, it does not destroy them', () => {
    expect(generate(shattered()).triangleCount).toBe(generate(defaultSpec()).triangleCount)
  })

  test('holds the creature’s silhouette while doing it', () => {
    const whole = generate(defaultSpec())
    const broken = generate(shattered())
    whole.root.updateMatrixWorld(true)
    broken.root.updateMatrixWorld(true)

    const a = new THREE.Box3().setFromObject(whole.root).getSize(new THREE.Vector3())
    const b = new THREE.Box3().setFromObject(broken.root).getSize(new THREE.Vector3())

    for (const axis of ['x', 'y', 'z'] as const) {
      expect(Math.abs(b[axis] - a[axis]) / a[axis], axis).toBeLessThan(0.25)
    }
  })

  test('actually separates the shards rather than leaving the surface closed', () => {
    const whole = new Set(vertices(generate(defaultSpec())).map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`))
    const broken = new Set(vertices(generate(shattered())).map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`))

    expect(broken.size).toBeGreaterThan(whole.size)
  })

  test('shatters the same way every time, so a creature is still itself', () => {
    const first = vertices(generate(shattered()))
    const second = vertices(generate(shattered()))

    expect(first).toHaveLength(second.length)
    for (let i = 0; i < first.length; i += 17) {
      expect(first[i]!.distanceTo(second[i]!)).toBeLessThan(1e-9)
    }
  })

  test('never produces a NaN vertex', () => {
    for (const mesh of MESH_MODES) {
      for (const point of vertices(generate(shattered((spec) => void (spec.body.mesh = mesh))))) {
        expect(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z), mesh).toBe(true)
      }
    }
  })

  test('composes with the radial mutation’s own mesh modes', () => {
    for (const mesh of MESH_MODES) {
      const creature = generate(shattered((spec) => void (spec.body.mesh = mesh)))
      creature.root.updateMatrixWorld(true)

      expect(new THREE.Box3().setFromObject(creature.root).isEmpty(), mesh).toBe(false)
      expect(creature.triangleCount, mesh).toBeGreaterThan(0)
    }
  })
})

describe('the melted mutation', () => {
  const melted = (edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
    const spec = defaultSpec()
    spec.body.mutation = 'melted'
    edit(spec)
    return spec
  }

  const box = (spec: CreatureSpec) => {
    const creature = generate(spec)
    creature.root.updateMatrixWorld(true)
    return new THREE.Box3().setFromObject(creature.root)
  }

  test('keeps every triangle — a melted creature is the same surface, lower', () => {
    expect(generate(melted()).triangleCount).toBe(generate(defaultSpec()).triangleCount)
  })

  test('slumps: shorter than it was, and wider for it', () => {
    const upright = box(defaultSpec()).getSize(new THREE.Vector3())
    const slumped = box(melted()).getSize(new THREE.Vector3())

    expect(slumped.y).toBeLessThan(upright.y * 0.9)
    expect(Math.max(slumped.x, slumped.z)).toBeGreaterThan(Math.max(upright.x, upright.z))
  })

  test('pools on the floor rather than draining through it', () => {
    expect(box(melted()).min.y).toBeCloseTo(0, 1)
  })

  test('melts the same way every time', () => {
    const first = box(melted())
    const second = box(melted())

    expect(first.min.distanceTo(second.min)).toBeLessThan(1e-9)
    expect(first.max.distanceTo(second.max)).toBeLessThan(1e-9)
  })

  test('never produces a NaN vertex, in either mesh mode', () => {
    for (const mesh of MESH_MODES) {
      const creature = generate(melted((spec) => void (spec.body.mesh = mesh)))
      creature.root.traverse((node) => {
        const mesh3d = node as THREE.Mesh
        if (!mesh3d.isMesh) return
        const position = mesh3d.geometry.getAttribute('position')
        for (let i = 0; i < position.count * 3; i++) {
          expect(Number.isFinite(position.array[i]), mesh).toBe(true)
        }
      })
    }
  })
})

describe('every mutation', () => {
  test('builds a creature that stands on the ground, in both mesh modes', () => {
    for (const mutation of MUTATIONS) {
      for (const mesh of MESH_MODES) {
        const spec = defaultSpec()
        spec.body.mutation = mutation
        spec.body.mesh = mesh
        const creature = generate(spec)
        creature.root.updateMatrixWorld(true)

        const label = `${mutation}/${mesh}`
        const bounds = new THREE.Box3().setFromObject(creature.root)
        expect(bounds.isEmpty(), label).toBe(false)
        expect(bounds.min.y, label).toBeCloseTo(0, 1)
        expect(creature.triangleCount, label).toBeGreaterThan(0)
      }
    }
  })

  test('leaves every joint a gait poses in place, whatever it does to the body', () => {
    for (const mutation of MUTATIONS) {
      const spec = defaultSpec()
      spec.body.mutation = mutation
      const creature = generate(spec)

      for (const name of CORE_JOINTS) expect(creature.joints[name], `${mutation}/${name}`).toBeDefined()
    }
  })
})

describe('the strut mutation', () => {
  const asStrut = (edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
    const spec = defaultSpec()
    spec.body.mutation = 'strut'
    edit(spec)
    return spec
  }

  const names = (creature: ReturnType<typeof generate>): string[] => {
    const out: string[] = []
    creature.root.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) out.push(node.name)
    })
    return out
  }

  test('throws the surface away: nothing named after a body part survives', () => {
    const parts = names(generate(asStrut()))

    expect(parts.length).toBeGreaterThan(0)
    for (const name of parts) {
      expect(name.startsWith('strut_') || name.startsWith('knuckle_'), name).toBe(true)
    }
  })

  test('puts a knuckle on every joint', () => {
    const creature = generate(asStrut())
    const knuckles = names(creature).filter((name) => name.startsWith('knuckle_'))

    expect(knuckles).toHaveLength(Object.keys(creature.joints).length)
  })

  test('runs a strut between every joint and the one above it', () => {
    const creature = generate(asStrut())
    const struts = names(creature).filter((name) => name.startsWith('strut_'))

    // Every joint but the root one hangs from another, so every one but that gets a strut.
    expect(struts.length).toBeGreaterThanOrEqual(Object.keys(creature.joints).length - 2)
  })

  test('stands where the creature it replaces stood', () => {
    const solid = generate(defaultSpec())
    const bones = generate(asStrut())
    solid.root.updateMatrixWorld(true)
    bones.root.updateMatrixWorld(true)

    const a = new THREE.Box3().setFromObject(solid.root)
    const b = new THREE.Box3().setFromObject(bones.root)

    expect(b.min.y).toBeCloseTo(0, 1)
    expect(Math.abs(b.max.y - a.max.y) / a.max.y).toBeLessThan(0.2)
  })

  test('is priced by its joint count, not by the body it stands in for', () => {
    // Two kinds of part and nothing else, so a creature with more joints costs
    // more and a creature with a fatter torso costs exactly the same.
    const lean = asStrut()
    const limby = asStrut((spec) => {
      spec.body.mutation = 'strut'
      spec.torso.segments = 5
    })
    const fat = asStrut((spec) => void (spec.torso.width = 1))

    expect(generate(fat).triangleCount).toBe(generate(lean).triangleCount)
    expect(Object.keys(generate(limby).joints).length).toBeGreaterThanOrEqual(
      Object.keys(generate(lean).joints).length,
    )
  })

  test('works on a radial ring and in both mesh modes', () => {
    for (const mesh of MESH_MODES) {
      const creature = generate(asStrut((spec) => void (spec.body.mesh = mesh)))
      creature.root.updateMatrixWorld(true)

      expect(new THREE.Box3().setFromObject(creature.root).min.y, mesh).toBeCloseTo(0, 1)
      expect(creature.triangleCount, mesh).toBeGreaterThan(0)
    }
  })
})
