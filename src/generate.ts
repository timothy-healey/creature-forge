import * as THREE from 'three'
import { mirrorX, resolutionFor } from './geometry'
import { type RestMap, type RestPose, rest } from './joints'
import * as parts from './parts'
import { buildSkin, type SkinPiece } from './skin'
import { type CreatureSpec, clampSpec } from './spec'

/**
 * Turns a spec into a tree of rigid parts.
 *
 * There is no skeleton and no vertex skinning. Each part is its own mesh,
 * parented to the joint it swings from, and animating means rotating those
 * nodes. That is how characters of this era were actually built — the seams at
 * the joints are the look, not a compromise.
 *
 * The spine's pitch is the whole body plan. At zero it is an upright biped; at
 * 1.3 radians it is a quadruped with its back level, and the neck and head
 * counter-rotate so the creature still looks where it is going. Front limbs are
 * either arms, which hang free at whatever length the slider says, or forelegs,
 * whose length is solved so the foot reaches the same ground the hind feet
 * stand on.
 */

export interface Creature {
  root: THREE.Group
  joints: Record<string, THREE.Object3D>
  rest: RestMap
  material: THREE.Material
  triangleCount: number
  dispose(): void
}

/** Spine pitch, in radians, per build. This is what makes a quadruped. */
const PITCH: Record<CreatureSpec['body']['build'], number> = {
  upright: 0,
  hunched: 0.62,
  quadruped: 1.3,
}

const TAIL_SEGMENTS: Record<CreatureSpec['tail']['type'], number> = {
  none: 0,
  stub: 1,
  long: 3,
  club: 3,
  fan: 3,
}

