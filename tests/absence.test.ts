import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { CORE_JOINTS } from '../src/joints'
import { generate } from '../src/generate'
import {
  EAR_TYPES,
  EYE_COUNTS,
  FRONT_LIMBS,
  HEAD_TYPES,
  LEG_TYPES,
  MESH_MODES,
  RIDGE_TYPES,
  TAIL_TYPES,
  WING_TYPES,
  defaultSpec,
  randomSpec,
  type CreatureSpec,
} from '../src/spec'

const edited = (edit: (spec: CreatureSpec) => void): CreatureSpec => {
  const spec = defaultSpec()
  edit(spec)
  return spec
}

const cost = (spec: CreatureSpec) => generate(spec).triangleCount

/** Everything a creature is allowed to be without. */
const stripped = (): CreatureSpec =>
  edited((spec) => {
    spec.body.frontLimb = 'none'
    spec.legs.type = 'none'
    spec.head.type = 'none'
    spec.head.horns = 0
    spec.head.eyes = 0
    spec.head.ears = 'none'
    spec.tail.type = 'none'
    spec.back.ridge = 'none'
    spec.wings.type = 'none'
  })

describe('every optional part', () => {
  test.each([
    ['front limbs', (spec: CreatureSpec) => void (spec.body.frontLimb = 'none')],
    ['back legs', (spec: CreatureSpec) => void (spec.legs.type = 'none')],
    ['the face', (spec: CreatureSpec) => void (spec.head.type = 'none')],
    ['eyes', (spec: CreatureSpec) => void (spec.head.eyes = 0)],
    ['horns', (spec: CreatureSpec) => void (spec.head.horns = 0)],
    ['ears', (spec: CreatureSpec) => void (spec.head.ears = 'none')],
    ['the tail', (spec: CreatureSpec) => void (spec.tail.type = 'none')],
    ['the back ridge', (spec: CreatureSpec) => void (spec.back.ridge = 'none')],
    ['wings', (spec: CreatureSpec) => void (spec.wings.type = 'none')],
  ])('can be left off: %s costs nothing when absent', (_name, strip) => {
    const withIt = edited((spec) => {
      spec.head.ears = 'pointed'
      spec.head.horns = 2
      spec.head.eyes = 2
      spec.back.ridge = 'sail'
      spec.wings.type = 'large'
      spec.tail.type = 'long'
    })
    const withoutIt = edited((spec) => {
      spec.head.ears = 'pointed'
      spec.head.horns = 2
      spec.head.eyes = 2
      spec.back.ridge = 'sail'
      spec.wings.type = 'large'
      spec.tail.type = 'long'
      strip(spec)
    })

    expect(cost(withoutIt)).toBeLessThan(cost(withIt))
  })

  test('every list offers a way to say no', () => {
    expect(FRONT_LIMBS).toContain('none')
    expect(LEG_TYPES).toContain('none')
    expect(HEAD_TYPES).toContain('none')
    expect(EAR_TYPES).toContain('none')
    expect(TAIL_TYPES).toContain('none')
    expect(RIDGE_TYPES).toContain('none')
    expect(WING_TYPES).toContain('none')
    expect(EYE_COUNTS).toContain(0)
  })
})

describe('a creature without arms or legs', () => {
  test('still has every joint a gait poses, so the walk never has to ask', () => {
    const creature = generate(stripped())

    for (const name of CORE_JOINTS) expect(creature.joints[name], name).toBeDefined()
  })

  test('hangs no geometry off those joints', () => {
    const creature = generate(stripped())
    const box = new THREE.Box3().expandByObject(creature.joints.backUpperL!)

    expect(box.isEmpty()).toBe(true)
  })

  test('rests its body on the floor rather than standing on nothing', () => {
    const creature = generate(stripped())
    creature.root.updateMatrixWorld(true)

    expect(new THREE.Box3().setFromObject(creature.root).min.y).toBeCloseTo(0, 1)
  })

  test('does not grow enormous forelegs reaching for a floor its hind legs left', () => {
    const crawler = edited((spec) => {
      spec.legs.type = 'none'
      spec.body.frontLimb = 'forelegs'
    })
    const creature = generate(crawler)
    creature.root.updateMatrixWorld(true)

    const box = new THREE.Box3().setFromObject(creature.root)
    expect(box.min.y).toBeCloseTo(0, 1)
    expect(box.max.y).toBeLessThan(3)
  })

  test('is still a creature: it has a body, and it builds', () => {
    expect(cost(stripped())).toBeGreaterThan(0)
  })

  test('builds in both mesh modes', () => {
    for (const mesh of MESH_MODES) {
      const spec = stripped()
      spec.body.mesh = mesh
      const creature = generate(spec)
      creature.root.updateMatrixWorld(true)

      expect(new THREE.Box3().setFromObject(creature.root).min.y, mesh).toBeCloseTo(0, 1)
      expect(creature.triangleCount, mesh).toBeGreaterThan(0)
    }
  })
})

