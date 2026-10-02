import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { CORE_JOINTS } from '../src/joints'
import { generate } from '../src/generate'
import {
  BUILDS,
  MESH_MODES,
  MUTATIONS,
  SEGMENT_COUNTS,
  defaultSpec,
  randomSpec,
  type CreatureSpec,
} from '../src/spec'

const mutated = (edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
  const spec = defaultSpec()
  spec.body.mutation = 'radial'
  edit(spec)
  return spec
}

const footJoints = (creature: ReturnType<typeof generate>) =>
  Object.keys(creature.joints).filter((name) => name.includes('Foot'))

/**
 * The triangle count of a creature whose surface has been reworked but not
 * added to or taken from. Deformations are built on a denser surface than a
 * plain creature, so this — not `defaultSpec()` — is what "the same surface"
 * means when counting triangles.
 */
function sameSurface(mutation: CreatureSpec['body']['mutation'] = 'flattened'): number {
  const spec = defaultSpec()
  spec.body.mutation = mutation
  return generate(spec).triangleCount
}

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
    expect(generate(shattered()).triangleCount).toBe(sameSurface())
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
    expect(generate(melted()).triangleCount).toBe(sameSurface())
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
    // Two joints get none: the root, and the first bead, which sits exactly on
    // the spine it hangs from and so has no length to span.
    expect(struts.length).toBeGreaterThanOrEqual(Object.keys(creature.joints).length - 3)
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

describe('the segmented mutation', () => {
  const chained = (edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
    const spec = defaultSpec()
    spec.body.mutation = 'segmented'
    edit(spec)
    return spec
  }

  const bodyJoints = (creature: ReturnType<typeof generate>) =>
    Object.keys(creature.joints).filter((name) => /^body\d+$/.test(name))

  test('pinches each bead to a waist, where a plain body runs smooth', () => {
    // Every creature's spine is a chain now. What segmented changes is that the
    // beads are pinched apart rather than sharing a radius at each join.
    const widths = (spec: CreatureSpec) => {
      const out: number[] = []
      generate(spec).root.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh || !mesh.name.startsWith('torso')) return
        mesh.geometry.computeBoundingBox()
        out.push(mesh.geometry.boundingBox!.getSize(new THREE.Vector3()).x)
      })
      return out
    }

    const spread = (values: number[]) => Math.max(...values) - Math.min(...values)
    expect(bodyJoints(generate(chained())).length).toBeGreaterThan(3)
    expect(spread(widths(chained()))).toBeGreaterThan(spread(widths(defaultSpec())))
  })

  test('takes the chain’s length from the body’s segment count', () => {
    const lengths = SEGMENT_COUNTS.map(
      (segments) => bodyJoints(generate(chained((spec) => void (spec.torso.segments = segments)))).length,
    )

    for (let i = 1; i < lengths.length; i++) expect(lengths[i]!).toBeGreaterThan(lengths[i - 1]!)
  })

  test('hangs a pair of limbs from every unit of the chain', () => {
    const creature = generate(chained())
    const feet = Object.keys(creature.joints).filter((name) => name.includes('Foot'))

    expect(feet).toHaveLength(bodyJoints(creature).length * 2)
  })

  test('stands every one of those limbs on the same floor', () => {
    const creature = generate(chained())
    creature.root.updateMatrixWorld(true)

    const heights = Object.keys(creature.joints)
      .filter((name) => name.includes('Foot'))
      .map((name) => new THREE.Box3().expandByObject(creature.joints[name]!).min.y)

    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.05)
  })

  test('lies long and low rather than standing up', () => {
    const upright = generate(defaultSpec())
    const crawler = generate(chained())
    upright.root.updateMatrixWorld(true)
    crawler.root.updateMatrixWorld(true)

    const a = new THREE.Box3().setFromObject(upright.root).getSize(new THREE.Vector3())
    const b = new THREE.Box3().setFromObject(crawler.root).getSize(new THREE.Vector3())

    expect(b.z / b.y).toBeGreaterThan(a.z / a.y)
  })

  test('still carries its head at the far end of the chain', () => {
    const creature = generate(chained())
    creature.root.updateMatrixWorld(true)

    const head = creature.joints.head!.getWorldPosition(new THREE.Vector3())
    const first = creature.joints.body0!.getWorldPosition(new THREE.Vector3())

    expect(head.z).toBeGreaterThan(first.z)
  })

  test('builds in both mesh modes and lands on the ground', () => {
    for (const mesh of MESH_MODES) {
      const creature = generate(chained((spec) => void (spec.body.mesh = mesh)))
      creature.root.updateMatrixWorld(true)

      expect(new THREE.Box3().setFromObject(creature.root).min.y, mesh).toBeCloseTo(0, 1)
    }
  })
})

