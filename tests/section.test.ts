import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { fan, prism, sample, type Profile } from '../src/geometry'

const SIDE = new THREE.Color('#8844cc')
const straight: Profile = { rx: () => 0.2, rz: () => 0.2 }
const sections = sample(straight, 1, 1)

function points(geometry: THREE.BufferGeometry): THREE.Vector3[] {
  const position = geometry.getAttribute('position')
  return Array.from({ length: position.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i))
}

/** The base ring of a prism — the cross-section itself, without the cap's centre point. */
function ring(geometry: THREE.BufferGeometry): THREE.Vector3[] {
  return points(geometry).filter((p) => Math.abs(p.y) < 1e-4 && Math.hypot(p.x, p.z) > 1e-6)
}

describe('cross-section shape', () => {
  test('a low power gives a diamond: every corner the same distance by taxicab', () => {
    const geometry = prism({
      sides: 8,
      sections,
      colors: { side: SIDE },
      shape: { power: 1, frontBias: 1 },
    })

    const taxicab = ring(geometry).map((p) => Math.abs(p.x) + Math.abs(p.z))
    const spread = Math.max(...taxicab) - Math.min(...taxicab)

    expect(spread).toBeLessThan(0.02)
  })

  test('a high power pushes the corners out toward a slab', () => {
    const corner = (power: number) => {
      const geometry = prism({ sides: 8, sections, colors: { side: SIDE }, shape: { power, frontBias: 1 } })
      return Math.max(...ring(geometry).map((p) => Math.hypot(p.x, p.z)))
    }

    expect(corner(4)).toBeGreaterThan(corner(2))
    expect(corner(2)).toBeGreaterThan(corner(1))
  })

  test('a front bias swells the belly without moving the back', () => {
    const geometry = prism({
      sides: 10,
      sections,
      colors: { side: SIDE },
      shape: { power: 2, frontBias: 1.8 },
    })
    const corners = ring(geometry)

    const front = Math.max(...corners.map((p) => p.z))
    const back = Math.abs(Math.min(...corners.map((p) => p.z)))

    expect(front).toBeGreaterThan(back * 1.3)
  })

  test('still winds outward whatever the shape, so nothing is culled away', () => {
    for (const power of [1, 2, 4]) {
      for (const frontBias of [0.6, 1, 1.8]) {
        const geometry = prism({ sides: 7, sections, colors: { side: SIDE }, shape: { power, frontBias } })
        geometry.computeBoundingBox()
        const middle = geometry.boundingBox!.getCenter(new THREE.Vector3())
        const all = points(geometry)

        for (let i = 0; i < all.length; i += 3) {
          const [a, b, c] = [all[i]!, all[i + 1]!, all[i + 2]!]
          const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a))
          const outward = new THREE.Vector3().addVectors(a, b).add(c).divideScalar(3).sub(middle)
          expect(normal.dot(outward), `power ${power} bias ${frontBias}`).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe('fan — the flat sheet a wing is made of', () => {
  const rim: [number, number][] = [
    [0.1, 0.6],
    [0.5, 0.5],
    [0.7, 0.1],
    [0.4, -0.2],
  ]

  test('is built entirely from triangles', () => {
    const geometry = fan({ origin: [0, 0], rim, color: SIDE })

    expect(geometry.getAttribute('position').count % 3).toBe(0)
    expect(geometry.getIndex()).toBeNull()
  })

  test('is flat — every vertex sits on one plane', () => {
    for (const point of points(fan({ origin: [0, 0], rim, color: SIDE }))) {
      expect(point.z).toBeCloseTo(0, 6)
    }
  })

  test('faces both ways, because a membrane is visible from either side', () => {
    const geometry = fan({ origin: [0, 0], rim, color: SIDE })
    const all = points(geometry)

    let up = 0
    let down = 0
    for (let i = 0; i < all.length; i += 3) {
      const normal = new THREE.Vector3()
        .subVectors(all[i + 1]!, all[i]!)
        .cross(new THREE.Vector3().subVectors(all[i + 2]!, all[i]!))
      if (normal.z > 0) up++
      else down++
    }

    expect(up).toBeGreaterThan(0)
    expect(up).toBe(down)
  })

  test('gives every triangle a real area', () => {
    const geometry = fan({ origin: [0, 0], rim, color: SIDE })
    const all = points(geometry)

    for (let i = 0; i < all.length; i += 3) {
      const area =
        new THREE.Vector3()
          .subVectors(all[i + 1]!, all[i]!)
          .cross(new THREE.Vector3().subVectors(all[i + 2]!, all[i]!))
          .length() / 2
      expect(area).toBeGreaterThan(1e-7)
    }
  })

  test('carries a colour on every vertex, like everything else here', () => {
    const geometry = fan({ origin: [0, 0], rim, color: SIDE })
    const color = geometry.getAttribute('color')

    expect(color).toBeDefined()
    expect(color.count).toBe(geometry.getAttribute('position').count)
  })
})
