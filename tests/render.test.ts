import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import {
  BACKGROUNDS,
  RENDER_MODES,
  SCENERY,
  createWardrobe,
  defaultView,
  frameDistance,
  HOUSE_VIEW,
  materialFor,
  orbitPoint,
  type RenderMode,
} from '../src/render'
import { generate } from '../src/generate'
import { withSmoothNormals } from '../src/geometry'
import { MUTATIONS, defaultSpec } from '../src/spec'

/** What a viewer would actually notice about a material, as a comparable key. */
function look(material: THREE.Material): string {
  const any = material as THREE.MeshBasicMaterial & {
    flatShading?: boolean
    gradientMap?: unknown
  }
  return [
    material.type,
    any.wireframe ? 'wire' : '',
    any.vertexColors ? 'vertexColors' : 'flatColour',
    material.transparent ? `alpha${any.opacity}` : 'opaque',
    material.blending === THREE.AdditiveBlending ? 'additive' : 'normal',
    any.gradientMap ? 'banded' : '',
    material.side === THREE.DoubleSide ? 'twoSided' : 'oneSided',
  ].join('|')
}

describe('the drawn modes', () => {
  test('every one of them looks different from every other', () => {
    const looks = RENDER_MODES.map((mode) => look(materialFor(mode, true)))

    expect(new Set(looks).size, `distinct looks among ${looks.join(' / ')}`).toBe(RENDER_MODES.length)
  })

  test('lit is the one that responds to light', () => {
    expect(materialFor('lit', true).type).toBe('MeshLambertMaterial')
    expect(materialFor('unlit', true).type).toBe('MeshBasicMaterial')
  })

  test('unlit carries the vertex colours and nothing else — what the hardware did', () => {
    const material = materialFor('unlit', true) as THREE.MeshBasicMaterial

    expect(material.vertexColors).toBe(true)
    expect(material.type).toBe('MeshBasicMaterial')
  })

  test('toon bands its shading rather than ramping it', () => {
    const material = materialFor('toon', true) as THREE.MeshToonMaterial

    expect(material.gradientMap).toBeTruthy()
    expect(material.gradientMap!.magFilter).toBe(THREE.NearestFilter)
  })

  test('wireframe draws edges, xray sees through, silhouette shows none of the palette', () => {
    expect((materialFor('wireframe', true) as THREE.MeshBasicMaterial).wireframe).toBe(true)
    expect(materialFor('xray', true).transparent).toBe(true)
    expect(materialFor('xray', true).blending).toBe(THREE.AdditiveBlending)
    expect((materialFor('silhouette', true) as THREE.MeshBasicMaterial).vertexColors).toBe(false)
  })

  test.each(RENDER_MODES)('%s honours flat shading where the material has any', (mode: RenderMode) => {
    const flat = materialFor(mode, true) as THREE.Material & { flatShading?: boolean }
    const smooth = materialFor(mode, false) as THREE.Material & { flatShading?: boolean }

    if (flat.flatShading === undefined) return
    expect(flat.flatShading).toBe(true)
    expect(smooth.flatShading).toBe(false)
  })

  test('the default view starts lit, chunky and wobbling', () => {
    const view = defaultView()

    expect(view.render).toBe('lit')
    expect(view.pixels).toBeGreaterThan(0)
    expect(view.pixels).toBeLessThan(1)
    expect(view.wobble).toBeGreaterThan(0)
  })
})

describe('deciding when to re-dress the meshes', () => {
  test('says yes the first time, whatever is asked for', () => {
    expect(createWardrobe().needsChange('lit', true)).toBe(true)
  })

  test('says no when nothing has changed', () => {
    const wardrobe = createWardrobe()
    wardrobe.wore('lit', true)

    expect(wardrobe.needsChange('lit', true)).toBe(false)
  })

  test('says yes when the mode changes — the bug this exists to prevent', () => {
    const wardrobe = createWardrobe()
    wardrobe.wore('lit', true)

    for (const mode of RENDER_MODES.filter((m) => m !== 'lit')) {
      expect(wardrobe.needsChange(mode, true), mode).toBe(true)
    }
  })

  test('says yes when the shading changes, because the mesh mode did', () => {
    const wardrobe = createWardrobe()
    wardrobe.wore('lit', true)

    expect(wardrobe.needsChange('lit', false)).toBe(true)
  })

  test('says yes when forced, because a new creature has bare meshes', () => {
    const wardrobe = createWardrobe()
    wardrobe.wore('toon', false)

    expect(wardrobe.needsChange('toon', false, true)).toBe(true)
  })

  test('is not fooled by a caller that mutates and hands back the same object', () => {
    // The original bug in one line: the settings object is shared, so any check
    // against it compares a value to itself.
    const wardrobe = createWardrobe()
    const view = defaultView()
    wardrobe.wore(view.render, true)

    view.render = 'wireframe'

    expect(wardrobe.needsChange(view.render, true)).toBe(true)
  })
})