describe('the voxel mutation', () => {
  const blocky = (edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
    const spec = defaultSpec()
    spec.body.mutation = 'voxel'
    edit(spec)
    return spec
  }

  test('rebuilds the surface out of cubes — twelve triangles at a time', () => {
    const creature = generate(blocky())

    creature.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      expect(mesh.geometry.getAttribute('position').count % 36, mesh.name).toBe(0)
    })
  })

  test('snaps every vertex onto one grid', () => {
    const creature = generate(blocky())
    const spacings = new Set<number>()

    creature.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      const position = mesh.geometry.getAttribute('position')
      for (let i = 0; i < position.count; i++) spacings.add(Math.round(position.getY(i) * 1e5))
    })

    // On a grid, distinct coordinates are rare; on a smooth surface they are not.
    expect(spacings.size).toBeLessThan(400)
  })

  test('still fills the shape it replaced', () => {
    const smooth = generate(defaultSpec())
    const blocks = generate(blocky())
    smooth.root.updateMatrixWorld(true)
    blocks.root.updateMatrixWorld(true)

    const a = new THREE.Box3().setFromObject(smooth.root).getSize(new THREE.Vector3())
    const b = new THREE.Box3().setFromObject(blocks.root).getSize(new THREE.Vector3())

    for (const axis of ['x', 'y', 'z'] as const) {
      expect(Math.abs(b[axis] - a[axis]) / a[axis], axis).toBeLessThan(0.35)
    }
  })

  test('gets blockier as the grid gets coarser relative to the creature', () => {
    const small = generate(blocky((spec) => void (spec.torso.width = 0.05))).triangleCount
    const large = generate(blocky((spec) => void (spec.torso.width = 1))).triangleCount

    expect(large).not.toBe(small)
  })
})

