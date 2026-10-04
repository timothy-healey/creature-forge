import * as THREE from 'three'
import type { Creature } from './generate'

/**
 * The machinery, drawn on the creature that it shaped.
 *
 * Everything here is projected from the live scene into an SVG laid over the
 * viewport, rather than drawn as geometry in it. That is deliberate: the
 * creature renders into a couple of hundred pixels and is meant to look it,
 * while an annotation has to stay a hairline and a number has to stay legible.
 * The creature is in the viewport; the annotation is on the sheet.
 *
 * Three roles carry every mark, and no mark is coloured for decoration:
 * amber is what the generator solved, vermilion is what you chose, and bone is
 * the structure underneath. State rides line weight and dash, never hue,
 * because the creature already owns every colour.
 */

export const LENSES = ['rig', 'spine', 'phase', 'solve', 'rings'] as const
export type Lens = (typeof LENSES)[number]

export const LENS_LABEL: Record<Lens, string> = {
  rig: 'rig',
  spine: 'spine',
  phase: 'phase',
  solve: 'solve',
  rings: 'rings',
}

type Role = 'solved' | 'chosen' | 'bone'

const INK: Record<Role, string> = { solved: '#f2b134', chosen: '#e2503a', bone: '#8fa6b0' }

interface Mark {
  kind: 'line' | 'disc' | 'text' | 'ring'
  role: Role
  a?: [number, number]
  b?: [number, number]
  points?: string
  text?: string
  anchor?: 'start' | 'middle' | 'end'
  dash?: boolean
  faint?: boolean
}

/** A part's sample bands, in its own space, worked out once when it is built. */
interface Bands {
  node: THREE.Object3D
  rings: THREE.Vector3[][]
}

export interface Inspector {
  element: SVGSVGElement
  show(creature: Creature): void
  setLenses(lenses: ReadonlySet<Lens>): void
  /** A control is being touched: draw what it changes, and only that. */
  focus(lens: Lens | null): void
  draw(camera: THREE.Camera, width: number, height: number, time: number): void
}

export function createInspector(): Inspector {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible'

  const pool: SVGElement[] = []
  let creature: Creature | null = null
  let bands: Bands[] = []
  let lenses: ReadonlySet<Lens> = new Set()
  let focused: Lens | null = null

  const point = new THREE.Vector3()
  const scratch = new THREE.Vector3()

  function show(next: Creature): void {
    creature = next
    bands = readBands(next)
  }

  function draw(camera: THREE.Camera, width: number, height: number, time: number): void {
    if (!creature || width === 0) {
      render([])
      return
    }

    const active = focused ? new Set<Lens>([focused, ...lenses]) : lenses
    if (active.size === 0) {
      render([])
      return
    }

    creature.root.updateMatrixWorld(false)
    const marks: Mark[] = []
    const at = (vector: THREE.Vector3): [number, number] => {
      scratch.copy(vector).project(camera)
      return [((scratch.x + 1) / 2) * width, ((1 - scratch.y) / 2) * height]
    }

    if (active.has('rings')) ringMarks(bands, at, marks)
    if (active.has('rig')) rigMarks(creature, at, point, marks)
    if (active.has('spine')) spineMarks(creature, at, point, marks)
    if (active.has('solve')) solveMarks(creature, at, point, width, marks)
    if (active.has('phase')) phaseMarks(creature, at, point, time, marks)

    render(marks)
  }

  function render(marks: readonly Mark[]): void {
    for (let i = 0; i < marks.length; i++) {
      const mark = marks[i]!
      let node = pool[i]
      const wanted = mark.kind === 'text' ? 'text' : mark.kind === 'disc' ? 'circle' : mark.kind === 'ring' ? 'polyline' : 'line'
      if (!node || node.tagName !== wanted) {
        node?.remove()
        node = document.createElementNS('http://www.w3.org/2000/svg', wanted)
        pool[i] = node
        // At its own index, so paint order keeps matching mark order.
        svg.insertBefore(node, svg.children[i] ?? null)
      }
      apply(node, mark)
      node.style.display = ''
    }
    // `hidden` is an HTML attribute: the UA rule that acts on it does not reach
    // SVG children, so a mark hidden that way stays on screen as a ghost of
    // wherever the creature last was. Display is the only thing that works in
    // both namespaces.
    for (let i = marks.length; i < pool.length; i++) pool[i]!.style.display = 'none'
  }

  return {
    element: svg,
    show,
    setLenses: (next) => {
      lenses = next
    },
    focus: (lens) => {
      focused = lens
    },
    draw,
  }
}

