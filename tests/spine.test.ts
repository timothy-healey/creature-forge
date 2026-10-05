import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { generate } from '../src/generate'
import { BUILDS, MESH_MODES, MUTATIONS, defaultSpec, randomSpec, type CreatureSpec } from '../src/spec'

const curved = (edit: (spec: CreatureSpec) => void): CreatureSpec => {
  const spec = defaultSpec()
  edit(spec)
  return spec
}

const beads = (creature: ReturnType<typeof generate>) =>
  Object.keys(creature.joints).filter((name) => /^body\d+$/.test(name))

function worldOf(spec: CreatureSpec, joint: string): THREE.Vector3 {
  const creature = generate(spec)
  creature.root.updateMatrixWorld(true)
  return creature.joints[joint]!.getWorldPosition(new THREE.Vector3())
}

describe('the spine', () => {
  test('is a chain on every creature, not only the segmented ones', () => {
    for (const mutation of MUTATIONS) {
      const spec = defaultSpec()
      spec.body.mutation = mutation
      expect(beads(generate(spec)).length, mutation).toBeGreaterThanOrEqual(3)
    }
  })

  test('gets more beads to bend with as detail rises', () => {
    const counts = [0, 0.5, 1].map((level) =>
      beads(generate(curved((spec) => void (spec.detail.level = level)))).length,
    )

    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeGreaterThan(counts[i - 1]!)
  })

  test('arch bends the body forward or back, and the middle is straight', () => {
    const sag = worldOf(curved((spec) => void (spec.spine.arch = 0)), 'head')
    const straight = worldOf(curved((spec) => void (spec.spine.arch = 0.5)), 'head')
    const arch = worldOf(curved((spec) => void (spec.spine.arch = 1)), 'head')

    expect(Math.abs(straight.z)).toBeLessThan(0.02)
    expect(sag.z).toBeLessThan(-0.2)
    expect(arch.z).toBeGreaterThan(0.2)
  })

  test('a bent spine carries the head lower than a straight one', () => {
    const straight = worldOf(curved((spec) => void (spec.spine.arch = 0.5)), 'head')
    const bent = worldOf(curved((spec) => void (spec.spine.arch = 1)), 'head')

    expect(bent.y).toBeLessThan(straight.y)
  })

  /**
   * Where the body's mass sits front to back, against the ground its feet are
   * on, in body heights. Zero means the creature is standing over its own feet.
   */
  function massPastFeet(spec: CreatureSpec): number {
    const creature = generate(spec)
    creature.root.updateMatrixWorld(true)

    let sum = 0
    let count = 0
    const point = new THREE.Vector3()
    creature.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh || !mesh.geometry) return
      const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < position.count; i++) {
        sum += point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).z
        count++
      }
    })
    const mass = sum / Math.max(1, count)

    let near = Infinity
    let far = -Infinity
    for (const [name, node] of Object.entries(creature.joints)) {
      if (!name.includes('Foot')) continue
      const z = node.getWorldPosition(new THREE.Vector3()).z
      near = Math.min(near, z)
      far = Math.max(far, z)
    }
    if (!Number.isFinite(near)) return 0

    const height = new THREE.Box3().setFromObject(creature.root).getSize(new THREE.Vector3()).y
    // A foot has width of its own; give the footprint that much slack each way.
    const slack = height * 0.08
    if (mass < near - slack) return (near - slack - mass) / height
    if (mass > far + slack) return (mass - far - slack) / height
    return 0
  }

  /** The angle of the hips→head chord off vertical, in degrees: the body's axis. */
  function bodyAxis(arch: number): number {
    const spec = curved((edit) => void (edit.spine.arch = arch))
    const creature = generate(spec)
    creature.root.updateMatrixWorld(true)
    const head = creature.joints.head!.getWorldPosition(new THREE.Vector3())
    const hips = creature.joints.body0!.getWorldPosition(new THREE.Vector3())
    const up = head.sub(hips).normalize().y
    return (Math.acos(Math.max(-1, Math.min(1, up))) * 180) / Math.PI
  }

  test('a sagging spine leaves the creature standing over its own feet', () => {
    for (const build of BUILDS) {
      for (const arch of [0, 0.25, 0.5, 0.75, 1]) {
        const spec = curved((edit) => {
          edit.body.build = build
          edit.spine.arch = arch
        })
        expect(massPastFeet(spec), `${build} at arch ${arch}`).toBeLessThan(0.08)
      }
    }
  })

  test('arch curves the back rather than tipping the whole body over', () => {
    // A bend shared equally down the chain integrates into one big turn, and the
    // creature reads as fallen rather than curved. The body's own axis has to
    // survive the slider.
    for (const arch of [0, 0.25, 0.75, 1]) {
      expect(Math.abs(bodyAxis(arch) - bodyAxis(0.5)), `arch ${arch}`).toBeLessThan(26)
    }
  })

  test('sway swings the body off the midline, either way', () => {
    const offCentre = (sway: number) => {
      const creature = generate(curved((spec) => void (spec.spine.sway = sway)))
      creature.root.updateMatrixWorld(true)
      let worst = 0
      for (const name of beads(creature)) {
        worst = Math.max(worst, Math.abs(creature.joints[name]!.getWorldPosition(new THREE.Vector3()).x))
      }
      return worst
    }

    // A Y rotation would leave this at zero: a bead extends along its own Y.
    expect(offCentre(0.5)).toBeLessThan(0.01)
    expect(offCentre(0)).toBeGreaterThan(0.05)
    expect(offCentre(1)).toBeGreaterThan(0.05)
  })

  test('carries everything that rides it — head, ridge, wings — around the curve', () => {
    const spec = curved((spec) => {
      spec.spine.arch = 1
      spec.back.ridge = 'spines'
      spec.wings.type = 'small'
    })
    const creature = generate(spec)
    creature.root.updateMatrixWorld(true)

    // Nothing is left behind at the origin where a straight spine used to put it.
    const ridge = new THREE.Box3()
    creature.root.traverse((node) => {
      if (node.name.startsWith('ridge')) ridge.expandByObject(node)
    })
    const body = new THREE.Box3().setFromObject(creature.root)

    expect(ridge.isEmpty()).toBe(false)
    expect(body.containsBox(ridge)).toBe(true)
    expect(creature.joints.wingL!.getWorldPosition(new THREE.Vector3()).z).not.toBeCloseTo(0, 2)
  })

  test('still stands on the ground however far it is bent', () => {
    for (const arch of [0, 0.25, 0.75, 1]) {
      for (const sway of [0, 1]) {
        for (const build of BUILDS) {
          const spec = curved((s) => {
            s.spine.arch = arch
            s.spine.sway = sway
            s.body.build = build
          })
          const creature = generate(spec)
          creature.root.updateMatrixWorld(true)

          const label = `arch ${arch} sway ${sway} ${build}`
          expect(new THREE.Box3().setFromObject(creature.root).min.y, label).toBeCloseTo(0, 1)
        }
      }
    }
  })

  test('bends in both mesh modes, and in every rolled creature', () => {
    for (const mesh of MESH_MODES) {
      for (let seed = 0; seed < 12; seed++) {
        const spec = randomSpec()
        spec.body.mesh = mesh
        const creature = generate(spec)
        creature.root.updateMatrixWorld(true)

        const bounds = new THREE.Box3().setFromObject(creature.root)
        expect(bounds.isEmpty(), mesh).toBe(false)
        expect(Number.isFinite(bounds.max.y), mesh).toBe(true)
      }
    }
  })
})