describe('eyes', () => {
  test('come in pairs, and more pairs cost more', () => {
    const counts = EYE_COUNTS.map((eyes) => cost(edited((spec) => void (spec.head.eyes = eyes))))

    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeGreaterThan(counts[i - 1]!)
  })

  test('climb the skull rather than piling up in one place', () => {
    const creature = generate(edited((spec) => void (spec.head.eyes = 6)))
    creature.root.updateMatrixWorld(true)

    const heights: number[] = []
    creature.root.traverse((node) => {
      if (!(node as THREE.Mesh).isMesh || !node.name.startsWith('eye')) return
      heights.push(node.getWorldPosition(new THREE.Vector3()).y)
    })

    expect(heights.length).toBe(6)
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.01)
  })
})

describe('rolled creatures', () => {
  test('reach every kind of absence, given enough rolls', () => {
    const rolls = Array.from({ length: 300 }, () => randomSpec())

    expect(rolls.some((spec) => spec.body.frontLimb === 'none')).toBe(true)
    expect(rolls.some((spec) => spec.legs.type === 'none')).toBe(true)
    expect(rolls.some((spec) => spec.head.type === 'none')).toBe(true)
    expect(rolls.some((spec) => spec.head.eyes === 0)).toBe(true)
  })

  test('still build and stand when they roll an absence', () => {
    for (let seed = 0; seed < 60; seed++) {
      const creature = generate(randomSpec())
      creature.root.updateMatrixWorld(true)

      const bounds = new THREE.Box3().setFromObject(creature.root)
      expect(bounds.isEmpty()).toBe(false)
      expect(bounds.min.y).toBeCloseTo(0, 1)
    }
  })
})

describe('eyes you can actually see', () => {
  /** The only question that matters: looking at the creature, is the eye there. */
  function hiddenEyes(spec: CreatureSpec): number {
    const creature = generate(spec)
    creature.root.updateMatrixWorld(true)

    // Only the head's own parts count as occluders. An arm placed up by the
    // jaw can stand in front of an eye, and that is the creature being odd
    // rather than the skull swallowing its own eyes.
    const meshes: THREE.Mesh[] = []
    creature.joints.head!.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) meshes.push(node as THREE.Mesh)
    })

    const caster = new THREE.Raycaster()
    let hidden = 0
    for (const eye of meshes.filter((mesh) => mesh.name.startsWith('eye'))) {
      const centre = new THREE.Box3().expandByObject(eye).getCenter(new THREE.Vector3())
      const seen = [0, 0.35, -0.35].some((yaw) => {
        const from = centre.clone().add(new THREE.Vector3(Math.sin(yaw) * 4, 0.25, Math.cos(yaw) * 4))
        caster.set(from, centre.clone().sub(from).normalize())
        return caster.intersectObjects(meshes, false)[0]?.object.name.startsWith('eye') ?? false
      })
      if (!seen) hidden++
    }
    return hidden
  }

  test.each(HEAD_TYPES)('are not swallowed by a %s face', (type) => {
    expect(hiddenEyes(edited((spec) => void (spec.head.type = type)))).toBe(0)
  })

  test.each(EYE_COUNTS.filter((count) => count > 0))('all %i of them are visible', (count) => {
    expect(hiddenEyes(edited((spec) => void (spec.head.eyes = count)))).toBe(0)
  })

  test('stay visible across every head shape the sliders can make', () => {
    let hidden = 0
    for (let i = 0; i < 48; i++) {
      const spec = randomSpec()
      spec.head.eyes = 2
      hidden += hiddenEyes(spec)
    }

    expect(hidden).toBe(0)
  })

  test('are big enough to read — a good fraction of the skull, not a speck', () => {
    const creature = generate(defaultSpec())
    const skull = new THREE.Box3()
    const eye = new THREE.Box3()
    creature.root.traverse((node) => {
      if (node.name === 'skull') skull.expandByObject(node)
      if (node.name === 'eye0L') eye.expandByObject(node)
    })

    const width = (box: THREE.Box3) => box.max.x - box.min.x
    expect(width(eye) / width(skull)).toBeGreaterThan(0.25)
  })
})