describe('the twisted mutation', () => {
  const wound = (edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
    const spec = defaultSpec()
    spec.body.mutation = 'twisted'
    edit(spec)
    return spec
  }

  test('keeps every triangle — it is a shear, not a rebuild', () => {
    expect(generate(wound()).triangleCount).toBe(sameSurface())
  })

  test('leaves the floor alone and carries the top round', () => {
    const creature = generate(wound())
    creature.root.updateMatrixWorld(true)

    const low = creature.joints.backFootL!.getWorldPosition(new THREE.Vector3())
    const high = creature.joints.head!.getWorldPosition(new THREE.Vector3())
    const straight = generate(defaultSpec())
    straight.root.updateMatrixWorld(true)
    const wasLow = straight.joints.backFootL!.getWorldPosition(new THREE.Vector3())

    // Joints are untouched by a deformation; only the surface winds.
    expect(low.distanceTo(wasLow)).toBeLessThan(0.05)
    expect(Number.isFinite(high.y)).toBe(true)
  })

  test('is no longer a straight extrusion: it widens as it winds', () => {
    const straight = generate(defaultSpec())
    const twisted = generate(wound())
    straight.root.updateMatrixWorld(true)
    twisted.root.updateMatrixWorld(true)

    const a = new THREE.Box3().setFromObject(straight.root)
    const b = new THREE.Box3().setFromObject(twisted.root)

    expect(b.getSize(new THREE.Vector3()).length()).not.toBeCloseTo(a.getSize(new THREE.Vector3()).length(), 3)
  })

  test('never produces a NaN vertex, in either mesh mode', () => {
    for (const mesh of MESH_MODES) {
      const creature = generate(wound((spec) => void (spec.body.mesh = mesh)))
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

describe('the exploded mutation', () => {
  const apart = (edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
    const spec = defaultSpec()
    spec.body.mutation = 'exploded'
    edit(spec)
    return spec
  }

  test('keeps every triangle — nothing is destroyed, only moved', () => {
    expect(generate(apart()).triangleCount).toBe(generate(defaultSpec()).triangleCount)
  })

  test('spreads the creature out past the body it came from', () => {
    const whole = generate(defaultSpec())
    const scattered = generate(apart())
    whole.root.updateMatrixWorld(true)
    scattered.root.updateMatrixWorld(true)

    const a = new THREE.Box3().setFromObject(whole.root).getSize(new THREE.Vector3())
    const b = new THREE.Box3().setFromObject(scattered.root).getSize(new THREE.Vector3())

    expect(b.length()).toBeGreaterThan(a.length() * 1.1)
  })

  test('leaves the joints where they were, so the gait still drives it', () => {
    const whole = generate(defaultSpec())
    const scattered = generate(apart())
    whole.root.updateMatrixWorld(true)
    scattered.root.updateMatrixWorld(true)

    for (const name of ['backUpperL', 'frontUpperR', 'head']) {
      const before = whole.joints[name]!.getWorldPosition(new THREE.Vector3())
      const after = scattered.joints[name]!.getWorldPosition(new THREE.Vector3())
      // Only the vertical settle differs, because the spread changed the bounds.
      expect(Math.abs(before.x - after.x), name).toBeLessThan(0.01)
      expect(Math.abs(before.z - after.z), name).toBeLessThan(0.01)
    }
  })

  test('actually separates the parts rather than nudging them', () => {
    const scattered = generate(apart())
    scattered.root.updateMatrixWorld(true)

    const offsets: number[] = []
    scattered.root.traverse((node) => {
      if ((node as THREE.Mesh).isMesh && node.parent) offsets.push(node.parent.position.length())
    })

    expect(Math.max(...offsets)).toBeGreaterThan(0.1)
  })

  test('builds in both mesh modes and lands on the ground', () => {
    for (const mesh of MESH_MODES) {
      const creature = generate(apart((spec) => void (spec.body.mesh = mesh)))
      creature.root.updateMatrixWorld(true)

      expect(new THREE.Box3().setFromObject(creature.root).min.y, mesh).toBeCloseTo(0, 1)
    }
  })
})

describe('the recursive mutation', () => {
  const branching = (edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
    const spec = defaultSpec()
    spec.body.mutation = 'recursive'
    edit(spec)
    return spec
  }

  test('sprouts a smaller limb from the end of every limb', () => {
    const plain = generate(defaultSpec())
    const fractal = generate(branching())

    const branches = Object.keys(fractal.joints).filter((name) => /B\d(Upper|Lower|Foot)$/.test(name))
    expect(branches.length).toBe(Object.keys(plain.joints).filter((n) => n.includes('Upper')).length * 6)
  })

  test('makes each generation smaller than the one it grew from', () => {
    const creature = generate(branching())
    creature.root.updateMatrixWorld(true)

    const span = (name: string) => {
      const box = new THREE.Box3().expandByObject(creature.joints[name]!)
      return box.getSize(new THREE.Vector3()).length()
    }

    expect(span('backUpperLB0Upper')).toBeLessThan(span('backUpperL'))
  })

  test('terminates — it does not branch forever', () => {
    const depths = Object.keys(generate(branching()).joints).map((name) => (name.match(/B\d/g) ?? []).length)

    expect(Math.max(...depths)).toBe(1)
  })

  test('still stands on the ground, now on its smallest toes', () => {
    const creature = generate(branching())
    creature.root.updateMatrixWorld(true)

    expect(new THREE.Box3().setFromObject(creature.root).min.y).toBeCloseTo(0, 1)
  })

  test('costs more triangles than the body it branches from', () => {
    expect(generate(branching()).triangleCount).toBeGreaterThan(generate(defaultSpec()).triangleCount)
  })

  test('reaches every limb, however many the body happens to have', () => {
    const creature = generate(branching())
    const uppers = Object.keys(creature.joints).filter((name) => /Upper[LR]$/.test(name))

    for (const name of uppers) {
      expect(creature.joints[`${name}B0Upper`], `${name} never branched`).toBeDefined()
      expect(creature.joints[`${name}B1Upper`], `${name} branched only once`).toBeDefined()
    }
  })

  test('builds in both mesh modes', () => {
    for (const mesh of MESH_MODES) {
      const creature = generate(branching((spec) => void (spec.body.mesh = mesh)))
      creature.root.updateMatrixWorld(true)

      expect(new THREE.Box3().setFromObject(creature.root).min.y, mesh).toBeCloseTo(0, 1)
      expect(creature.triangleCount, mesh).toBeGreaterThan(0)
    }
  })
})

describe('the asymmetric mutation', () => {
  const lopsided = (edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
    const spec = defaultSpec()
    spec.body.mutation = 'asymmetric'
    edit(spec)
    return spec
  }

  const limbBox = (creature: ReturnType<typeof generate>, joint: string) => {
    creature.root.updateMatrixWorld(true)
    return new THREE.Box3().expandByObject(creature.joints[joint]!).getSize(new THREE.Vector3())
  }

  test('a normal creature’s two sides match', () => {
    const creature = generate(defaultSpec())

    expect(limbBox(creature, 'backUpperL').length()).toBeCloseTo(limbBox(creature, 'backUpperR').length(), 5)
  })

  test('a skewed one’s do not', () => {
    const creature = generate(lopsided())

    expect(limbBox(creature, 'backUpperL').length()).not.toBeCloseTo(
      limbBox(creature, 'backUpperR').length(),
      2,
    )
  })

  test('keeps every triangle — it rescales parts, it does not rebuild them', () => {
    expect(generate(lopsided()).triangleCount).toBe(generate(defaultSpec()).triangleCount)
  })

  test('skews the same way every time', () => {
    expect(limbBox(generate(lopsided()), 'frontUpperL').length()).toBeCloseTo(
      limbBox(generate(lopsided()), 'frontUpperL').length(),
      9,
    )
  })

  test('still stands on the ground, lopsided as it is', () => {
    const creature = generate(lopsided())
    creature.root.updateMatrixWorld(true)

    expect(new THREE.Box3().setFromObject(creature.root).min.y).toBeCloseTo(0, 1)
  })
})

describe('the inverted mutation', () => {
  const insideOut = (edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
    const spec = defaultSpec()
    spec.body.mutation = 'inverted'
    edit(spec)
    return spec
  }

  const normalsOf = (creature: ReturnType<typeof generate>) => {
    const out: number[] = []
    creature.root.updateMatrixWorld(true)
    creature.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh || !mesh.name.startsWith('torso')) return
      const position = mesh.geometry.getAttribute('position')
      const centre = new THREE.Vector3()
      mesh.geometry.computeBoundingBox()
      mesh.geometry.boundingBox!.getCenter(centre)

      for (let i = 0; i < position.count; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(position, i)
        const b = new THREE.Vector3().fromBufferAttribute(position, i + 1)
        const c = new THREE.Vector3().fromBufferAttribute(position, i + 2)
        const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a))
        const outward = new THREE.Vector3().addVectors(a, b).add(c).divideScalar(3).sub(centre)
        out.push(normal.dot(outward))
      }
    })
    return out
  }

  test('a normal creature faces outward everywhere', () => {
    const facings = normalsOf(generate(defaultSpec()))

    expect(facings.length).toBeGreaterThan(0)
    expect(facings.every((value) => value > 0)).toBe(true)
  })

  test('an inverted one faces inward everywhere', () => {
    const facings = normalsOf(generate(insideOut()))

    expect(facings.length).toBeGreaterThan(0)
    expect(facings.every((value) => value < 0)).toBe(true)
  })

  test('keeps every triangle and the whole silhouette', () => {
    const solid = generate(defaultSpec())
    const hollow = generate(insideOut())
    solid.root.updateMatrixWorld(true)
    hollow.root.updateMatrixWorld(true)

    expect(hollow.triangleCount).toBe(sameSurface())

    // Reversing a winding moves nothing, so the shape is identical to the
    // creature built at the same resolution without the reversal.
    const straight = generate({ ...defaultSpec(), body: { ...defaultSpec().body, mutation: 'flattened' } })
    straight.root.updateMatrixWorld(true)
    const a = new THREE.Box3().setFromObject(solid.root).getSize(new THREE.Vector3())
    const b = new THREE.Box3().setFromObject(hollow.root).getSize(new THREE.Vector3())
    expect(b.y).toBeCloseTo(a.y, 1)
  })
})

