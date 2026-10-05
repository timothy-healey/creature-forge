import * as THREE from 'three'
import { mirrorX, resolutionFor } from './geometry'
import { MAX_TAIL, type RestMap, type RestPose, rest } from './joints'
import * as parts from './parts'
import { wrapPhase, type Limb } from './animate'
import { paint } from './pattern'
import { bakeShading } from './shade'
import { DEFORMATIONS, deform, explode, skew, type DeformPart, type Deformation } from './mutate'
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
  /** Every limb the gait can drive, however many bones each one turned out to have. */
  limbs: Limb[]
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

const TAU = Math.PI * 2

/** How far along the foot the ankle sits, from the back of the heel. */
const ANKLE_ALONG_FOOT = 0.44

/**
 * The first four limbs of a ring borrow the canonical joint names, so a gait
 * drives them without knowing it is looking at a radial creature. Opposite
 * names land opposite each other in the ring, which is what makes the walk read
 * as a wave rather than a twitch.
 */
const RADIAL_NAMES: readonly (readonly [string, string])[] = [
  ['back', 'L'],
  ['front', 'L'],
  ['back', 'R'],
  ['front', 'R'],
]

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export function generate(input: CreatureSpec): Creature {
  const spec = clampSpec(input)
  const res = resolutionFor(spec.detail.level, spec.shape.edge, {
    bending: spec.body.mesh === 'skinned',
    dense: DEFORMATIONS.includes(spec.body.mutation as Deformation),
  })
  const radial = spec.body.mutation === 'radial'
  const segmented = spec.body.mutation === 'segmented'
  const coiled = spec.body.mutation === 'coiled'
  // A coiled body is the same chain as a segmented one, bent at every joint and
  // long enough to come round on itself — the curvature is the whole mutation.
  const branching = spec.body.mutation === 'recursive' ? 1 : 0
  // A ring of limbs has no front to lean into; a chain of them only works flat.
  const pitch = radial ? 0 : segmented ? 1.36 : coiled ? 0.3 : PITCH[spec.body.build]
  // A part set to none still gets its joints, so a gait never has to ask
  // whether this creature happens to have arms. Only the geometry goes.
  const armless = spec.body.frontLimb === 'none'
  const legless = spec.legs.type === 'none'

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

  // The two shape genes, resolved. `edge` runs a faceted diamond cross-section
  // up to a slabby one; `section` trades depth for width. They reshape a
  // creature rather than resizing it.
  const shape: parts.Shape = {
    power: lerp(2.8, 1.02, spec.shape.edge),
    wide: lerp(0.74, 1.36, spec.shape.section),
    deep: lerp(1.48, 0.66, spec.shape.section),
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
  const limbs: Limb[] = []
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
  const hip = joint('hip', root, { x: 0, y: legless ? torsoD * 0.42 : legLen, z: 0 }, rest())
  const spine = joint('spine', hip, { x: 0, y: 0, z: 0 }, rest(pitch))

  /**
   * The spine is a chain of beads whatever the creature is, so a body can bend.
   * `segmented` pinches each bead to a waist and hangs limbs off every one;
   * `coiled` runs twice as long and turns a full circle; everything else is the
   * same chain with a gentle curve and no pinch, which is why those two stopped
   * being separate code paths.
   */
  const beadCount = coiled
    ? (spec.torso.segments + 2) * 2
    : segmented
      ? spec.torso.segments + 2
      : Math.max(3, res.repeats(4))
  const beadLength = (dims.spineLength * (coiled ? 1.9 : 1)) / beadCount
  const chain: THREE.Object3D[] = []

  /**
   * An arched spine is a bow, not a hinge.
   *
   * One angle shared equally down the chain integrates into a single large
   * turn: the far end swings right out, and the creature reads as having fallen
   * over rather than as having curved. So most of the bend goes into a term
   * that comes back to nothing by the top of the chain — the back bulges and
   * recovers, the way a swayback or a hunch does — and only a little of it into
   * a net lean. Coiling is the exception that wants the hinge: a full turn, no
   * bow, which is what rolls a body into a spiral.
   */
  const bend = coiled ? 0 : (spec.spine.arch - 0.5) * 2
  const lean = coiled ? -TAU : bend * 0.22
  const bow = bend * 1.9
  const sway = (spec.spine.sway - 0.5) * 2.6

  let previous: THREE.Object3D = spine
  for (let index = 0; index < beadCount; index++) {
    const along = (index + 0.5) / beadCount
    const node = joint(
      `body${index}`,
      previous,
      { x: 0, y: index === 0 ? 0 : beadLength, z: 0 },
      // Sway is a Z rotation, not a Y one: a bead extends along its own +Y, so
      // turning it about Y moves nothing at all. Z is what swings it sideways.
      rest(
        (lean + bow * Math.sin(along * TAU)) / beadCount,
        0,
        (sway * Math.sin(along * TAU) * 2.4) / beadCount,
      ),
    )
    attach(node, parts.segment(forge, spec.torso.segments, index, beadCount, beadLength, segmented ? 1 : 0))
    chain.push(node)
    previous = node
  }

  /** Each bone a little shorter than the one above it, summing to one. */
  function shareOf(bones: number, index: number): number {
    const weights = Array.from({ length: bones }, (_, i) => 1 - i * 0.12)
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    return weights[index]! / total
  }

  /**
   * How far below its socket a limb of a given length actually reaches.
   *
   * A folded leg does not drop by its own length — a digitigrade one loses a
   * third of it to the bend — and once the spine curves, the socket is at an
   * angle too. Rather than solve that in trigonometry, hang a weightless copy
   * of the chain and measure it: every segment scales together, so one
   * measurement gives the ratio for any length.
   */
  function dropPerLength(socket: THREE.Object3D, pose: RestPose, angles: readonly number[]): number {
    const nodes = angles.map((angle, index) => {
      const node = new THREE.Object3D()
      node.rotation.x = angle
      if (index === 0) node.rotation.set(pose.rx, pose.ry, pose.rz)
      else node.position.y = -shareOf(angles.length - 1, index - 1)
      return node
    })

    for (let i = nodes.length - 1; i > 0; i--) nodes[i - 1]!.add(nodes[i]!)
    socket.add(nodes[0]!)
    socket.updateMatrixWorld(true)

    const from = socket.getWorldPosition(new THREE.Vector3()).y
    const to = nodes[nodes.length - 1]!.getWorldPosition(new THREE.Vector3()).y
    socket.remove(nodes[0]!)

    return Math.max(0.05, from - to)
  }

  /** Where a given fraction along the body is, as a bead and a height up it. */
  function alongSpine(fraction: number): { node: THREE.Object3D; y: number } {
    const clamped = Math.min(0.9999, Math.max(0, fraction))
    const index = Math.min(beadCount - 1, Math.floor(clamped * beadCount))
    return { node: chain[index]!, y: (clamped * beadCount - index) * beadLength }
  }

  // ─── limbs ────────────────────────────────────────────────────────────────

  /**
   * One limb, of however many bones it is asked for.
   *
   * The names stay Upper / Lower / Foot at the ends whatever the count, with
   * mids in between, so a chain of five still answers to the joints a gait
   * expects to find. The limb also registers itself, which is how the gait
   * drives it without knowing its shape.
   */
  function limbChain(options: {
    group: string
    /** Which of the pair, appended after the part name: backUpper + L. */
    suffix: string
    parent: THREE.Object3D
    at: THREE.Vector3Like
    pose: RestPose
    length: number
    bones: number
    thickness: number
    bend: readonly [number, number]
    ending: 'foot' | 'hand'
    footScale?: number
    branch?: number
    bare?: boolean
    handed?: number
    phase?: number
  }): THREE.Object3D {
    const bones = Math.max(2, Math.round(options.bones))
    const part = (index: number) =>
      index === 0
        ? 'Upper'
        : index === bones
          ? 'Foot'
          : index === bones - 1
            ? 'Lower'
            : `Mid${index}`
    const names = Array.from({ length: bones + 1 }, (_, index) => `${options.group}${part(index)}${options.suffix}`)

    const sided = (geometry: THREE.BufferGeometry) =>
      (options.handed ?? 1) < 0 ? mirrorX(geometry) : geometry

    let node = joint(names[0]!, options.parent, options.at, options.pose)
    const root = node

    for (let bone = 0; bone < bones; bone++) {
      const length = options.length * shareOf(bones, bone)
      const taper = 1 - bone * 0.12

      if (!options.bare) {
        mesh(
          `${names[bone]!}Mesh`,
          node,
          sided(
            parts.limb(
              forge,
              length,
              options.thickness * 0.58 * taper,
              options.thickness * 0.64 * taper,
              options.thickness * 0.44 * taper,
            ),
          ),
        )
      }

      // Alternating, weaker down the chain, so a long limb folds like an
      // insect's rather than bowing into a hoop.
      const fold =
        bone === bones - 1
          ? options.bend[1]
          : options.bend[0] * (bone % 2 === 0 ? 1 : -0.7) * (1 - bone * 0.15)
      node = joint(names[bone + 1]!, node, { x: 0, y: -length, z: 0 }, rest(fold))
    }

    if (!options.bare) {
      if (options.ending === 'foot') {
        const height = footHeight * (options.footScale ?? 1)
        // The ankle sits a little forward of the middle of the foot, with the
        // heel projecting behind it. Hung from the heel instead, the creature
        // stands on the backs of its feet and reads as leaning away from them.
        mesh(`${options.group}Foot${options.suffix}Mesh`, node, sided(parts.foot(forge, height)), {
          x: 0,
          y: -height * 0.5,
          z: -dims.legThick * ANKLE_ALONG_FOOT * 2.2,
        })
      } else {
        mesh(`${options.group}Foot${options.suffix}Mesh`, node, sided(parts.hand(forge, options.thickness)))
      }

      limbs.push({
        joints: names,
        kind: options.ending === 'hand' ? 'arm' : 'leg',
        phase: wrapPhase(options.phase ?? 0),
      })
    }

    const remaining = options.branch ?? 0
    if (remaining > 0 && !options.bare) {
      for (const side of [-1, 1]) {
        limbChain({
          ...options,
          group: `${options.group}${part(0)}${options.suffix}B${side < 0 ? 0 : 1}`,
          suffix: '',
          parent: node,
          at: { x: 0, y: -footHeight * 0.3, z: 0 },
          pose: rest(-0.35, 0, side * 0.72),
          length: options.length * 0.52,
          thickness: options.thickness * 0.56,
          footScale: (options.footScale ?? 1) * 0.6,
          branch: remaining - 1,
        })
      }
    }

    return root
  }

  if (radial) {
    // Bilateral pairs give way to one ring of identical limbs around the spine.
    // Nothing is added or removed — the symmetry group itself is different.
    const count = 4 + (spec.torso.segments - 2)
    const ring = dims.torsoW * 0.52 * shape.wide

    for (let index = 0; index < count; index++) {
      const angle = (TAU * index) / count
      const [group, suffix] = RADIAL_NAMES[index] ?? (['radial', String(index)] as const)

      // A limb points straight down the Y axis, so turning it about Y does
      // nothing. The socket does the turning, and the limb then splays and
      // bends in its own frame — outward from the axis rather than forward.
      const socket = new THREE.Object3D()
      socket.position.set(Math.cos(angle) * ring, 0, Math.sin(angle) * ring)
      socket.rotation.y = Math.PI / 2 - angle
      hip.add(socket)

      limbChain({
        group,
        suffix,
        parent: socket,
        at: { x: 0, y: 0, z: 0 },
        pose: rest(-0.34),
        length: legLen * 0.92,
        bones: spec.limbs.segments,
        thickness: dims.legThick,
        bend: [0.62, -0.26],
        ending: 'foot',
        branch: branching,
        bare: legless,
        // A ring has no left or right, so the twist alternates around it.
        handed: index % 2 === 0 ? 1 : -1,
        // A wave travelling round the ring rather than a pair stepping.
        phase: (index / count) * TAU,
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
          group,
          suffix,
          parent: bead,
          at: { x: side * dims.torsoW * 0.4 * shape.wide, y: beadLength * 0.4, z: 0 },
          // Counter-rotated against the pitch so a limb hangs down, not back.
          pose: rest(-pitch, 0, side * 0.12),
          length: span,
          bones: spec.limbs.segments,
          thickness: dims.legThick * 0.8,
          bend: [0.3, -0.12],
          ending: 'foot',
          footScale: 0.8,
          branch: branching,
          bare: legless,
          handed: side,
          // A wave running down the body, each bead half a beat behind.
          phase: (index % 2) * Math.PI + (side < 0 ? 0 : Math.PI),
        })
      }
    })
  } else {
    /**
     * Pairs are spread evenly between the hindmost and foremost attachment, and
     * each one is sized against the floor from wherever it ended up — which is
     * the only way it can work once the spine bends.
     *
     * The hindmost pair and any in between are legs; the foremost takes the
     * front-limb role, so it can be arms instead. Two slots always exist even
     * when only one pair is asked for, because the gait's joints have to.
     */
    const slots = Math.max(2, spec.limbs.pairs)
    const sockets = Array.from({ length: slots }, (_, index) => {
      const fraction = slots === 1 ? spec.limbs.back : index / (slots - 1)
      const along = spec.limbs.back + (spec.limbs.front - spec.limbs.back) * fraction
      const at = alongSpine(along)

      const socket = new THREE.Object3D()
      socket.position.set(0, at.y, 0)
      at.node.add(socket)
      return socket
    })

    root.updateMatrixWorld(true)
    const perch = new THREE.Vector3()

    sockets.forEach((socket, index) => {
      const foremost = index === slots - 1
      const live = index < spec.limbs.pairs
      const asArms = foremost && spec.body.frontLimb === 'arms'
      const absent = foremost ? armless : legless

      const group = index === 0 ? 'back' : foremost ? 'front' : `limb${index}`
      const height = socket.getWorldPosition(perch).y
      const pose = asArms
        ? rest(-0.08 - pitch * 0.3, 0, 0)
        : rest(-pitch + (digitigrade ? 0.52 : 0.04), 0, 0)
      const bend: readonly [number, number] = asArms
        ? [0.2, 0]
        : [digitigrade ? -1.0 : -0.08, digitigrade ? 0.48 : 0.04]
      const bones = spec.limbs.segments
      const angles = Array.from({ length: bones + 1 }, (_, bone) =>
        bone === 0
          ? 0
          : bone === bones
            ? bend[1]
            : bend[0] * ((bone - 1) % 2 === 0 ? 1 : -0.7) * (1 - (bone - 1) * 0.15),
      )
      // Length, not reach: scale it so the foot lands on the floor.
      const span = asArms
        ? armLen
        : Math.max(0.08, (height - footHeight) / dropPerLength(socket, pose, angles))
      const thickness = asArms ? dims.armThick : dims.legThick * (foremost ? 0.92 : 1)

      for (const side of [-1, 1]) {
        const suffix = side < 0 ? 'L' : 'R'
        limbChain({
          group,
          suffix,
          parent: socket,
          at: { x: side * (asArms ? torsoW * 0.46 : dims.legThick * 1.05), y: 0, z: 0 },
          // Counter-rotated against the body's lean, so a limb hangs down.
          pose: rest(pose.rx, 0, side * (asArms ? 0.16 : 0.06)),
          length: span,
          bones,
          thickness,
          bend,
          ending: asArms ? 'hand' : 'foot',
          footScale: foremost ? 0.85 : 1,
          branch: branching,
          bare: absent || !live,
          handed: side,
          phase: (index % 2) * Math.PI + (side < 0 ? 0 : Math.PI),
        })
      }
    })
  }

  // ─── neck and head, counter-rotated against the pitch ─────────────────────
  const neck = joint('neck', chain[chain.length - 1]!, { x: 0, y: beadLength, z: 0 }, rest(-pitch * 0.5))
  attach(neck, parts.neck(forge))

  const head = joint('head', neck, { x: 0, y: dims.neckLen, z: 0 }, rest(-pitch * 0.45))
  attach(head, parts.skull(forge))
  for (const placed of parts.face(forge, spec.head.type)) attach(head, placed)
  for (const placed of parts.eyes(forge, spec.head.eyes)) attach(head, placed)
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
        const at = alongSpine(along)
        mesh(`ridge${i}`, at.node, geometry, { x: 0, y: at.y, z: -profile.rz(along) * 0.82 })
      }
    }
  }

  // ─── wings ────────────────────────────────────────────────────────────────
  if (spec.wings.type !== 'none') {
    for (const side of [-1, 1]) {
      // The wing sits outside the torso's own surface, swept back along the body.
      const at = alongSpine(0.66)
      const node = joint(
        side < 0 ? 'wingL' : 'wingR',
        at.node,
        { x: side * torsoW * 0.52 * shape.wide, y: at.y, z: -torsoD * 0.12 },
        rest(-0.18, side * 0.93, side * 0.22),
      )
      for (const placed of parts.wing(forge, spec.wings.type)) {
        attach(node, side < 0 ? mirrored(placed) : placed)
      }
    }
  }

  // ─── tail, hung off the pelvis so the spine's pitch never swings it ───────
  /**
   * Tail length is its own control, and it buys beads as well as reach: a tail
   * twice as long made of the same three segments is three long sticks, not a
   * tail. More of them means it can curve, and the swish has more to lag.
   */
  const base = radial ? 0 : TAIL_SEGMENTS[spec.tail.type]
  const stretch = 0.35 + spec.tail.length ** 1.6 * 2.1
  const segments =
    base <= 1 ? base : Math.min(MAX_TAIL, Math.max(2, Math.round(base * (0.75 + spec.tail.length * 1.1))))
  const reach = (0.1 + torsoD * 0.42) * base * stretch * (base > 1 ? 1 : 0.8)
  const segmentLength = segments > 0 ? reach / segments : 0
  // A long tail is carried out behind rather than dragged, which is both how a
  // long-tailed animal stands and what keeps it off the floor.
  const tailLift = { upright: -0.12, hunched: 0.3, quadruped: 0.16 }[spec.body.build] + spec.tail.length * 0.52
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

  // ─── markings, before anything is welded, so the colours survive it ──────
  if (spec.skin.pattern !== 'none') {
    root.updateMatrixWorld(true)
    const standing = new THREE.Box3().setFromObject(root)
    paint(deformable, spec.skin.pattern, {
      colour: new THREE.Color(spec.colors.pattern),
      strength: spec.skin.strength,
      size: Number.isFinite(standing.max.y) ? standing.getSize(new THREE.Vector3()).length() : 1,
      ground: Number.isFinite(standing.min.y) ? standing.min.y : 0,
    })
  }

  // ─── bake the light in, after the markings and before any welding ────────
  if (spec.bake.amount > 0.001) {
    root.updateMatrixWorld(true)
    const where: THREE.Vector3[] = []
    for (const node of Object.values(joints)) where.push(node.getWorldPosition(new THREE.Vector3()))
    bakeShading(deformable, {
      amount: spec.bake.amount,
      joints: where,
      scale: Math.max(0.05, dims.torsoW),
    })
  }

  // ─── deform, before anything is welded, so it composes with both modes ───
  if (DEFORMATIONS.includes(spec.body.mutation as Deformation)) {
    root.updateMatrixWorld(true)
    const standing = new THREE.Box3().setFromObject(root)
    deform(spec.body.mutation as Deformation, deformable, {
      scale: dims.torsoW,
      ground: Number.isFinite(standing.min.y) ? standing.min.y : 0,
    })
  }

  if (spec.body.mutation === 'asymmetric') {
    root.updateMatrixWorld(true)
    skew(deformable, 0.5)
  }

  if (spec.body.mutation === 'exploded') {
    root.updateMatrixWorld(true)
    const whole = new THREE.Box3().setFromObject(root)
    explode(deformable, whole.getCenter(new THREE.Vector3()), dims.torsoW * 0.5)
  }

  // ─── weld into one skin, if that is the mode ──────────────────────────────
  if (bound) {
    const skin = buildSkin({ root, bones, pieces, material, fuse: dims.torsoW * 0.085 })
    geometries.push(skin.geometry)
  }

  // ─── settle on the ground ─────────────────────────────────────────────────
  // The whole body, so nothing ever ends up below the floor. Keeping the feet
  // on it is the tail's job: a long one is carried out behind rather than
  // dragged, which is also how a long-tailed animal stands.
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
    limbs,
    rest: restMap,
    material,
    triangleCount,
    dispose() {
      for (const geometry of geometries) geometry.dispose()
      material.dispose()
    },
  }
}
