import * as THREE from 'three'
import { mirrorX, resolutionFor } from './geometry'
import { type RestMap, type RestPose, rest } from './joints'
import * as parts from './parts'
import { deform, type DeformPart } from './mutate'
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
const TAU = Math.PI * 2

/**
 * The first four limbs of a ring borrow the canonical joint names, so a gait
 * drives them without knowing it is looking at a radial creature. Opposite
 * names land opposite each other in the ring, which is what makes the walk read
 * as a wave rather than a twitch.
 */
const RADIAL_NAMES: readonly (readonly [string, string, string])[] = [
  ['backUpperL', 'backLowerL', 'backFootL'],
  ['frontUpperL', 'frontLowerL', 'frontFootL'],
  ['backUpperR', 'backLowerR', 'backFootR'],
  ['frontUpperR', 'frontLowerR', 'frontFootR'],
]

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function generate(input: CreatureSpec): Creature {
  const spec = clampSpec(input)
  const res = resolutionFor(spec.detail.level, spec.shape.edge)
  const radial = spec.body.mutation === 'radial'
  const segmented = spec.body.mutation === 'segmented'
  // A ring of limbs has no front to lean into; a chain of them only works flat.
  const pitch = radial ? 0 : segmented ? 1.36 : PITCH[spec.body.build]
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
  // A strut creature has no surface: the armature is the whole of it, so the
  // body parts are built for their transforms and never given geometry.
  const strut = spec.body.mutation === 'strut'
  let armature = false

  const root = new THREE.Group()
  root.name = 'creature'
  const joints: Record<string, THREE.Object3D> = {}
  const restMap: RestMap = {}
  const geometries: THREE.BufferGeometry[] = []
  const bones: THREE.Bone[] = []
  const pieces: SkinPiece[] = []
  const deformable: DeformPart[] = []
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

  /** The joint a node hangs from, skipping any plain nodes in between. */
  function parentJoint(node: THREE.Object3D): THREE.Object3D | null {
    let current = node.parent
    while (current) {
      if (current.name && joints[current.name] === current) return current
      current = current.parent
    }
    return null
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
    if (strut && !armature) {
      placed.geometry.dispose()
      return holder
    }
    geometries.push(placed.geometry)
    deformable.push({ geometry: placed.geometry, node: holder })

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

  const beadCount = spec.torso.segments + 2
  const beadLength = dims.spineLength / beadCount
  const chain: THREE.Object3D[] = []

  if (segmented) {
    // One torso gives way to a chain of body units, each a joint of its own and
    // each carrying its own pair of limbs. The topology is different, not the
    // part list: nothing has been added, the body has been cut up.
    let previous: THREE.Object3D = spine
    for (let index = 0; index < beadCount; index++) {
      const node = joint(
        `body${index}`,
        previous,
        { x: 0, y: index === 0 ? 0 : beadLength, z: 0 },
        rest(0, (index % 2 === 0 ? 1 : -1) * 0.1),
      )
      attach(node, parts.segment(forge, spec.torso.segments, index, beadCount, beadLength))
      chain.push(node)
      previous = node
    }
  } else {
    attach(spine, parts.torso(forge, spec.torso.segments))
  }

  // ─── limbs ────────────────────────────────────────────────────────────────
  const thighLen = legLen * 0.52
  const shinLen = legLen * 0.4

  /** One upper → lower → foot chain. Bilateral pairs and radial rings share it. */
  function limbChain(options: {
    names: readonly [string, string, string]
    parent: THREE.Object3D
    at: THREE.Vector3Like
    pose: RestPose
    upperLen: number
    lowerLen: number
    thickness: number
    bend: readonly [number, number]
    ending: 'foot' | 'hand'
    footScale?: number
  }): THREE.Object3D {
    const [upperName, lowerName, footName] = options.names
    const upper = joint(upperName, options.parent, options.at, options.pose)
    mesh(
      `${upperName}Mesh`,
      upper,
      parts.limb(
        forge,
        options.upperLen,
        options.thickness * 0.58,
        options.thickness * 0.64,
        options.thickness * 0.44,
      ),
    )

    const lower = joint(lowerName, upper, { x: 0, y: -options.upperLen, z: 0 }, rest(options.bend[0]))
    mesh(
      `${lowerName}Mesh`,
      lower,
      parts.limb(
        forge,
        options.lowerLen,
        options.thickness * 0.46,
        options.thickness * 0.5,
        options.thickness * 0.34,
      ),
    )

    const end = joint(footName, lower, { x: 0, y: -options.lowerLen, z: 0 }, rest(options.bend[1]))
    if (options.ending === 'foot') {
      const height = footHeight * (options.footScale ?? 1)
      mesh(`${footName}Mesh`, end, parts.foot(forge, height), {
        x: 0,
        y: -height * 0.5,
        z: -dims.legThick * 0.45,
      })
    } else {
      mesh(`${footName}Mesh`, end, parts.hand(forge, options.thickness))
    }

    return upper
  }

  if (radial) {
    // Bilateral pairs give way to one ring of identical limbs around the spine.
    // Nothing is added or removed — the symmetry group itself is different.
    const count = 4 + (spec.torso.segments - 2)
    const ring = dims.torsoW * 0.52 * shape.wide

    for (let index = 0; index < count; index++) {
      const angle = (TAU * index) / count
      const names = RADIAL_NAMES[index] ?? ([
        `radialUpper${index}`,
        `radialLower${index}`,
        `radialFoot${index}`,
      ] as const)

      // A limb points straight down the Y axis, so turning it about Y does
      // nothing. The socket does the turning, and the limb then splays and
      // bends in its own frame — outward from the axis rather than forward.
      const socket = new THREE.Object3D()
      socket.position.set(Math.cos(angle) * ring, 0, Math.sin(angle) * ring)
      socket.rotation.y = Math.PI / 2 - angle
      hip.add(socket)

      limbChain({
        names,
        parent: socket,
        at: { x: 0, y: 0, z: 0 },
        pose: rest(-0.34),
        upperLen: thighLen,
        lowerLen: shinLen,
        thickness: dims.legThick,
        bend: [0.62, -0.26],
        ending: 'foot',
      })
    }
  } else if (segmented) {
    root.updateMatrixWorld(true)
    const perch = new THREE.Vector3()

    chain.forEach((bead, index) => {
      const group = index === 0 ? 'back' : index === 1 ? 'front' : `seg${index}`
      const height = bead.getWorldPosition(perch).y
      const span = Math.max(0.08, height - footHeight)

      for (const side of [-1, 1]) {
        const suffix = side < 0 ? 'L' : 'R'
        limbChain({
          names: [`${group}Upper${suffix}`, `${group}Lower${suffix}`, `${group}Foot${suffix}`],
          parent: bead,
          at: { x: side * dims.torsoW * 0.4 * shape.wide, y: beadLength * 0.4, z: 0 },
          // Counter-rotated against the pitch so a limb hangs down, not back.
          pose: rest(-pitch, 0, side * 0.12),
          upperLen: span * 0.52,
          lowerLen: span * 0.48,
          thickness: dims.legThick * 0.8,
          bend: [0.3, -0.12],
          ending: 'foot',
          footScale: 0.8,
        })
      }
    })
  } else {
    for (const side of [-1, 1]) {
      const suffix = side < 0 ? 'L' : 'R'
      limbChain({
        names: [`backUpper${suffix}`, `backLower${suffix}`, `backFoot${suffix}`],
        parent: hip,
        at: { x: side * dims.legThick * 1.05, y: 0, z: 0 },
        pose: rest(digitigrade ? 0.52 : 0.04),
        upperLen: thighLen,
        lowerLen: shinLen,
        thickness: dims.legThick,
        bend: [digitigrade ? -1.0 : -0.08, digitigrade ? 0.48 : 0.04],
        ending: 'foot',
      })
    }
  }

  // ─── front limbs, sized against the floor the hind feet stand on ──────────
  if (!radial && !segmented) {
    const shoulderPoses = [-1, 1].map((side) =>
      planted ? rest(-pitch, 0, side * 0.06) : rest(-0.08 - pitch * 0.3, 0, side * 0.16),
    )
    const probes = [-1, 1].map((side, index) =>
      joint(
        `frontUpper${side < 0 ? 'L' : 'R'}`,
        spine,
        { x: side * torsoW * 0.46, y: dims.spineLength * SHOULDER_ALONG, z: 0 },
        shoulderPoses[index]!,
      ),
    )

    root.updateMatrixWorld(true)
    const standing = new THREE.Box3()
    for (const suffix of ['L', 'R']) standing.expandByObject(joints[`backFoot${suffix}`]!)
    // With no geometry to measure — a strut creature has none yet — the ankle
    // joint itself is where the floor is.
    const ground = Number.isFinite(standing.min.y)
      ? standing.min.y
      : Math.min(...['L', 'R'].map((s) => joints[`backFoot${s}`]!.getWorldPosition(new THREE.Vector3()).y))
    const shoulderHeight = probes[0]!.getWorldPosition(new THREE.Vector3()).y

    // A foreleg is as long as the gap between its shoulder and the floor.
    const frontLen = planted ? Math.max(0.08, shoulderHeight - ground - footHeight) : armLen
    const frontThick = planted ? dims.legThick * 0.92 : dims.armThick

    for (const probe of probes) spine.remove(probe)

    ;[-1, 1].forEach((side, index) => {
      const suffix = side < 0 ? 'L' : 'R'
      limbChain({
        names: [`frontUpper${suffix}`, `frontLower${suffix}`, `frontFoot${suffix}`],
        parent: spine,
        at: { x: side * torsoW * 0.46, y: dims.spineLength * SHOULDER_ALONG, z: 0 },
        pose: shoulderPoses[index]!,
        upperLen: frontLen * 0.52,
        lowerLen: frontLen * 0.48,
        thickness: frontThick,
        bend: [planted ? 0.12 : 0.2, planted ? 0.04 : 0],
        ending: planted ? 'foot' : 'hand',
        footScale: 0.85,
      })
    })
  }

  // ─── neck and head, counter-rotated against the pitch ─────────────────────
  const neckParent = segmented ? chain[chain.length - 1]! : spine
  const neckAt = { x: 0, y: segmented ? beadLength : dims.spineLength, z: 0 }
  const neck = joint('neck', neckParent, neckAt, rest(-pitch * 0.5))
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
  const segments = radial ? 0 : TAIL_SEGMENTS[spec.tail.type]
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

  // ─── the armature, when that is all there is ──────────────────────────────
  if (strut) {
    armature = true
    root.updateMatrixWorld(true)
    const up = new THREE.Vector3(0, 1, 0)
    const bar = dims.legThick * 0.34
    const here = new THREE.Vector3()
    const there = new THREE.Vector3()

    for (const [name, node] of Object.entries(joints)) {
      const above = parentJoint(node)
      if (above) {
        node.getWorldPosition(here)
        above.worldToLocal(here)
        const reach = here.length()
        if (reach > 1e-4) {
          const holder = attach(above, { name: `strut_${name}`, geometry: parts.strut(forge, reach, bar) })
          holder.quaternion.setFromUnitVectors(up, there.copy(here).normalize())
        }
      }

      const radius = name === 'head' ? dims.headW * 0.42 : name === 'hip' ? bar * 2.4 : bar * 1.7
      attach(node, {
        name: `knuckle_${name}`,
        geometry: parts.knuckle(forge, radius, name.includes('Foot')),
      })
    }
  }

  // ─── deform, before anything is welded, so it composes with both modes ───
  if (spec.body.mutation === 'shattered' || spec.body.mutation === 'melted') {
    root.updateMatrixWorld(true)
    const standing = new THREE.Box3().setFromObject(root)
    deform(spec.body.mutation, deformable, {
      scale: dims.torsoW,
      ground: Number.isFinite(standing.min.y) ? standing.min.y : 0,
    })
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