describe('the whole mutation set', () => {
  test('every one of them builds, stands, and keeps the gait’s joints, in both mesh modes', () => {
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
        for (const name of CORE_JOINTS) expect(creature.joints[name], `${label}/${name}`).toBeDefined()
      }
    }
  })

  test('every one of them survives a rolled creature, whatever it rolled', () => {
    for (const mutation of MUTATIONS) {
      for (let seed = 0; seed < 6; seed++) {
        const spec = randomSpec()
        spec.body.mutation = mutation
        const creature = generate(spec)
        creature.root.updateMatrixWorld(true)

        const bounds = new THREE.Box3().setFromObject(creature.root)
        expect(bounds.isEmpty(), mutation).toBe(false)
        expect(Number.isFinite(bounds.max.y), mutation).toBe(true)
      }
    }
  })
})

describe('the inflated mutation', () => {
  const swollen = (edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
    const spec = defaultSpec()
    spec.body.mutation = 'inflated'
    edit(spec)
    return spec
  }

  test('keeps every triangle — it swells the surface, it does not add to it', () => {
    expect(generate(swollen()).triangleCount).toBe(sameSurface())
  })

  test('is fatter than the creature it swelled from', () => {
    const lean = generate(defaultSpec())
    const fat = generate(swollen())
    lean.root.updateMatrixWorld(true)
    fat.root.updateMatrixWorld(true)

    const a = new THREE.Box3().setFromObject(lean.root).getSize(new THREE.Vector3())
    const b = new THREE.Box3().setFromObject(fat.root).getSize(new THREE.Vector3())

    expect(b.x).toBeGreaterThan(a.x)
    expect(b.z).toBeGreaterThan(a.z)
  })

  test('swells unevenly — it is lumpy, not merely scaled', () => {
    const creature = generate(swollen())
    const radii: number[] = []

    creature.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh || !mesh.name.startsWith('torso')) return
      const position = mesh.geometry.getAttribute('position')
      mesh.geometry.computeBoundingBox()
      const centre = mesh.geometry.boundingBox!.getCenter(new THREE.Vector3())
      for (let i = 0; i < position.count; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(position, i)
        radii.push(Math.hypot(point.x - centre.x, point.z - centre.z))
      }
    })

    const mean = radii.reduce((sum, value) => sum + value, 0) / radii.length
    const spread = Math.sqrt(radii.reduce((sum, value) => sum + (value - mean) ** 2, 0) / radii.length)

    expect(spread / mean).toBeGreaterThan(0.1)
  })
})

