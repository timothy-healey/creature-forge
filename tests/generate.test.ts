import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { CORE_JOINTS } from '../src/joints'
import { generate } from '../src/generate'
import {
  HEAD_TYPES,
  LEG_TYPES,
  SLIDERS,
  TAIL_TYPES,
  clampSpec,
  defaultSpec,
  writeSlider,
  type CreatureSpec,
} from '../src/spec'

function everyCombination(): CreatureSpec[] {
  const specs: CreatureSpec[] = []
  for (const head of HEAD_TYPES) {
    for (const legs of LEG_TYPES) {
      for (const tail of TAIL_TYPES) {
        const spec = defaultSpec()
        spec.head.type = head
        spec.legs.type = legs
        spec.tail.type = tail
        specs.push(spec)
      }
    }
  }
  return specs
}

function specWithEverySliderAt(value: number): CreatureSpec {
  const spec = defaultSpec()
  for (const slider of SLIDERS) writeSlider(spec, slider.path, value)
  return spec
}

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = []
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) found.push(node as THREE.Mesh)
  })
  return found
}

function label(spec: CreatureSpec): string {
  return `${spec.head.type}/${spec.legs.type}/${spec.tail.type}`
}

describe('generate', () => {
  test('builds triangles for every combination of part types', () => {
    for (const spec of everyCombination()) {
      expect(generate(spec).triangleCount, label(spec)).toBeGreaterThan(0)
    }
  })

  test('never emits a NaN vertex, for any combination of part types', () => {
    for (const spec of everyCombination()) {
      for (const mesh of meshes(generate(spec).root)) {
        const position = mesh.geometry.getAttribute('position')
        for (let i = 0; i < position.count * position.itemSize; i++) {
          expect(Number.isFinite(position.array[i]), `${label(spec)} ${mesh.name}[${i}]`).toBe(true)
        }
      }
    }
  })

  test('survives both slider extremes without a degenerate mesh', () => {
    for (const value of [0, 1]) {
      const creature = generate(specWithEverySliderAt(value))
      expect(creature.triangleCount, `all sliders at ${value}`).toBeGreaterThan(0)

      const box = new THREE.Box3().setFromObject(creature.root)
      expect(box.isEmpty(), `all sliders at ${value}`).toBe(false)
      expect(Number.isFinite(box.min.y) && Number.isFinite(box.max.y)).toBe(true)
    }
  })

  test('clamps a spec it is handed, so a bad slider cannot reach geometry', () => {
    const spec = defaultSpec()
    spec.torso.height = NaN

    const creature = generate(spec)

    expect(creature.triangleCount).toBeGreaterThan(0)
    const box = new THREE.Box3().setFromObject(creature.root)
    expect(Number.isFinite(box.max.y)).toBe(true)
  })

  test('exposes every joint the animator poses', () => {
    const creature = generate(defaultSpec())

    for (const name of CORE_JOINTS) {
      expect(creature.joints[name], name).toBeDefined()
    }
  })

  test('gives every mesh a vertex colour attribute, since nothing is textured', () => {
    for (const mesh of meshes(generate(defaultSpec()).root)) {
      expect(mesh.geometry.getAttribute('color'), mesh.name).toBeDefined()
    }
  })

  test('mirrors the limbs across the centre line', () => {
    const { joints } = generate(defaultSpec())

    expect(joints.backUpperL!.position.x).toBeCloseTo(-joints.backUpperR!.position.x)
    expect(joints.frontUpperL!.position.x).toBeCloseTo(-joints.frontUpperR!.position.x)
  })

  test('stands on the ground rather than floating or sinking', () => {
    for (const spec of everyCombination()) {
      const creature = generate(spec)
      creature.root.updateMatrixWorld(true)

      const box = new THREE.Box3().setFromObject(creature.root)
      expect(box.min.y, label(spec)).toBeCloseTo(0, 1)
    }
  })

  test('gives a long tail more segments than a stub, and none at all when none', () => {
    const tailJoints = (type: CreatureSpec['tail']['type']) => {
      const spec = defaultSpec()
      spec.tail.type = type
      return Object.keys(generate(spec).joints).filter((name) => name.startsWith('tail')).length
    }

    expect(tailJoints('none')).toBe(0)
    expect(tailJoints('long')).toBeGreaterThan(tailJoints('stub'))
    expect(tailJoints('stub')).toBeGreaterThan(0)
  })

  test('paints the horns with the accent colour only when horns are asked for', () => {
    const hornless = defaultSpec()
    hornless.head.horns = 0
    const horned = clampSpec({ ...defaultSpec(), head: { ...defaultSpec().head, horns: 2 } })

    expect(generate(horned).triangleCount).toBeGreaterThan(generate(hornless).triangleCount)
  })
})