const SHOULDER_ALONG = 0.82

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function generate(input: CreatureSpec): Creature {
  const spec = clampSpec(input)
  const res = resolutionFor(spec.detail.level, spec.shape.edge)
  const pitch = PITCH[spec.body.build]
  const planted = spec.body.frontLimb === 'forelegs'

  const palette: parts.Palette = {
    body: new THREE.Color(spec.colors.body),
    belly: new THREE.Color(spec.colors.belly),
    accent: new THREE.Color(spec.colors.accent),
    eye: new THREE.Color(spec.colors.eye),
  }

  const torsoW = lerp(0.26, 0.58, spec.torso.width)
  const torsoD = lerp(0.2, 0.48, spec.torso.depth)
  const dims: parts.Dims = {
    torsoW,
    torsoD,
    spineLength: lerp(0.34, 0.74, spec.torso.height) * (0.62 + spec.torso.segments * 0.17),
    neckLen: lerp(0.04, 0.52, spec.neck.length),
    headW: lerp(0.19, 0.44, spec.head.width),
    headH: 0,
    headD: 0,
    headLen: lerp(0.14, 0.44, spec.head.length),
    legThick: lerp(0.07, 0.21, spec.legs.thickness),
    armThick: lerp(0.055, 0.17, spec.arms.thickness),
  }
  dims.headH = dims.headW * 0.82
  dims.headD = dims.headW * 0.86

  // The three genes, resolved. `edge` runs a faceted diamond cross-section up to
  // a slabby one; `section` trades depth for width; `bulk` moves where the mass
  // along every part sits. They reshape a creature rather than resizing it.
  const shape: parts.Shape = {
    power: lerp(2.8, 1.02, spec.shape.edge),
    wide: lerp(0.74, 1.36, spec.shape.section),
    deep: lerp(1.48, 0.66, spec.shape.section),
    bulk: spec.shape.bulk,
  }

  const legLen = lerp(0.28, 0.86, spec.legs.length)
  const armLen = lerp(0.24, 0.68, spec.arms.length)
  const footHeight = Math.max(0.05, dims.legThick * 0.42)
  const digitigrade = spec.legs.type === 'digitigrade'

  const bound = spec.body.mesh === 'skinned'

  const root = new THREE.Group()
  root.name = 'creature'
  const joints: Record<string, THREE.Object3D> = {}
  const restMap: RestMap = {}
  const geometries: THREE.BufferGeometry[] = []
  const bones: THREE.Bone[] = []
  const pieces: SkinPiece[] = []
  // A welded skin shades smoothly; a stack of rigid parts is faceted on purpose.
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: !bound })
  // Bound limbs push up into their parent so the two surfaces weld instead of abutting.
  const forge: parts.Forge = { dims, palette, res, shape, embed: bound ? 0.55 : 0 }

  function joint(name: string, parent: THREE.Object3D, at: THREE.Vector3Like, pose: RestPose): THREE.Object3D {
    const node = bound ? new THREE.Bone() : new THREE.Group()
    node.name = name
    node.position.set(at.x, at.y, at.z)
    node.rotation.set(pose.rx, pose.ry, pose.rz)
    parent.add(node)
    joints[name] = node
    restMap[name] = { ...pose, y: node.position.y }
    if (bound) bones.push(node as THREE.Bone)
    return node
  }

  /** The bone a part belongs to: the nearest one at or above where it hangs. */
  function ownerOf(node: THREE.Object3D): THREE.Bone {
    let current: THREE.Object3D | null = node
    while (current) {
      if ((current as THREE.Bone).isBone) return current as THREE.Bone
      current = current.parent
    }
    return bones[0]!
  }

  function attach(parent: THREE.Object3D, placed: parts.Placed): THREE.Object3D {
    const holder = new THREE.Object3D()
    if (placed.position) holder.position.set(placed.position.x, placed.position.y, placed.position.z)
    if (placed.rotation) holder.rotation.set(placed.rotation.x, placed.rotation.y, placed.rotation.z)
    parent.add(holder)
    geometries.push(placed.geometry)

    if (bound) {
      pieces.push({ geometry: placed.geometry, node: holder, bone: ownerOf(parent) })
      return holder
    }

    const mesh = new THREE.Mesh(placed.geometry, material)
    mesh.name = placed.name
    holder.add(mesh)
    return holder
  }

  const mesh = (name: string, parent: THREE.Object3D, geometry: THREE.BufferGeometry, at?: THREE.Vector3Like) =>
    attach(parent, { name, geometry, ...(at ? { position: at } : {}) })

  /**
   * Reflects a part for the other side of the body. Mirroring the geometry is
   * not enough on its own: a part placed off-axis or swung by a rotation has to
   * have that offset and that swing reflected too, or it points back across the
   * midline and into the torso.
   */
  function mirrored(placed: parts.Placed): parts.Placed {
    return {
      ...placed,
      geometry: mirrorX(placed.geometry),
      ...(placed.position ? { position: { ...placed.position, x: -placed.position.x } } : {}),
      ...(placed.rotation
        ? { rotation: { x: placed.rotation.x, y: -placed.rotation.y, z: -placed.rotation.z } }
        : {}),
    }
  }

  // ─── spine, pitched by build ──────────────────────────────────────────────
  const hip = joint('hip', root, { x: 0, y: legLen, z: 0 }, rest())
  const spine = joint('spine', hip, { x: 0, y: 0, z: 0 }, rest(pitch))

  attach(spine, parts.torso(forge, spec.torso.segments))

  // ─── back legs ────────────────────────────────────────────────────────────
  const thighLen = legLen * 0.52
  const shinLen = legLen * 0.4

  for (const side of [-1, 1]) {
    const suffix = side < 0 ? 'L' : 'R'
    const upper = joint(
      `backUpper${suffix}`,
      hip,
      { x: side * dims.legThick * 1.05, y: 0, z: 0 },
      rest(digitigrade ? 0.52 : 0.04),
    )
    mesh(
      `backThigh${suffix}`,
      upper,
      parts.limb(forge, thighLen, dims.legThick * 0.58, dims.legThick * 0.64, dims.legThick * 0.44),
    )

    const lower = joint(`backLower${suffix}`, upper, { x: 0, y: -thighLen, z: 0 }, rest(digitigrade ? -1.0 : -0.08))
    mesh(
      `backShin${suffix}`,
      lower,
      parts.limb(forge, shinLen, dims.legThick * 0.46, dims.legThick * 0.5, dims.legThick * 0.34),
    )

    const ankle = joint(`backFoot${suffix}`, lower, { x: 0, y: -shinLen, z: 0 }, rest(digitigrade ? 0.48 : 0.04))
    mesh(`backFoot${suffix}Mesh`, ankle, parts.foot(forge, footHeight), {
      x: 0,
      y: -footHeight * 0.5,
      z: -dims.legThick * 0.45,
    })
  }

  // ─── shoulders, placed before their limbs are sized ───────────────────────
  const shoulders = [-1, 1].map((side) =>
    joint(
      `frontUpper${side < 0 ? 'L' : 'R'}`,
      spine,
      { x: side * torsoW * 0.46, y: dims.spineLength * SHOULDER_ALONG, z: 0 },
      planted ? rest(-pitch, 0, side * 0.06) : rest(-0.08 - pitch * 0.3, 0, side * 0.16),
    ),
  )

  root.updateMatrixWorld(true)
  const standing = new THREE.Box3()
  for (const suffix of ['L', 'R']) standing.expandByObject(joints[`backFoot${suffix}`]!)
  const ground = Number.isFinite(standing.min.y) ? standing.min.y : 0
  const shoulderHeight = shoulders[0]!.getWorldPosition(new THREE.Vector3()).y

  // A foreleg is as long as the gap between its shoulder and the floor.
  const frontLen = planted ? Math.max(0.08, shoulderHeight - ground - footHeight) : armLen
  const frontUpperLen = frontLen * 0.52
  const frontLowerLen = frontLen * 0.48
  const frontThick = planted ? dims.legThick * 0.92 : dims.armThick

  shoulders.forEach((shoulder, index) => {
    const suffix = index === 0 ? 'L' : 'R'
    mesh(
      `frontUpper${suffix}Mesh`,
      shoulder,
      parts.limb(forge, frontUpperLen, frontThick * 0.56, frontThick * 0.6, frontThick * 0.44),
    )

    const lower = joint(`frontLower${suffix}`, shoulder, { x: 0, y: -frontUpperLen, z: 0 }, rest(planted ? 0.12 : 0.2))
    mesh(
      `frontLower${suffix}Mesh`,
      lower,
      parts.limb(forge, frontLowerLen, frontThick * 0.46, frontThick * 0.48, frontThick * 0.34),
    )

    const end = joint(`frontFoot${suffix}`, lower, { x: 0, y: -frontLowerLen, z: 0 }, rest(planted ? 0.04 : 0))
    if (planted) {
      mesh(`frontFoot${suffix}Mesh`, end, parts.foot(forge, footHeight * 0.85), {
        x: 0,
        y: -footHeight * 0.42,
        z: -dims.legThick * 0.4,
      })
    } else {
      mesh(`hand${suffix}`, end, parts.hand(forge, frontThick))
    }
  })

  // ─── neck and head, counter-rotated against the pitch ─────────────────────
  const neck = joint('neck', spine, { x: 0, y: dims.spineLength, z: 0 }, rest(-pitch * 0.5))
  attach(neck, parts.neck(forge))

  const head = joint('head', neck, { x: 0, y: dims.neckLen, z: 0 }, rest(-pitch * 0.45))
  attach(head, parts.skull(forge))
  for (const placed of parts.face(forge, spec.head.type)) attach(head, placed)
  for (const placed of parts.eyes(forge)) attach(head, placed)
  for (const placed of parts.horns(forge, spec.head.horns)) attach(head, placed)

  if (spec.head.ears !== 'none') {
    const sweeps: Record<string, readonly [number, number]> = {
      pointed: [-0.25, 0.45],
      long: [0.35, 0.8],
      frill: [0, 1.3],
    }
    const sweep = sweeps[spec.head.ears] ?? ([0, 0.5] as const)
    for (const side of [-1, 1]) {
      const shaped = parts.ear(forge, spec.head.ears)
      if (!shaped) break
      const node = joint(
        side < 0 ? 'earL' : 'earR',
        head,
        { x: side * dims.headW * 0.3, y: dims.headH * 0.7, z: -dims.headD * 0.1 },
        rest(sweep[0], 0, side * sweep[1]),
      )
      attach(node, side < 0 ? mirrored({ ...shaped, name: 'ear' }) : { ...shaped, name: 'ear' })
    }
  }

  // ─── back ridge, following the line of the back ───────────────────────────
  if (spec.back.ridge !== 'none') {
    const profile = parts.torsoProfile(forge, spec.torso.segments)
    const count = res.repeats(spec.torso.segments * 2.2)
    for (let i = 0; i < count; i++) {
      const along = 0.12 + (i / Math.max(1, count - 1)) * 0.82
      const geometry = parts.ridgeElement(forge, spec.back.ridge, along)
      if (geometry) {
        mesh(`ridge${i}`, spine, geometry, { x: 0, y: along * dims.spineLength, z: -profile.rz(along) * 0.82 })
      }
    }
  }

  // ─── wings ────────────────────────────────────────────────────────────────
  if (spec.wings.type !== 'none') {
    for (const side of [-1, 1]) {
      // The wing sits outside the torso's own surface, swept back along the body.
      const node = joint(
        side < 0 ? 'wingL' : 'wingR',
        spine,
        { x: side * torsoW * 0.52 * shape.wide, y: dims.spineLength * 0.66, z: -torsoD * 0.12 },
        rest(-0.18, side * 0.93, side * 0.22),
      )
      for (const placed of parts.wing(forge, spec.wings.type)) {
        attach(node, side < 0 ? mirrored(placed) : placed)
      }
    }
  }

  // ─── tail, hung off the pelvis so the spine's pitch never swings it ───────
  const segments = TAIL_SEGMENTS[spec.tail.type]
  const segmentLength = (0.1 + torsoD * 0.42) * (segments > 1 ? 1 : 0.8)
  const tailLift = { upright: -0.12, hunched: 0.3, quadruped: 0.16 }[spec.body.build]
  let tailParent: THREE.Object3D = hip
  let tailAt: THREE.Vector3Like = { x: 0, y: torsoD * 0.12, z: -torsoD * 0.34 }

  for (let index = 0; index < segments; index++) {
    const taper = (step: number) => torsoW * 0.2 * (1 - (index + step) / (segments + 0.9))
    const isLast = index === segments - 1
    const pointed = isLast && (spec.tail.type === 'long' || spec.tail.type === 'stub')
    const node = joint(`tail${index}`, tailParent, tailAt, rest(index === 0 ? tailLift : -0.16))

    mesh(
      `tail${index}Mesh`,
      node,
      parts.tailSegment(forge, segmentLength, taper(0), taper(1), pointed),
    )

    if (isLast) {
      const tip = parts.tailTip(forge, spec.tail.type, Math.max(0.02, taper(1)))
      if (tip) mesh('tailTip', node, tip, { x: 0, y: 0, z: -segmentLength })
    }

    tailParent = node
    tailAt = { x: 0, y: 0, z: -segmentLength }
  }

  // ─── weld into one skin, if that is the mode ──────────────────────────────
  if (bound) {
    const skin = buildSkin({ root, bones, pieces, material })
    geometries.push(skin.geometry)
  }

  // ─── settle on the ground ─────────────────────────────────────────────────
  root.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(root)
  if (Number.isFinite(bounds.min.y)) root.position.y = -bounds.min.y
  root.updateMatrixWorld(true)

  let triangleCount = 0
  root.traverse((node) => {
    const candidate = node as THREE.Mesh
    if (!candidate.isMesh) return
    const index = candidate.geometry.getIndex()
    triangleCount += (index ? index.count : candidate.geometry.getAttribute('position').count) / 3
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