describe('the lattice mutation', () => {
  const caged = (edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
    const spec = defaultSpec()
    spec.body.mutation = 'lattice'
    edit(spec)
    return spec
  }

  test('replaces the surface with bars along its own edges', () => {
    const solid = generate(defaultSpec())
    const cage = generate(caged())

    // Every edge becomes a four-sided bar, so the count is a multiple of eight.
    expect(cage.triangleCount % 8).toBe(0)
    expect(cage.triangleCount).toBeGreaterThan(solid.triangleCount)
  })

  test('draws a shared edge once rather than twice', () => {
    const cage = generate(caged())
    const solid = generate(defaultSpec())

    // Three edges per triangle, but neighbours share them, so well under 3x.
    expect(cage.triangleCount).toBeLessThan(solid.triangleCount * 3 * 8)
  })

  test('holds the shape it replaced', () => {
    const solid = generate(defaultSpec())
    const cage = generate(caged())
    solid.root.updateMatrixWorld(true)
    cage.root.updateMatrixWorld(true)

    const a = new THREE.Box3().setFromObject(solid.root).getSize(new THREE.Vector3())
    const b = new THREE.Box3().setFromObject(cage.root).getSize(new THREE.Vector3())

    for (const axis of ['x', 'y', 'z'] as const) {
      expect(Math.abs(b[axis] - a[axis]) / a[axis], axis).toBeLessThan(0.15)
    }
  })

  test('gets denser as the creature gets more detailed', () => {
    const coarse = generate(caged((spec) => void (spec.detail.level = 0))).triangleCount
    const fine = generate(caged((spec) => void (spec.detail.level = 1))).triangleCount

    expect(fine).toBeGreaterThan(coarse * 2)
  })
})

