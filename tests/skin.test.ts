import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { generate } from '../src/generate'
import { BUILDS, FRONT_LIMBS, defaultSpec, randomSpec, type CreatureSpec } from '../src/spec'

const skinned = (edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
  const spec = defaultSpec()
  spec.body.mesh = 'skinned'
  spec.head.ears = 'pointed'
  spec.wings.type = 'small'
  edit(spec)
  return spec
}

function meshesIn(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = []
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) found.push(node as THREE.Mesh)
  })
  return found
}

function theSkin(spec: CreatureSpec): THREE.SkinnedMesh {
  return meshesIn(generate(spec).root)[0] as THREE.SkinnedMesh
}

function theSkinOf(creature: ReturnType<typeof generate>): THREE.SkinnedMesh {
  return meshesIn(creature.root)[0] as THREE.SkinnedMesh
}

describe('a skinned creature', () => {
  test('is one mesh, not a pile of them', () => {
    expect(meshesIn(generate(skinned()).root)).toHaveLength(1)
    expect(meshesIn(generate(defaultSpec()).root).length).toBeGreaterThan(8)
  })

  test('is bound to a skeleton whose bones are the joints', () => {
    const creature = generate(skinned())
    const mesh = meshesIn(creature.root)[0] as THREE.SkinnedMesh

    expect(mesh.isSkinnedMesh).toBe(true)
    expect(mesh.skeleton.bones.length).toBeGreaterThan(10)
    for (const bone of mesh.skeleton.bones) {
      expect(creature.joints[bone.name], `${bone.name} is a bone but not a joint`).toBeDefined()
    }
  })

  test('gives every vertex weights that sum to one', () => {
    const weights = theSkin(skinned()).geometry.getAttribute('skinWeight')

    for (let i = 0; i < weights.count; i++) {
      const total = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i)
      expect(total, `vertex ${i}`).toBeCloseTo(1, 4)
    }
  })

  test('never points a vertex at a bone that does not exist', () => {
    const mesh = theSkin(skinned())
    const indices = mesh.geometry.getAttribute('skinIndex')
    const count = mesh.skeleton.bones.length

    for (let i = 0; i < indices.count; i++) {
      for (const axis of ['x', 'y', 'z', 'w'] as const) {
        const index = indices[`get${axis.toUpperCase()}` as 'getX'](i)
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(count)
      }
    }
  })

  test('shares its vertices — the surface is welded, not a heap of loose triangles', () => {
    const geometry = theSkin(skinned()).geometry

    expect(geometry.getIndex()).not.toBeNull()
    expect(geometry.getAttribute('position').count).toBeLessThan(geometry.getIndex()!.count)
  })

  test('blends some vertices across two bones, which is what makes a joint bend', () => {
    const weights = theSkin(skinned()).geometry.getAttribute('skinWeight')

    let blended = 0
    for (let i = 0; i < weights.count; i++) {
      if (weights.getY(i) > 0.02) blended++
    }

    expect(blended, 'vertices influenced by more than one bone').toBeGreaterThan(20)
  })

  test('deforms when its skeleton moves, which is the whole point of binding it', () => {
    const creature = generate(skinned())
    const mesh = meshesIn(creature.root)[0] as THREE.SkinnedMesh
    creature.root.updateMatrixWorld(true)

    const sample = (index: number) =>
      mesh.applyBoneTransform(index, new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), index))

    // Sampled across the whole mesh: the head's vertices are near the end of it.
    const total = mesh.geometry.getAttribute('position').count
    const step = Math.max(1, Math.floor(total / 150))
    const taken = Array.from({ length: Math.floor(total / step) }, (_, i) => i * step)

    const before = taken.map((index) => sample(index).clone())
    creature.joints.head!.rotation.x += 0.9
    creature.root.updateMatrixWorld(true)
    const after = taken.map((index) => sample(index))

    const moved = before.filter((point, i) => point.distanceTo(after[i]!) > 1e-4)
    expect(moved.length, 'vertices that followed the bone').toBeGreaterThan(0)
  })
})

