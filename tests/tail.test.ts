import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { MAX_TAIL } from '../src/joints'
import { poseAt } from '../src/animate'
import { generate } from '../src/generate'
import { MUTATIONS, TAIL_TYPES, defaultSpec, randomSpec, type CreatureSpec } from '../src/spec'

const withTail = (length: number, edit: (spec: CreatureSpec) => void = () => {}): CreatureSpec => {
  const spec = defaultSpec()
  spec.tail.length = length
  edit(spec)
  return spec
}

const beadsOf = (creature: ReturnType<typeof generate>) =>
  Object.keys(creature.joints).filter((name) => /^tail\d+$/.test(name))

function reach(spec: CreatureSpec): number {
  const creature = generate(spec)
  creature.root.updateMatrixWorld(true)
  const beads = beadsOf(creature)
  if (beads.length === 0) return 0

  const hip = creature.joints.hip!.getWorldPosition(new THREE.Vector3())
  const tip = creature.joints[`tail${beads.length - 1}`]!.getWorldPosition(new THREE.Vector3())
  return hip.distanceTo(tip)
}

function footHeight(spec: CreatureSpec): number | null {
  const creature = generate(spec)
  creature.root.updateMatrixWorld(true)
  const feet = new THREE.Box3()
  for (const name of Object.keys(creature.joints)) {
    if (name.includes('Foot')) feet.expandByObject(creature.joints[name]!)
  }
  return feet.isEmpty() ? null : feet.min.y
}

describe('tail length', () => {
  test('makes a longer tail', () => {
    const lengths = [0, 0.25, 0.5, 0.75, 1].map((value) => reach(withTail(value)))

    for (let i = 1; i < lengths.length; i++) expect(lengths[i]!).toBeGreaterThan(lengths[i - 1]!)
  })

  test('buys beads as well as reach, so a long tail can curve', () => {
    // Twice as long out of the same three segments is three sticks, not a tail.
    const short = beadsOf(generate(withTail(0))).length
    const long = beadsOf(generate(withTail(1))).length

    expect(long).toBeGreaterThan(short)
    expect(long).toBeLessThanOrEqual(MAX_TAIL)
  })

  test('never asks for more beads than the gait can swish', () => {
    for (const type of TAIL_TYPES) {
      const creature = generate(withTail(1, (spec) => void (spec.tail.type = type)))
      const posed = poseAt(0.3, 'walk', creature === null ? defaultSpec().body : defaultSpec().body, creature.limbs)

      for (const bead of beadsOf(creature)) {
        expect(posed[bead], `${type} ${bead}`).toBeDefined()
      }
    }
  })

  test('does nothing at all when there is no tail', () => {
    const none = (length: number) => reach(withTail(length, (spec) => void (spec.tail.type = 'none')))

    expect(none(0)).toBe(0)
    expect(none(1)).toBe(0)
  })

  test('leaves the creature standing on its feet, not on its tail', () => {
    for (const length of [0, 0.5, 0.75, 1]) {
      expect(footHeight(withTail(length)), `length ${length}`).toBeCloseTo(0, 2)
    }
  })

  test('carries a long tail higher, rather than dragging it through the floor', () => {
    const lowest = (length: number) => {
      const creature = generate(withTail(length))
      creature.root.updateMatrixWorld(true)
      return new THREE.Box3().setFromObject(creature.root).min.y
    }

    for (const length of [0.5, 0.75, 1]) {
      expect(lowest(length), `length ${length}`).toBeGreaterThan(-0.02)
    }
  })

  test('holds across every mutation and every rolled creature', () => {
    for (const mutation of MUTATIONS) {
      const spec = withTail(0.9, (s) => void (s.body.mutation = mutation))
      const height = footHeight(spec)
      const creature = generate(spec)
      creature.root.updateMatrixWorld(true)
      const label = `${mutation}`

      if (height === null) {
        expect(new THREE.Box3().setFromObject(creature.root).min.y, label).toBeCloseTo(0, 1)
      } else {
        expect(height, label).toBeCloseTo(0, 1)
      }
    }

    for (let seed = 0; seed < 25; seed++) {
      const creature = generate(randomSpec())
      creature.root.updateMatrixWorld(true)
      expect(Number.isFinite(new THREE.Box3().setFromObject(creature.root).max.y)).toBe(true)
    }
  })
})