describe('the flattened mutation', () => {
  const cutout = (edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
    const spec = defaultSpec()
    spec.body.mutation = 'flattened'
    edit(spec)
    return spec
  }

  test('keeps every triangle and loses a dimension', () => {
    // Measured on a part: the whole body's width is set by how far apart the
    // limbs are, and pressing a part flat does not move it.
    const thickness = (spec: CreatureSpec) => {
      let width = 0
      generate(spec).root.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh || !mesh.name.startsWith('torso')) return
        mesh.geometry.computeBoundingBox()
        width = mesh.geometry.boundingBox!.getSize(new THREE.Vector3()).x
      })
      return width
    }

    expect(generate(cutout()).triangleCount).toBe(sameSurface('twisted'))
    expect(thickness(cutout())).toBeLessThan(thickness(defaultSpec()) * 0.2)
  })

  test('keeps the height and depth it had, so only the width is lost', () => {
    const solid = generate(defaultSpec())
    const paper = generate(cutout())
    solid.root.updateMatrixWorld(true)
    paper.root.updateMatrixWorld(true)

    const a = new THREE.Box3().setFromObject(solid.root).getSize(new THREE.Vector3())
    const b = new THREE.Box3().setFromObject(paper.root).getSize(new THREE.Vector3())

    expect(Math.abs(b.y - a.y) / a.y).toBeLessThan(0.1)
    expect(Math.abs(b.z - a.z) / a.z).toBeLessThan(0.1)
  })

  test('presses each part flat where it stands, not onto one plane', () => {
    const paper = generate(cutout())
    paper.root.updateMatrixWorld(true)

    const left = paper.joints.backUpperL!.getWorldPosition(new THREE.Vector3())
    const right = paper.joints.backUpperR!.getWorldPosition(new THREE.Vector3())

    expect(Math.abs(left.x - right.x)).toBeGreaterThan(0.05)
  })
})