describe('the places a creature can stand', () => {
  test('every one of them is a different place, not a different swatch', () => {
    const looks = BACKGROUNDS.map((kind) => {
      const place = SCENERY[kind]
      return [place.sky.join(), place.ground, place.fog?.join() ?? 'clear', place.key, place.grid].join('|')
    })

    expect(new Set(looks).size).toBe(BACKGROUNDS.length)
  })

  test('each one lights its creature as well as colouring the sky', () => {
    const keys = new Set(BACKGROUNDS.map((kind) => SCENERY[kind].key))
    const brightnesses = new Set(BACKGROUNDS.map((kind) => SCENERY[kind].brightness))

    expect(keys.size).toBeGreaterThan(3)
    expect(brightnesses.size).toBeGreaterThan(2)
  })

  test('a gradient sky names two colours and a flat one names the same twice', () => {
    expect(SCENERY.dusk.sky[0]).not.toBe(SCENERY.dusk.sky[1])
    expect(SCENERY.void.sky[0]).toBe(SCENERY.void.sky[1])
  })

  test('the grid is the one with no ground under it', () => {
    expect(SCENERY.grid.ground).toBeNull()
    expect(SCENERY.grid.grid).not.toBeNull()
    for (const kind of BACKGROUNDS.filter((k) => k !== 'grid')) {
      expect(SCENERY[kind].grid, kind).toBeNull()
    }
  })

  test('the studio is the one with no fog, so nothing fades out of it', () => {
    expect(SCENERY.studio.fog).toBeNull()
  })

  test('the default view starts somewhere', () => {
    expect(BACKGROUNDS).toContain(defaultView().background)
  })
})

describe('framing the creature', () => {
  test('pushes the camera back further for a bigger creature', () => {
    expect(frameDistance(2, 42, 1.6)).toBeGreaterThan(frameDistance(1, 42, 1.6))
  })

  test('scales linearly with size, because a camera is a similar triangle', () => {
    expect(frameDistance(2, 42, 1.6)).toBeCloseTo(frameDistance(1, 42, 1.6) * 2, 6)
  })

  test('needs more room on a narrow viewport than a wide one', () => {
    // On a tall panel the horizontal field is the limiting one, so the same
    // creature has to sit further back than it would in a cinema frame.
    expect(frameDistance(1, 42, 0.6)).toBeGreaterThan(frameDistance(1, 42, 1.8))
  })

  test('stops caring about aspect once the viewport is wider than it is tall', () => {
    expect(frameDistance(1, 42, 2.4)).toBeCloseTo(frameDistance(1, 42, 1.0), 6)
  })

  test('leaves margin, so a creature never touches the frame edge', () => {
    const tight = 1 / Math.sin((42 * Math.PI) / 180 / 2)

    expect(frameDistance(1, 42, 1.6)).toBeGreaterThan(tight)
  })

  test('survives a degenerate viewport instead of returning nonsense', () => {
    for (const aspect of [0, -1, Number.NaN]) {
      const distance = frameDistance(1, 42, aspect)
      expect(Number.isFinite(distance), String(aspect)).toBe(true)
      expect(distance).toBeGreaterThan(0)
    }
  })

  test('frames every creature the generator can make', () => {
    for (const mutation of MUTATIONS) {
      const spec = defaultSpec()
      spec.body.mutation = mutation
      const creature = generate(spec)
      creature.root.updateMatrixWorld(true)

      const sphere = new THREE.Box3().setFromObject(creature.root).getBoundingSphere(new THREE.Sphere())
      const distance = frameDistance(sphere.radius, 42, 1.1)

      // Inside the orbit limits the viewport actually allows.
      expect(distance, mutation).toBeGreaterThan(0.6)
      expect(distance, mutation).toBeLessThan(14)
    }
  })
})

