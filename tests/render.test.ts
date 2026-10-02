import { describe, expect, test } from 'vitest'
import * as THREE from 'three'
import { RENDER_MODES, createWardrobe, defaultView, materialFor, type RenderMode } from '../src/render'

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
