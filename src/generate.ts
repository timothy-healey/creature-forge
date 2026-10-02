import * as THREE from 'three'
import { backwardBox, forwardBox, limbBox, taperedBox } from './geometry'
import { type RestMap, type RestPose, rest } from './joints'
import { type CreatureSpec, clampSpec } from './spec'

/**
 * Turns a spec into a tree of rigid parts.
 *
 * There is no skeleton and no vertex skinning. Each part is its own mesh,
 * parented to the joint it swings from, and animating means rotating those
 * nodes. That is how characters of this era were actually built — the seams at
 * the joints are the look, not a compromise.
 */

export interface Creature {
  root: THREE.Group
  joints: Record<string, THREE.Object3D>
  rest: RestMap
  material: THREE.Material
  triangleCount: number
  dispose(): void
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

const TAIL_SEGMENTS: Record<CreatureSpec['tail']['type'], number> = {
  none: 0,
  stub: 1,
  long: 3,
}

export function generate(input: CreatureSpec): Creature {
  const spec = clampSpec(input)

  const body = new THREE.Color(spec.colors.body)
  const belly = new THREE.Color(spec.colors.belly)
  const accent = new THREE.Color(spec.colors.accent)
  const eye = new THREE.Color(spec.colors.eye)

  const torsoH = lerp(0.34, 0.74, spec.torso.height)
  const torsoW = lerp(0.26, 0.58, spec.torso.width)
  const torsoD = lerp(0.2, 0.48, spec.torso.depth)
  const legLen = lerp(0.28, 0.86, spec.legs.length)
  const legThick = lerp(0.07, 0.21, spec.legs.thickness)
  const armLen = lerp(0.24, 0.68, spec.arms.length)
  const armThick = lerp(0.055, 0.17, spec.arms.thickness)
  const headLen = lerp(0.14, 0.44, spec.head.length)
  const headW = lerp(0.19, 0.44, spec.head.width)
  const headH = headW * 0.82
  const headD = headW * 0.86
  const neckLen = 0.05 + torsoW * 0.12

  const root = new THREE.Group()
  root.name = 'creature'
  const joints: Record<string, THREE.Object3D> = {}
  const restMap: RestMap = {}
  const geometries: THREE.BufferGeometry[] = []

  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })

  function joint(name: string, parent: THREE.Object3D, at: THREE.Vector3Like, pose: RestPose): THREE.Group {
    const group = new THREE.Group()
    group.name = name
    group.position.set(at.x, at.y, at.z)
    group.rotation.set(pose.rx, pose.ry, pose.rz)
    parent.add(group)
    joints[name] = group
    restMap[name] = { ...pose, y: group.position.y }
    return group
  }

  function part(name: string, parent: THREE.Object3D, geometry: THREE.BufferGeometry, at?: THREE.Vector3Like): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    if (at) mesh.position.set(at.x, at.y, at.z)
    parent.add(mesh)
    geometries.push(geometry)
    return mesh
  }

  // ─── spine ────────────────────────────────────────────────────────────────
  const hip = joint('hip', root, { x: 0, y: legLen, z: 0 }, rest())
  const spine = joint('spine', hip, { x: 0, y: 0, z: 0 }, rest())

  part(
    'torso',
    spine,
    taperedBox({
      bottom: [torsoW * 0.84, torsoD * 0.88],
      top: [torsoW, torsoD],
      height: torsoH,
      colors: [belly, body, body, body, body, belly],
    }),
  )

  part(
    'neck',
    spine,
    taperedBox({
      bottom: [torsoW * 0.44, torsoD * 0.46],
      top: [torsoW * 0.36, torsoD * 0.4],
      height: neckLen,
      colors: body,
    }),
    { x: 0, y: torsoH, z: 0 },
  )

  // ─── head ─────────────────────────────────────────────────────────────────
  const head = joint('head', spine, { x: 0, y: torsoH + neckLen, z: 0 }, rest())

  part(
    'skull',
    head,
    taperedBox({
      bottom: [headW * 0.9, headD * 0.9],
      top: [headW, headD],
      height: headH,
      colors: [body, body, body, body, body, belly],
    }),
  )

  buildFace(head, spec.head.type)
  buildEyes(head)
  buildHorns(head, spec.head.horns)

  function buildFace(parent: THREE.Object3D, type: CreatureSpec['head']['type']): void {
    const front = headD / 2 - 0.005
    if (type === 'snout') {
      part(
        'snout',
        parent,
        forwardBox({
          base: [headW * 0.66, headH * 0.54],
          tip: [headW * 0.46, headH * 0.34],
          length: headLen,
          colors: [body, body, body, body, belly, belly],
        }),
        { x: 0, y: headH * 0.38, z: front },
      )
      return
    }
    if (type === 'beak') {
      part(
        'beak',
        parent,
        forwardBox({
          base: [headW * 0.52, headH * 0.42],
          tip: [0.02, 0.02],
          length: headLen * 1.25,
          colors: accent,
        }),
        { x: 0, y: headH * 0.44, z: front },
      )
      return
    }
    part(
      'muzzle',
      parent,
      forwardBox({
        base: [headW * 0.88, headH * 0.62],
        tip: [headW * 0.82, headH * 0.5],
        length: headLen * 0.5,
        colors: [body, body, body, body, belly, belly],
      }),
      { x: 0, y: headH * 0.3, z: front },
    )
  }

  function buildEyes(parent: THREE.Object3D): void {
    const size = Math.max(0.035, headW * 0.15)
    for (const side of [-1, 1]) {
      part(
        side < 0 ? 'eyeL' : 'eyeR',
        parent,
        taperedBox({ bottom: [size, size * 0.5], top: [size, size * 0.5], height: size, colors: eye }),
        { x: side * headW * 0.28, y: headH * 0.58, z: headD / 2 - 0.004 },
      )
    }
  }

  function buildHorns(parent: THREE.Object3D, count: number): void {
    if (count === 0) return
    const length = 0.12 + headW * 0.42
    const offsets = count === 1 ? [0] : [-headW * 0.27, headW * 0.27]
    offsets.forEach((x, index) => {
      const mesh = part(
        `horn${index}`,
        parent,
        taperedBox({
          bottom: [headW * 0.2, headW * 0.2],
          top: [0.012, 0.012],
          height: length,
          colors: accent,
        }),
        { x, y: headH * 0.94, z: -headD * 0.08 },
      )
      mesh.rotation.x = -0.5
      mesh.rotation.z = -x * 1.4
    })
  }

  // ─── arms ─────────────────────────────────────────────────────────────────
  const upperArm = armLen * 0.52
  const foreArm = armLen * 0.48

  for (const side of [-1, 1]) {
    const suffix = side < 0 ? 'L' : 'R'
    const shoulder = joint(
      `arm${suffix}`,
      spine,
      { x: side * (torsoW / 2 + armThick * 0.3), y: torsoH * 0.82, z: 0 },
      rest(-0.08, 0, side * 0.14),
    )
    part(
      `upperArm${suffix}`,
      shoulder,
      limbBox({
        near: [armThick, armThick],
        far: [armThick * 0.86, armThick * 0.86],
        length: upperArm,
        colors: body,
      }),
    )

    const elbow = joint(`forearm${suffix}`, shoulder, { x: 0, y: -upperArm, z: 0 }, rest(0.18))
    part(
      `foreArm${suffix}`,
      elbow,
      limbBox({
        near: [armThick * 0.86, armThick * 0.86],
        far: [armThick * 0.72, armThick * 0.72],
        length: foreArm,
        colors: body,
      }),
    )
    part(
      `hand${suffix}`,
      elbow,
      taperedBox({
        bottom: [armThick * 1.15, armThick * 1.25],
        top: [armThick * 1.05, armThick * 1.1],
        height: armThick * 0.9,
        colors: [accent, body, body, body, body, accent],
      }),
      { x: 0, y: -foreArm - armThick * 0.9, z: 0 },
    )
  }

  // ─── legs ─────────────────────────────────────────────────────────────────
  const thighLen = legLen * 0.52
  const shinLen = legLen * 0.4
  const footHeight = Math.max(0.05, legThick * 0.42)
  const digitigrade = spec.legs.type === 'digitigrade'

  for (const side of [-1, 1]) {
    const suffix = side < 0 ? 'L' : 'R'
    const hipJoint = joint(
      `thigh${suffix}`,
      hip,
      { x: side * legThick * 1.05, y: 0, z: 0 },
      rest(digitigrade ? 0.52 : 0.04),
    )
    part(
      `thigh${suffix}Mesh`,
      hipJoint,
      limbBox({
        near: [legThick * 1.2, legThick * 1.2],
        far: [legThick * 0.95, legThick * 0.95],
        length: thighLen,
        colors: body,
      }),
    )

    const knee = joint(`shin${suffix}`, hipJoint, { x: 0, y: -thighLen, z: 0 }, rest(digitigrade ? -1.0 : -0.08))
    part(
      `shin${suffix}Mesh`,
      knee,
      limbBox({
        near: [legThick * 0.95, legThick * 0.95],
        far: [legThick * 0.78, legThick * 0.78],
        length: shinLen,
        colors: body,
      }),
    )

    const ankle = joint(`foot${suffix}`, knee, { x: 0, y: -shinLen, z: 0 }, rest(digitigrade ? 0.48 : 0.04))
    part(
      `foot${suffix}Mesh`,
      ankle,
      forwardBox({
        base: [legThick * 1.15, footHeight],
        tip: [legThick, footHeight * 0.8],
        length: legThick * 2.1,
        colors: [body, body, body, body, accent, body],
      }),
      { x: 0, y: -footHeight / 2, z: -legThick * 0.4 },
    )
  }

  // ─── tail ─────────────────────────────────────────────────────────────────
  const segments = TAIL_SEGMENTS[spec.tail.type]
  const segmentLength = (0.1 + torsoD * 0.42) * (segments > 1 ? 1 : 0.8)
  let tailParent: THREE.Object3D = spine
  let tailAt = { x: 0, y: torsoH * 0.2, z: -torsoD / 2 + 0.01 }

  for (let index = 0; index < segments; index++) {
    const taper = (step: number) => torsoW * 0.4 * (1 - (index + step) / (segments + 0.9))
    const node = joint(`tail${index}`, tailParent, tailAt, rest(index === 0 ? 0.3 : -0.2))
    part(
      `tail${index}Mesh`,
      node,
      backwardBox({
        base: [taper(0), taper(0)],
        tip: [taper(1), taper(1)],
        length: segmentLength,
        colors: [body, body, body, body, body, belly],
      }),
    )
    tailParent = node
    tailAt = { x: 0, y: 0, z: -segmentLength }
  }

  // ─── settle on the ground ─────────────────────────────────────────────────
  root.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(root)
  if (Number.isFinite(bounds.min.y)) root.position.y = -bounds.min.y
  root.updateMatrixWorld(true)

  let triangleCount = 0
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    triangleCount += mesh.geometry.getAttribute('position').count / 3
  })

  return {
    root,
    joints,
    rest: restMap,
    material,
    triangleCount,
    dispose() {
      for (const geometry of geometries) geometry.dispose()
      material.dispose()
    },
  }
}