function apply(node: SVGElement, mark: Mark): void {
  const ink = INK[mark.role]
  const faint = mark.faint ? '0.45' : '1'

  if (mark.kind === 'text') {
    node.setAttribute('x', String(mark.a![0]))
    node.setAttribute('y', String(mark.a![1]))
    node.setAttribute('fill', ink)
    node.setAttribute('opacity', faint)
    node.setAttribute('text-anchor', mark.anchor ?? 'start')
    node.setAttribute('font-size', '10')
    node.setAttribute('font-family', '"Share Tech Mono", ui-monospace, monospace')
    node.setAttribute('letter-spacing', '0.04em')
    node.setAttribute('paint-order', 'stroke')
    node.setAttribute('stroke', '#0f171c')
    node.setAttribute('stroke-width', '3')
    node.textContent = mark.text ?? ''
    return
  }

  node.setAttribute('stroke', ink)
  node.setAttribute('stroke-width', '1')
  node.setAttribute('opacity', faint)
  node.setAttribute('shape-rendering', 'crispEdges')
  node.setAttribute('stroke-dasharray', mark.dash ? '3 3' : 'none')

  if (mark.kind === 'disc') {
    node.setAttribute('cx', String(mark.a![0]))
    node.setAttribute('cy', String(mark.a![1]))
    node.setAttribute('r', '2.5')
    node.setAttribute('fill', '#0f171c')
    return
  }
  if (mark.kind === 'ring') {
    node.setAttribute('points', mark.points ?? '')
    node.setAttribute('fill', 'none')
    return
  }

  node.setAttribute('x1', String(mark.a![0]))
  node.setAttribute('y1', String(mark.a![1]))
  node.setAttribute('x2', String(mark.b![0]))
  node.setAttribute('y2', String(mark.b![1]))
}

type Project = (vector: THREE.Vector3) => [number, number]

/** Every joint, and a hairline to the one it hangs from. */
function rigMarks(creature: Creature, at: Project, point: THREE.Vector3, marks: Mark[]): void {
  for (const [name, node] of Object.entries(creature.joints)) {
    const here = at(node.getWorldPosition(point))
    const above = parentJoint(node, creature.joints)
    if (above) marks.push({ kind: 'line', role: 'bone', a: at(above.getWorldPosition(point)), b: here })
    marks.push({ kind: 'disc', role: 'bone', a: at(node.getWorldPosition(point)) })
    if (name === 'head' || name === 'hip') {
      marks.push({ kind: 'text', role: 'bone', a: [here[0] + 7, here[1] - 5], text: name, faint: true })
    }
  }
}

/** The bead chain, numbered, so a curve reads as a count of segments. */
function spineMarks(creature: Creature, at: Project, point: THREE.Vector3, marks: Mark[]): void {
  const beads = Object.keys(creature.joints)
    .filter((name) => /^body\d+$/.test(name))
    .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))

  let previous: [number, number] | null = null
  beads.forEach((name, index) => {
    const here = at(creature.joints[name]!.getWorldPosition(point))
    if (previous) marks.push({ kind: 'line', role: 'chosen', a: previous, b: here })
    marks.push({ kind: 'disc', role: 'chosen', a: here })
    marks.push({
      kind: 'text',
      role: 'solved',
      a: [here[0] - 8, here[1] + 3],
      text: `${index + 1}/${beads.length}`,
      anchor: 'end',
    })
    previous = here
  })
}

/**
 * The floor, and what each limb was sized to so it reaches it. This is the one
 * that shows the generator working: move a pair up the body and the number
 * here changes, because the limb was re-solved.
 */
function solveMarks(creature: Creature, at: Project, point: THREE.Vector3, width: number, marks: Mark[]): void {
  creature.root.updateMatrixWorld(false)
  const bounds = new THREE.Box3().setFromObject(creature.root)
  const floor = at(new THREE.Vector3(0, bounds.min.y, 0))

  marks.push({ kind: 'line', role: 'bone', a: [0, floor[1]], b: [width, floor[1]], dash: true, faint: true })
  marks.push({ kind: 'text', role: 'bone', a: [8, floor[1] - 6], text: 'DATUM — FLOOR', faint: true })

  for (const limb of creature.limbs) {
    const root = creature.joints[limb.joints[0]!]
    const foot = creature.joints[limb.joints[limb.joints.length - 1]!]
    if (!root || !foot) continue

    const from = root.getWorldPosition(point).clone()
    const to = foot.getWorldPosition(point).clone()
    const reach = from.y - to.y
    if (reach < 0.02) continue

    const a = at(from)
    const b = at(to)
    marks.push({ kind: 'line', role: 'solved', a, b, dash: true })
    marks.push({
      kind: 'text',
      role: 'solved',
      a: [(a[0] + b[0]) / 2 + 6, (a[1] + b[1]) / 2],
      text: reach.toFixed(2),
    })
  }
}

