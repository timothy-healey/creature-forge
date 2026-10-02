import * as THREE from 'three'
import { hangDown, pointBackward, pointForward, prism } from './geometry'
import { type RestMap, type RestPose, rest } from './joints'
import { type CreatureSpec, clampSpec } from './spec'

/**
 * Turns a spec into a tree of rigid parts.
 *
 * There is no skeleton and no vertex skinning. Each part is its own mesh,
 * parented to the joint it swings from, and animating means rotating those
 * nodes. That is how characters of this era were actually built — the seams at
 * the joints are the look, not a compromise.
 *
 * Every part is a prism of stacked cross-sections. Limbs taper through a muscle
 * bulge rather than running straight, skulls are wedges, and horns, beaks and
 * tails end in a real point, so the silhouette is faceted rather than boxy.
 */

export interface Creature {
  root: THREE.Group
  joints: Record<string, THREE.Object3D>
  rest: RestMap
  material: THREE.Material
  triangleCount: number
  dispose(): void
}

/** Cross-section counts, part by part. Lower is sharper and more angular. */
const SIDES = {
  torso: 6,
  neck: 5,
  skull: 6,
  snout: 5,
  beak: 4,
  muzzle: 6,
  horn: 5,
  limb: 5,
  foot: 5,
  tail: 5,
  eye: 4,
} as const

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

  function part(
    name: string,
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    at?: THREE.Vector3Like,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    if (at) mesh.position.set(at.x, at.y, at.z)
    parent.add(mesh)
    geometries.push(geometry)
    return mesh
  }

  /** A limb segment: thin at the far end, bulging mid-way, square at the joint. */
  function limb(length: number, near: number, bulge: number, far: number): THREE.BufferGeometry {
    return hangDown(
      prism({
        sides: SIDES.limb,
        sections: [
          { y: 0, rx: far, rz: far },
          { y: length * 0.55, rx: bulge, rz: bulge * 0.94, yaw: 0.16 },
          { y: length, rx: near, rz: near },
        ],
        colors: { side: body },
      }),
    )
  }

  // ─── spine ────────────────────────────────────────────────────────────────
  const hip = joint('hip', root, { x: 0, y: legLen, z: 0 }, rest())
  const spine = joint('spine', hip, { x: 0, y: 0, z: 0 }, rest())

  part(
    'torso',
    spine,
    prism({
      sides: SIDES.torso,
      sections: [
        { y: 0, rx: torsoW * 0.4, rz: torsoD * 0.42 },
        { y: torsoH * 0.32, rx: torsoW * 0.46, rz: torsoD * 0.47, yaw: 0.08 },
        { y: torsoH * 0.74, rx: torsoW * 0.5, rz: torsoD * 0.5, dz: torsoD * 0.02 },
        { y: torsoH, rx: torsoW * 0.4, rz: torsoD * 0.4 },
      ],
      colors: { side: body, belly, cap: belly },
      bellyWidth: 0.95,
    }),
  )

  part(
    'neck',
    spine,
    prism({
      sides: SIDES.neck,
      sections: [
        { y: 0, rx: torsoW * 0.22, rz: torsoD * 0.23 },
        { y: neckLen, rx: torsoW * 0.18, rz: torsoD * 0.2, dz: torsoD * 0.03 },
      ],
      colors: { side: body, belly },
    }),
    { x: 0, y: torsoH, z: 0 },
  )

  // ─── head ─────────────────────────────────────────────────────────────────
  const head = joint('head', spine, { x: 0, y: torsoH + neckLen, z: 0 }, rest())

  part(
    'skull',
    head,
    prism({
      sides: SIDES.skull,
      sections: [
        { y: 0, rx: headW * 0.37, rz: headD * 0.39 },
        { y: headH * 0.46, rx: headW * 0.5, rz: headD * 0.5, dz: headD * 0.04 },
        { y: headH, rx: headW * 0.38, rz: headD * 0.36, dz: -headD * 0.03 },
      ],
      colors: { side: body, belly, cap: body },
      bellyWidth: 0.6,
    }),
  )

  buildFace(head, spec.head.type)
  buildEyes(head)
  buildHorns(head, spec.head.horns)

  function buildFace(parent: THREE.Object3D, type: CreatureSpec['head']['type']): void {
    const front = headD * 0.34

    if (type === 'snout') {
      part(
        'snout',
        parent,
        pointForward(
          prism({
            sides: SIDES.snout,
            sections: [
              { y: 0, rx: headW * 0.34, rz: headH * 0.28 },
              { y: headLen * 0.55, rx: headW * 0.28, rz: headH * 0.21, dz: headH * 0.04 },
              { y: headLen, rx: headW * 0.2, rz: headH * 0.15, dz: headH * 0.08 },
            ],
            colors: { side: body, belly, cap: belly },
          }),
        ),
        { x: 0, y: headH * 0.38, z: front },
      )
      return
    }

    if (type === 'beak') {
      part(
        'beak',
        parent,
        pointForward(
          prism({
            sides: SIDES.beak,
            sections: [
              { y: 0, rx: headW * 0.27, rz: headH * 0.23 },
              { y: headLen * 0.5, rx: headW * 0.17, rz: headH * 0.12, dz: headH * 0.08 },
              { y: headLen * 1.3, rx: 0, rz: 0, dz: headH * 0.16 },
            ],
            colors: { side: accent },
            tip: 'top',
          }),
        ),
        { x: 0, y: headH * 0.46, z: front },
      )
      return
    }

    part(
      'muzzle',
      parent,
      pointForward(
        prism({
          sides: SIDES.muzzle,
          sections: [
            { y: 0, rx: headW * 0.42, rz: headH * 0.32 },
            { y: headLen * 0.52, rx: headW * 0.38, rz: headH * 0.26, dz: headH * 0.04 },
          ],
          colors: { side: body, belly, cap: belly },
        }),
      ),
      { x: 0, y: headH * 0.32, z: front },
    )
  }

  function buildEyes(parent: THREE.Object3D): void {
    const size = Math.max(0.03, headW * 0.11)
    for (const side of [-1, 1]) {
      part(
        side < 0 ? 'eyeL' : 'eyeR',
        parent,
        pointForward(
          prism({
            sides: SIDES.eye,
            sections: [
              { y: 0, rx: size, rz: size * 0.72 },
              { y: size * 0.9, rx: size * 0.72, rz: size * 0.5 },
            ],
            colors: { side: eye },
          }),
        ),
        { x: side * headW * 0.27, y: headH * 0.6, z: headD * 0.38 },
      )
    }
  }

  function buildHorns(parent: THREE.Object3D, count: number): void {
    if (count === 0) return
    const length = 0.12 + headW * 0.45
    const thickness = headW * 0.1
    const offsets = count === 1 ? [0] : [-headW * 0.26, headW * 0.26]

    offsets.forEach((x, index) => {
      const mesh = part(
        `horn${index}`,
        parent,
        prism({
          sides: SIDES.horn,
          sections: [
            { y: 0, rx: thickness, rz: thickness },
            { y: length * 0.42, rx: thickness * 0.62, rz: thickness * 0.62, yaw: 0.3 },
            { y: length, rx: 0, rz: 0 },
          ],
          colors: { side: accent },
          tip: 'top',
        }),
        { x, y: headH * 0.88, z: -headD * 0.06 },
      )
      mesh.rotation.x = -0.45
      mesh.rotation.z = -x * 1.6
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
      { x: side * (torsoW * 0.46), y: torsoH * 0.8, z: 0 },
      rest(-0.08, 0, side * 0.16),
    )
    part(
      `upperArm${suffix}`,
      shoulder,
      limb(upperArm, armThick * 0.56, armThick * 0.6, armThick * 0.42),
    )

    const elbow = joint(`forearm${suffix}`, shoulder, { x: 0, y: -upperArm, z: 0 }, rest(0.2))
    part(`foreArm${suffix}`, elbow, limb(foreArm, armThick * 0.44, armThick * 0.46, armThick * 0.34))

    part(
      `hand${suffix}`,
      elbow,
      hangDown(
        prism({
          sides: SIDES.limb,
          sections: [
            { y: 0, rx: armThick * 0.5, rz: armThick * 0.56 },
            { y: armThick * 0.85, rx: armThick * 0.42, rz: armThick * 0.46 },
          ],
          colors: { side: accent },
        }),
      ),
      { x: 0, y: -foreArm, z: 0 },
    )
  }

  // ─── legs ─────────────────────────────────────────────────────────────────
  const thighLen = legLen * 0.52
  const shinLen = legLen * 0.4
  const footHeight = Math.max(0.05, legThick * 0.42)
  const footLen = legThick * 2.2
  const digitigrade = spec.legs.type === 'digitigrade'

  for (const side of [-1, 1]) {
    const suffix = side < 0 ? 'L' : 'R'
    const hipJoint = joint(
      `thigh${suffix}`,
      hip,
      { x: side * legThick * 1.05, y: 0, z: 0 },
      rest(digitigrade ? 0.52 : 0.04),
    )
    part(`thigh${suffix}Mesh`, hipJoint, limb(thighLen, legThick * 0.58, legThick * 0.64, legThick * 0.44))

    const knee = joint(`shin${suffix}`, hipJoint, { x: 0, y: -thighLen, z: 0 }, rest(digitigrade ? -1.0 : -0.08))
    part(`shin${suffix}Mesh`, knee, limb(shinLen, legThick * 0.46, legThick * 0.5, legThick * 0.34))

    const ankle = joint(`foot${suffix}`, knee, { x: 0, y: -shinLen, z: 0 }, rest(digitigrade ? 0.48 : 0.04))
    part(
      `foot${suffix}Mesh`,
      ankle,
      pointForward(
        prism({
          sides: SIDES.foot,
          sections: [
            { y: 0, rx: legThick * 0.52, rz: footHeight * 0.5 },
            { y: footLen * 0.68, rx: legThick * 0.5, rz: footHeight * 0.44, dz: -footHeight * 0.08 },
            { y: footLen, rx: legThick * 0.34, rz: footHeight * 0.26, dz: -footHeight * 0.2 },
          ],
          colors: { side: body, cap: accent },
        }),
      ),
      { x: 0, y: -footHeight * 0.5, z: -legThick * 0.45 },
    )
  }

  // ─── tail ─────────────────────────────────────────────────────────────────
  const segments = TAIL_SEGMENTS[spec.tail.type]
  const segmentLength = (0.1 + torsoD * 0.42) * (segments > 1 ? 1 : 0.8)
  let tailParent: THREE.Object3D = spine
  let tailAt = { x: 0, y: torsoH * 0.22, z: -torsoD * 0.38 }

  for (let index = 0; index < segments; index++) {
    const taper = (step: number) => torsoW * 0.2 * (1 - (index + step) / (segments + 0.9))
    const isLast = index === segments - 1
    const node = joint(`tail${index}`, tailParent, tailAt, rest(index === 0 ? 0.3 : -0.2))

    part(
      `tail${index}Mesh`,
      node,
      pointBackward(
        prism({
          sides: SIDES.tail,
          sections: [
            { y: 0, rx: taper(0), rz: taper(0) },
            { y: segmentLength * 0.5, rx: taper(0.5), rz: taper(0.5), yaw: 0.2 },
            { y: segmentLength, rx: isLast ? 0 : taper(1), rz: isLast ? 0 : taper(1) },
          ],
          colors: { side: body, belly, cap: body },
          ...(isLast ? { tip: 'top' as const } : {}),
        }),
      ),
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