describe('the two mesh modes', () => {
  test('describe the same creature — same sliders, same silhouette', () => {
    const spec = defaultSpec()
    const jointed = generate(spec)
    const bound = generate({ ...spec, body: { ...spec.body, mesh: 'skinned' } })
    jointed.root.updateMatrixWorld(true)
    bound.root.updateMatrixWorld(true)

    const a = new THREE.Box3().setFromObject(jointed.root).getSize(new THREE.Vector3())
    const b = new THREE.Box3().setFromObject(bound.root).getSize(new THREE.Vector3())

    for (const axis of ['x', 'y', 'z'] as const) {
      expect(Math.abs(a[axis] - b[axis]) / a[axis], axis).toBeLessThan(0.2)
    }
  })

  test('both stand every body plan on the ground', () => {
    for (const mesh of ['jointed', 'skinned'] as const) {
      for (const build of BUILDS) {
        for (const frontLimb of FRONT_LIMBS) {
          const spec = defaultSpec()
          spec.body = { ...spec.body, build, frontLimb, mesh }
          const creature = generate(spec)
          creature.root.updateMatrixWorld(true)

          const label = `${mesh}/${build}/${frontLimb}`
          expect(new THREE.Box3().setFromObject(creature.root).min.y, label).toBeCloseTo(0, 1)
        }
      }
    }
  })

  test('report a triangle count in both modes', () => {
    for (let i = 0; i < 12; i++) {
      const spec = randomSpec()
      spec.body.mesh = i % 2 === 0 ? 'skinned' : 'jointed'

      expect(generate(spec).triangleCount, spec.body.mesh).toBeGreaterThan(0)
    }
  })
})

describe('how much a skinned creature actually bends', () => {
  const skin = (): THREE.SkinnedMesh => theSkin(skinned())

  test('hands a good share of its surface to more than one bone', () => {
    // Not all of it, and it should not be: a vertex in the middle of a limb
    // segment has no business following anything but its own bone. What matters
    // is that the surface near every joint does.
    const weights = skin().geometry.getAttribute('skinWeight')

    let blended = 0
    for (let i = 0; i < weights.count; i++) if (weights.getY(i) > 0.02) blended++

    expect(blended / weights.count).toBeGreaterThan(0.5)
  })

  test('blends hard enough to be visible, not just present', () => {
    const weights = skin().geometry.getAttribute('skinWeight')

    let total = 0
    let counted = 0
    for (let i = 0; i < weights.count; i++) {
      const second = weights.getY(i)
      if (second > 0.02) {
        total += second
        counted++
      }
    }

    expect(total / counted).toBeGreaterThan(0.25)
  })

  test('bends rather than hinges: a joint moves its surface by degrees', () => {
    const creature = generate(skinned())
    const mesh = theSkinOf(creature)
    creature.root.updateMatrixWorld(true)

    const position = mesh.geometry.getAttribute('position')
    const sample = (i: number) =>
      mesh.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(position, i))

    const taken = Array.from({ length: 300 }, (_, i) => Math.floor((i * position.count) / 300))
    const before = taken.map((i) => sample(i).clone())
    creature.joints.backLowerL!.rotation.x += 0.8
    creature.root.updateMatrixWorld(true)
    const after = taken.map((i) => sample(i))

    const shifts = before.map((point, i) => point.distanceTo(after[i]!)).filter((d) => d > 1e-5)
    const partial = shifts.filter((d) => d < Math.max(...shifts) * 0.7)

    // A rigid stack moves a part or it does not. A skin moves it by degrees.
    expect(shifts.length).toBeGreaterThan(5)
    expect(partial.length).toBeGreaterThan(2)
  })

  test('spends more geometry than the jointed build, because a bend needs rings to bend with', () => {
    expect(generate(skinned()).triangleCount).toBeGreaterThan(generate(defaultSpec()).triangleCount)
  })
})

describe('a posed skin', () => {
  test('never pulls a triangle into a spike', () => {
    const creature = generate(skinned())
    const mesh = theSkinOf(creature)
    creature.root.updateMatrixWorld(true)

    const position = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.getIndex()!
    const at = (i: number) => mesh.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(position, i))

    const before = Array.from({ length: position.count }, (_, i) => at(i).clone())
    for (const joint of ['frontUpperL', 'backUpperL', 'backLowerL', 'head', 'spine']) {
      creature.joints[joint]!.rotation.x += 0.7
    }
    creature.root.updateMatrixWorld(true)
    const after = Array.from({ length: position.count }, (_, i) => at(i))
    const shift = before.map((point, i) => point.distanceTo(after[i]!))

    // A triangle whose corners move far apart relative to its own size has been
    // pulled into a spike — the signature of a vertex following the wrong bone.
    let worst = 0
    for (let t = 0; t < index.count; t += 3) {
      const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)]
      const edge = Math.max(before[a]!.distanceTo(before[b]!), before[b]!.distanceTo(before[c]!), 1e-6)
      const spread = Math.max(shift[a]!, shift[b]!, shift[c]!) - Math.min(shift[a]!, shift[b]!, shift[c]!)
      worst = Math.max(worst, spread / edge)
    }

    expect(worst).toBeLessThan(3)
  })
})