describe('where the camera stands', () => {
  const centre = new THREE.Vector3(0, 0.9, 0)

  test('the house view looks down, not along', () => {
    const eye = orbitPoint(centre, 3, HOUSE_VIEW.azimuth, HOUSE_VIEW.elevation)

    expect(eye.y).toBeGreaterThan(centre.y)
  })

  test('it clears the creature’s own head rather than sitting level with it', () => {
    // A default creature is about 1.8 tall, so its centre sits near 0.9.
    const eye = orbitPoint(centre, 3, HOUSE_VIEW.azimuth, HOUSE_VIEW.elevation)

    expect(eye.y).toBeGreaterThan(1.8)
  })

  test('it is a three-quarter view, off both axes', () => {
    const eye = orbitPoint(centre, 3, HOUSE_VIEW.azimuth, HOUSE_VIEW.elevation)

    expect(Math.abs(eye.x)).toBeGreaterThan(0.4)
    expect(Math.abs(eye.z)).toBeGreaterThan(0.4)
  })

  test('it is not so steep that the creature is read from above', () => {
    expect(HOUSE_VIEW.elevation).toBeLessThan(Math.PI / 4)
  })

  test('stands exactly the distance it was asked for, whatever the angle', () => {
    for (const azimuth of [0, 0.62, 2.1, -1.4]) {
      for (const elevation of [0, 0.36, 1.1]) {
        expect(orbitPoint(centre, 3, azimuth, elevation).distanceTo(centre)).toBeCloseTo(3, 6)
      }
    }
  })

  test('keeps the creature centred: the target is the bounds centre, not the floor', () => {
    const creature = generate(defaultSpec())
    creature.root.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(creature.root)
    const sphere = bounds.getBoundingSphere(new THREE.Sphere())

    expect(sphere.center.y).toBeGreaterThan(bounds.min.y)
    expect(sphere.center.y).toBeLessThan(bounds.max.y)
    expect(Math.abs(sphere.center.y - (bounds.min.y + bounds.max.y) / 2)).toBeLessThan(1e-6)
  })
})

describe('the outline', () => {
  test('is on by default, because without textures nothing else separates a limb from the body', () => {
    expect(defaultView().outline).toBeGreaterThan(0)
  })

  test('starts at a resolution a creature can actually be read at', () => {
    // 48 + p^1.7 * 820 is the buffer height; a creature fills roughly 60% of it.
    const buffer = 48 + defaultView().pixels ** 1.7 * 820
    expect(buffer * 0.6).toBeGreaterThan(150)
  })

  test('smoothing normals leaves the geometry otherwise alone', () => {
    const creature = generate(defaultSpec())
    let checked = 0

    creature.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh || checked > 2) return
      checked++

      const smooth = withSmoothNormals(mesh.geometry)
      const before = mesh.geometry.getAttribute('position')
      const after = smooth.getAttribute('position')

      expect(after.count).toBe(before.count)
      for (let i = 0; i < before.count; i += 7) {
        expect(after.getX(i)).toBeCloseTo(before.getX(i), 6)
      }
    })

    expect(checked).toBeGreaterThan(0)
  })

  test('smoothing actually shares a normal between faces that meet', () => {
    const creature = generate(defaultSpec())
    let shared = false

    creature.root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (!mesh.isMesh || shared) return

      const flat = mesh.geometry.getAttribute('normal')
      const smooth = withSmoothNormals(mesh.geometry).getAttribute('normal')
      if (!flat) return

      // An outline pushed along per-face normals bursts the model apart; this is
      // the whole reason the outline carries its own copy of the geometry.
      for (let i = 0; i < flat.count; i++) {
        if (Math.abs(flat.getX(i) - smooth.getX(i)) > 1e-4) {
          shared = true
          break
        }
      }
    })

    expect(shared).toBe(true)
  })

  test('leaves every vertex normal a unit vector', () => {
    // Meshes hang off joints, not off the root, so this has to go looking.
    const meshes: THREE.Mesh[] = []
    generate(defaultSpec()).root.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (mesh.isMesh && mesh.geometry) meshes.push(mesh)
    })
    expect(meshes.length).toBeGreaterThan(0)

    for (const mesh of meshes.slice(0, 4)) {
      const normal = withSmoothNormals(mesh.geometry).getAttribute('normal')
      for (let i = 0; i < normal.count; i += 11) {
        const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))
        expect(length, `${mesh.name} vertex ${i}`).toBeCloseTo(1, 4)
      }
    }
  })
})