/** Where each limb is in the stride, and where it is right now. */
function phaseMarks(creature: Creature, at: Project, point: THREE.Vector3, time: number, marks: Mark[]): void {
  const TAU = Math.PI * 2
  for (const limb of creature.limbs) {
    const root = creature.joints[limb.joints[0]!]
    if (!root) continue
    const here = at(root.getWorldPosition(point))
    const centre: [number, number] = [here[0], here[1] - 20]
    const radius = 9

    const steps = 10
    const arc: string[] = []
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * TAU - Math.PI / 2
      arc.push(`${(centre[0] + Math.cos(angle) * radius).toFixed(1)},${(centre[1] + Math.sin(angle) * radius).toFixed(1)}`)
    }
    marks.push({ kind: 'ring', role: 'bone', points: arc.join(' '), faint: true })

    const now = ((time / 0.9) * TAU + limb.phase) % TAU - Math.PI / 2
    marks.push({
      kind: 'line',
      role: 'solved',
      a: centre,
      b: [centre[0] + Math.cos(now) * radius, centre[1] + Math.sin(now) * radius],
    })
    marks.push({
      kind: 'text',
      role: 'solved',
      a: [centre[0] + radius + 5, centre[1] + 3],
      text: `${(limb.phase / Math.PI).toFixed(2)}π · ${limb.joints.length - 1} bones`,
    })
  }
}

/** The bands a part's profile was sampled at — the detail slider, made visible. */
function ringMarks(bands: readonly Bands[], at: Project, marks: Mark[]): void {
  const world = new THREE.Vector3()
  for (const part of bands) {
    for (const ring of part.rings) {
      const projected = ring.map((local) => at(world.copy(local).applyMatrix4(part.node.matrixWorld)))
      marks.push({
        kind: 'ring',
        role: 'bone',
        points: projected.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ') + ` ${projected[0]![0].toFixed(1)},${projected[0]![1].toFixed(1)}`,
        faint: true,
      })
    }
  }
}

/**
 * Recovers each part's sample bands from the geometry it already built, rather
 * than asking the generator to hand them over: a prism's vertices sit at a
 * handful of distinct heights, and those heights are exactly the rings.
 */
function readBands(creature: Creature): Bands[] {
  const out: Bands[] = []

  creature.root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const position = mesh.geometry.getAttribute('position')
    if (!position || position.count > 600) return

    const byHeight = new Map<number, THREE.Vector3[]>()
    for (let i = 0; i < position.count; i++) {
      const y = Math.round(position.getY(i) * 1e3)
      const list = byHeight.get(y)
      const vertex = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i))
      if (list) list.push(vertex)
      else byHeight.set(y, [vertex])
    }

    const rings: THREE.Vector3[][] = []
    for (const group of byHeight.values()) {
      if (group.length < 6) continue

      const unique = new Map<string, THREE.Vector3>()
      for (const vertex of group) {
        unique.set(`${Math.round(vertex.x * 1e3)},${Math.round(vertex.z * 1e3)}`, vertex)
      }
      const corners = [...unique.values()]
      if (corners.length < 3 || corners.length > 16) continue

      const cx = corners.reduce((sum, v) => sum + v.x, 0) / corners.length
      const cz = corners.reduce((sum, v) => sum + v.z, 0) / corners.length
      corners.sort((a, b) => Math.atan2(a.z - cz, a.x - cx) - Math.atan2(b.z - cz, b.x - cx))
      rings.push(corners)
    }

    if (rings.length > 0 && rings.length <= 10) out.push({ node: mesh, rings })
  })

  return out
}

function parentJoint(node: THREE.Object3D, joints: Record<string, THREE.Object3D>): THREE.Object3D | null {
  let current = node.parent
  while (current) {
    if (current.name && joints[current.name] === current) return current
    current = current.parent
  }
  return null
}
