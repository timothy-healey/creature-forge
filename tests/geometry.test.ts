import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { prism, type Section } from '../src/geometry'

const SIDE = new THREE.Color('#8844cc')
const BELLY = new THREE.Color('#ffdd66')

const straight: Section[] = [
  { y: 0, rx: 0.2, rz: 0.2 },
  { y: 1, rx: 0.2, rz: 0.2 },
]

function triangles(geometry: THREE.BufferGeometry): { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3 }[] {
  const position = geometry.getAttribute('position')
  const out = []
  for (let i = 0; i < position.count; i += 3) {
    out.push({
      a: new THREE.Vector3().fromBufferAttribute(position, i),
      b: new THREE.Vector3().fromBufferAttribute(position, i + 1),
      c: new THREE.Vector3().fromBufferAttribute(position, i + 2),
    })
  }
  return out
}

function centre(geometry: THREE.BufferGeometry): THREE.Vector3 {
  geometry.computeBoundingBox()
  return geometry.boundingBox!.getCenter(new THREE.Vector3())
}

describe('prism', () => {
  test('is built entirely from triangles', () => {
    const geometry = prism({ sides: 6, sections: straight, colors: { side: SIDE } })

    expect(geometry.getAttribute('position').count % 3).toBe(0)
    expect(geometry.getIndex()).toBeNull()
  })

  test('gives every triangle a real area, so nothing is an invisible sliver', () => {
    const geometry = prism({ sides: 5, sections: straight, colors: { side: SIDE } })

    for (const { a, b, c } of triangles(geometry)) {
      const area = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() / 2
      expect(area).toBeGreaterThan(1e-7)
    }
  })

  test('winds every triangle to face outward, so nothing is culled away', () => {
    const geometry = prism({ sides: 6, sections: straight, colors: { side: SIDE } })
    const middle = centre(geometry)

    for (const { a, b, c } of triangles(geometry)) {
      const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a))
      const outward = new THREE.Vector3().addVectors(a, b).add(c).divideScalar(3).sub(middle)
      expect(normal.dot(outward)).toBeGreaterThan(0)
    }
  })

  test('never emits a NaN vertex', () => {
    const geometry = prism({ sides: 7, sections: straight, colors: { side: SIDE } })
    const position = geometry.getAttribute('position')

    for (let i = 0; i < position.count * 3; i++) {
      expect(Number.isFinite(position.array[i])).toBe(true)
    }
  })

  test('adds triangles as sides are added', () => {
    const count = (sides: number) =>
      prism({ sides, sections: straight, colors: { side: SIDE } }).getAttribute('position').count

    expect(count(6)).toBeGreaterThan(count(4))
    expect(count(8)).toBeGreaterThan(count(6))
  })

  test('adds triangles as sections are added', () => {
    const twoRings = prism({ sides: 5, sections: straight, colors: { side: SIDE } })
    const fourRings = prism({
      sides: 5,
      sections: [
        { y: 0, rx: 0.2, rz: 0.2 },
        { y: 0.3, rx: 0.3, rz: 0.3 },
        { y: 0.7, rx: 0.25, rz: 0.25 },
        { y: 1, rx: 0.1, rz: 0.1 },
      ],
      colors: { side: SIDE },
    })

    expect(fourRings.getAttribute('position').count).toBeGreaterThan(twoRings.getAttribute('position').count)
  })

  test('collapses a tipped end into a single point', () => {
    const geometry = prism({ sides: 6, sections: straight, colors: { side: SIDE }, tip: 'top' })
    const position = geometry.getAttribute('position')

    const atTop = []
    for (let i = 0; i < position.count; i++) {
      const vertex = new THREE.Vector3().fromBufferAttribute(position, i)
      if (vertex.y > 0.999) atTop.push(vertex)
    }

    expect(atTop.length).toBeGreaterThan(0)
    for (const vertex of atTop) {
      expect(vertex.x).toBeCloseTo(0, 6)
      expect(vertex.z).toBeCloseTo(0, 6)
    }
  })

  test('paints the belly colour only on faces that point forward', () => {
    const geometry = prism({ sides: 8, sections: straight, colors: { side: SIDE, belly: BELLY } })
    const position = geometry.getAttribute('position')
    const color = geometry.getAttribute('color')

    let painted = 0
    for (let i = 0; i < position.count; i += 3) {
      const z = (position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2)) / 3
      const isBelly = Math.abs(color.getX(i) - BELLY.r) < 1e-5 && Math.abs(color.getY(i) - BELLY.g) < 1e-5
      if (isBelly) {
        painted++
        expect(z).toBeGreaterThan(0)
      }
    }

    expect(painted).toBeGreaterThan(0)
  })

  test('reaches the width it is asked for, whatever the side count', () => {
    for (const sides of [4, 5, 6, 8]) {
      const geometry = prism({ sides, sections: straight, colors: { side: SIDE } })
      geometry.computeBoundingBox()
      const width = geometry.boundingBox!.max.x - geometry.boundingBox!.min.x

      expect(width, `${sides} sides`).toBeCloseTo(0.4, 1)
    }
  })
})