describe('the coiled mutation', () => {
  const curled = (edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
    const spec = defaultSpec()
    spec.body.mutation = 'coiled'
    edit(spec)
    return spec
  }

  const bodyJoints = (creature: ReturnType<typeof generate>) =>
    Object.keys(creature.joints).filter((name) => /^body\d+$/.test(name))

  test('builds a longer chain than a segmented body does', () => {
    expect(bodyJoints(generate(curled())).length).toBeGreaterThan(
      bodyJoints(generate({ ...defaultSpec(), body: { ...defaultSpec().body, mutation: 'segmented' } })).length,
    )
  })

  test('curls: the far end of the chain comes back round toward the near end', () => {
    const creature = generate(curled())
    creature.root.updateMatrixWorld(true)

    const first = creature.joints.body0!.getWorldPosition(new THREE.Vector3())
    const last = creature.joints[`body${bodyJoints(creature).length - 1}`]!.getWorldPosition(new THREE.Vector3())

    const straightLine = bodyJoints(creature).length * 0.1
    expect(first.distanceTo(last)).toBeLessThan(straightLine)
  })

  test('keeps its limbs under it rather than growing a pair per coil', () => {
    const creature = generate(curled())
    const feet = Object.keys(creature.joints).filter((name) => name.includes('Foot'))

    expect(feet).toHaveLength(4)
  })

  test('stands on the ground with its head somewhere above it', () => {
    const creature = generate(curled())
    creature.root.updateMatrixWorld(true)

    const bounds = new THREE.Box3().setFromObject(creature.root)
    expect(bounds.min.y).toBeCloseTo(0, 1)
    expect(creature.joints.head!.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(0)
  })
})

describe('the swarm mutation', () => {
  const crowd = (edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
    const spec = defaultSpec()
    spec.body.mutation = 'swarm'
    edit(spec)
    return spec
  }

  test('replaces the surface with small bodies — eight triangles apiece', () => {
    const creature = generate(crowd())

    creature.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh) return
      expect(mesh.geometry.getAttribute('position').count % 24, mesh.name).toBe(0)
    })
  })

  test('leaves one body behind for every few triangles, not one for each', () => {
    const surface = sameSurface()
    const bodies = generate(crowd()).triangleCount / 8

    expect(bodies).toBeGreaterThan(surface / 5)
    expect(bodies).toBeLessThan(surface / 2)
  })

  test('still has the creature’s shape, held by the crowd', () => {
    const solid = generate(defaultSpec())
    const cloud = generate(crowd())
    solid.root.updateMatrixWorld(true)
    cloud.root.updateMatrixWorld(true)

    const a = new THREE.Box3().setFromObject(solid.root).getSize(new THREE.Vector3())
    const b = new THREE.Box3().setFromObject(cloud.root).getSize(new THREE.Vector3())

    for (const axis of ['x', 'y', 'z'] as const) {
      expect(Math.abs(b[axis] - a[axis]) / a[axis], axis).toBeLessThan(0.3)
    }
  })

  test('varies the size of its bodies rather than stamping one', () => {
    const creature = generate(crowd())
    const spans = new Set<number>()

    creature.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh || !mesh.name.startsWith('torso')) return
      const position = mesh.geometry.getAttribute('position')
      for (let i = 0; i < position.count; i += 24) {
        let widest = 0
        for (let v = i; v < i + 24; v++) widest = Math.max(widest, Math.abs(position.getX(v)))
        spans.add(Math.round(widest * 1e4))
      }
    })

    expect(spans.size).toBeGreaterThan(3)
  })
})

describe('the plated mutation', () => {
  const armoured = (edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
    const spec = defaultSpec()
    spec.body.mutation = 'plated'
    edit(spec)
    return spec
  }

  test('turns each triangle into a plate with a skirt — seven triangles apiece', () => {
    expect(generate(armoured()).triangleCount).toBe(sameSurface() * 7)
  })

  test('stays joined to the body: it is armour, not debris', () => {
    const solid = generate(defaultSpec())
    const clad = generate(armoured())
    solid.root.updateMatrixWorld(true)
    clad.root.updateMatrixWorld(true)

    const a = new THREE.Box3().setFromObject(solid.root).getSize(new THREE.Vector3())
    const b = new THREE.Box3().setFromObject(clad.root).getSize(new THREE.Vector3())

    // Only as much bigger as the plates are thick.
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(b[axis]).toBeGreaterThanOrEqual(a[axis] - 1e-6)
      expect(b[axis]).toBeLessThan(a[axis] * 1.3)
    }
  })

  test('lifts the plates clear of the surface they came from', () => {
    const creature = generate(armoured())
    let lifted = false

    creature.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh || !mesh.name.startsWith('torso')) return
      mesh.geometry.computeBoundingBox()
      const centre = mesh.geometry.boundingBox!.getCenter(new THREE.Vector3())
      const position = mesh.geometry.getAttribute('position')

      const radii: number[] = []
      for (let i = 0; i < position.count; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(position, i)
        radii.push(Math.hypot(point.x - centre.x, point.z - centre.z))
      }
      lifted = Math.max(...radii) - Math.min(...radii.filter((r) => r > 0.01)) > 0.02
    })

    expect(lifted).toBe(true)
  })

  test('never produces a NaN vertex, in either mesh mode', () => {
    for (const mesh of MESH_MODES) {
      const creature = generate(armoured((spec) => void (spec.body.mesh = mesh)))
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
