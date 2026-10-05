import { GAITS, type Gait } from './animate'
import { fitElement } from './density'
import { LENSES, LENS_LABEL, type Lens } from './inspect'
import { BACKGROUNDS, RENDER_MODES, type ViewSettings } from './render'
import {
  BUILDS,
  COLOR_KEYS,
  COLOR_LABELS,
  EAR_TYPES,
  EYE_COUNTS,
  FRONT_LIMBS,
  HEAD_TYPES,
  HORN_COUNTS,
  LEG_TYPES,
  LIMB_SEGMENTS,
  MESH_MODES,
  MUTATION_GROUPS,
  PAIR_COUNTS,
  PATTERNS,
  RIDGE_TYPES,
  SEGMENT_COUNTS,
  SLIDERS,
  TAIL_TYPES,
  WING_TYPES,
  randomSpec,
  readSlider,
  writeSlider,
  type CreatureSpec,
  type SliderPath,
} from './spec'

/**
 * The sheet's controls.
 *
 * Two rules run through all of it. Nothing is hand-listed that the spec already
 * knows — every picker reads its options from `spec`, every slider builds itself
 * from `SLIDERS` — and every control declares which lens it reveals, so touching
 * it draws the thing it changes and letting go puts the sheet back to quiet.
 */

export interface Zones {
  modes: HTMLElement
  rail: HTMLElement
  spec: HTMLElement
  zoneY: HTMLElement
  zoneX: HTMLElement
}

export interface UiHandlers {
  onSpecChange(spec: CreatureSpec): void
  onGaitChange(gait: Gait): void
  onViewChange(view: ViewSettings): void
  onFocus(lens: Lens | null): void
}

/** Which part of the machinery each group of controls is about. */
const REVEALS: Partial<Record<SliderPath, Lens>> = {
  'detail.level': 'rings',
  'shape.edge': 'rings',
  'shape.section': 'rings',
  'spine.arch': 'spine',
  'spine.sway': 'spine',
  'limbs.back': 'solve',
  'limbs.front': 'solve',
  'legs.length': 'solve',
  'legs.thickness': 'solve',
}

export function mountUi(zones: Zones, spec: CreatureSpec, view: ViewSettings, handlers: UiHandlers): void {
  const changed = () => handlers.onSpecChange(spec)
  const remount = (next: CreatureSpec) => {
    mountUi(zones, next, view, handlers)
    handlers.onSpecChange(next)
  }

  zones.zoneY.replaceChildren(...['A', 'B', 'C', 'D'].map(text))
  zones.zoneX.replaceChildren(...['1', '2', '3', '4', '5', '6'].map(text))
  mountModes(zones.modes, spec, view, handlers, changed, remount)
  mountRail(zones.rail, spec, changed, handlers)
  mountSpec(zones.spec, spec, changed, handlers)

  // New content, so the rails re-measure rather than keeping an old level.
  fitElement(zones.rail)
  fitElement(zones.spec)
}

/** The title block's solved totals, rewritten whenever a creature is built. */
export function reportTotals(
  zone: HTMLElement,
  totals: { triangles: number; joints: number; limbs: number; ident: string },
): void {
  const block = zone.querySelector('[data-totals]')
  if (!block) return
  block.querySelector('[data-tris]')!.textContent = String(totals.triangles)
  block.querySelector('[data-joints]')!.textContent = String(totals.joints)
  block.querySelector('[data-limbs]')!.textContent = String(totals.limbs)
  zone.querySelector('[data-ident]')!.textContent = totals.ident
}

// ─── the mode strip ─────────────────────────────────────────────────────────

function mountModes(
  panel: HTMLElement,
  spec: CreatureSpec,
  view: ViewSettings,
  handlers: UiHandlers,
  changed: () => void,
  remount: (spec: CreatureSpec) => void,
): void {
  const lenses = new Set(view.lenses)

  panel.replaceChildren(
    wordmark(),
    group('GAIT', pills(GAITS, 'idle', (gait) => handlers.onGaitChange(gait), 'phase', handlers)),
    group(
      'BUILT',
      pills(MESH_MODES, spec.body.mesh, (mesh) => {
        spec.body.mesh = mesh
        changed()
      }, 'rig', handlers),
    ),
    group(
      'DRAWN',
      pills(RENDER_MODES, view.render, (render) => {
        view.render = render
        handlers.onViewChange(view)
      }),
    ),
    group(
      'SCENE',
      pills(BACKGROUNDS, view.background, (background) => {
        view.background = background
        handlers.onViewChange(view)
      }),
    ),
    group(
      'INSPECT',
      toggles(LENSES, lenses, (lens, on) => {
        if (on) lenses.add(lens)
        else lenses.delete(lens)
        view.lenses = [...lenses]
        handlers.onViewChange(view)
      }),
    ),
    group('OUTLINE', dial(view.outline, (value) => {
      view.outline = value
      handlers.onViewChange(view)
    })),
    group('PIXELS', dial(view.pixels, (value) => {
      view.pixels = value
      handlers.onViewChange(view)
    })),
    group('WOBBLE', dial(view.wobble, (value) => {
      view.wobble = value
      handlers.onViewChange(view)
    })),
    span('spacer'),
    rollButton(() => remount(randomSpec(Math.random, spec.detail.level, spec.body.mesh, spec.body.mutation))),
  )
}

// ─── left rail: what it structurally is ─────────────────────────────────────

function mountRail(panel: HTMLElement, spec: CreatureSpec, changed: () => void, handlers: UiHandlers): void {
  const buttons: HTMLButtonElement[] = []

  panel.replaceChildren(
    ...MUTATION_GROUPS.flatMap((family, index) => {
      // Two regardless of how many are in the family: a mutation's name is a
      // word, not a count, and `segmented` has nowhere to go in a fifth of a rail.
      const pack = el('div', 'pack two')
      pack.append(
        ...family.items.map((mutation) => {
          const button = choiceButton(String(mutation), mutation === spec.body.mutation, () => {
            for (const other of buttons) other.setAttribute('aria-pressed', 'false')
            button.setAttribute('aria-pressed', 'true')
            spec.body.mutation = mutation
            changed()
          }, 'rig', handlers)
          buttons.push(button)
          return button
        }),
      )
      return [tab(`A${index + 1}  ${family.title.toUpperCase()}`, String(family.items.length)), pack]
    }),
    tab('A4  HEAD', ''),
    stack([
      choices(HEAD_TYPES, spec.head.type, (type) => {
        spec.head.type = type
        changed()
      }),
      choices(EAR_TYPES, spec.head.ears, (ears) => {
        spec.head.ears = ears
        changed()
      }),
      choices(EYE_COUNTS, spec.head.eyes, (eyes) => {
        spec.head.eyes = eyes
        changed()
      }),
      choices(HORN_COUNTS, spec.head.horns, (horns) => {
        spec.head.horns = horns
        changed()
      }),
    ]),
    tab('A5  TAIL & BACK', ''),
    stack([
      choices(TAIL_TYPES, spec.tail.type, (type) => {
        spec.tail.type = type
        changed()
      }),
      choices(RIDGE_TYPES, spec.back.ridge, (ridge) => {
        spec.back.ridge = ridge
        changed()
      }),
      choices(WING_TYPES, spec.wings.type, (type) => {
        spec.wings.type = type
        changed()
      }),
    ]),
    tab('A6  MARKINGS', ''),
    stack([
      choices(PATTERNS, spec.skin.pattern, (pattern) => {
        spec.skin.pattern = pattern
        changed()
      }),
    ]),
    el('div', 'grow'),
    tab('LEGEND', ''),
    legend(),
  )
}

function legend(): HTMLElement {
  const box = el('div', 'legend')
  box.innerHTML =
    '<div><span class="swatch" style="background:var(--solved)"></span> <b style="color:var(--solved)">solved</b> <span style="color:var(--faint)">by the system</span></div>' +
    '<div><span class="chip" style="background:var(--chosen)"></span> <b style="color:var(--chosen)">chosen</b> <span style="color:var(--faint)">by you</span></div>' +
    '<div><span class="swatch" style="background:var(--datum)"></span> <b style="color:var(--datum)">datum</b> <span style="color:var(--faint)">&amp; grid</span></div>'
  return box
}

// ─── right rail: its own measurements ───────────────────────────────────────

function mountSpec(panel: HTMLElement, spec: CreatureSpec, changed: () => void, handlers: UiHandlers): void {
  panel.replaceChildren(
    tab('B1  SHAPE', ''),
    lines(['detail.level', 'shape.edge', 'shape.section', 'bake.amount'], spec, changed, handlers),
    tab('B2  SPINE', ''),
    lines(['spine.arch', 'spine.sway'], spec, changed, handlers),
    tab('B3  FRAME', ''),
    stack([
      choices(BUILDS, spec.body.build, (build) => {
        spec.body.build = build
        changed()
      }, 'spine', handlers),
      choices(SEGMENT_COUNTS, spec.torso.segments, (segments) => {
        spec.torso.segments = segments
        changed()
      }, 'spine', handlers),
    ]),
    lines(['torso.height', 'torso.width', 'torso.depth', 'neck.length'], spec, changed, handlers),
    tab('B4  LIMBS', ''),
    stack([
      choices(PAIR_COUNTS, spec.limbs.pairs, (pairs) => {
        spec.limbs.pairs = pairs
        changed()
      }, 'solve', handlers),
      choices(LIMB_SEGMENTS, spec.limbs.segments, (segments) => {
        spec.limbs.segments = segments
        changed()
      }, 'solve', handlers),
      choices(FRONT_LIMBS, spec.body.frontLimb, (frontLimb) => {
        spec.body.frontLimb = frontLimb
        changed()
      }, 'solve', handlers),
      choices(LEG_TYPES, spec.legs.type, (type) => {
        spec.legs.type = type
        changed()
      }, 'solve', handlers),
    ]),
    lines(['limbs.back', 'limbs.front', 'legs.length', 'legs.thickness', 'arms.length', 'arms.thickness'], spec, changed, handlers),
    tab('B5  HEAD & SKIN', ''),
    lines(['head.length', 'head.width', 'tail.length', 'skin.strength'], spec, changed, handlers),
    tab('B6  PALETTE', ''),
    palette(spec, changed),
    el('div', 'grow'),
    totalsBlock(),
    identBlock(),
  )
}

function palette(spec: CreatureSpec, changed: () => void): HTMLElement {
  const row = el('div', 'swatches')
  for (const key of COLOR_KEYS) {
    const label = document.createElement('label')
    const name = document.createElement('span')
    name.textContent = COLOR_LABELS[key]
    const input = document.createElement('input')
    input.type = 'color'
    input.value = spec.colors[key]
    input.addEventListener('input', () => {
      spec.colors[key] = input.value
      changed()
    })
    label.append(name, input)
    row.append(label)
  }
  return row
}

function totalsBlock(): HTMLElement {
  const block = el('dl', 'block')
  block.setAttribute('data-totals', '')
  block.innerHTML =
    '<div><dt>TRIS</dt><dd data-tris>&mdash;</dd></div>' +
    '<div><dt>JOINTS</dt><dd data-joints>&mdash;</dd></div>' +
    '<div><dt>LIMBS</dt><dd data-limbs>&mdash;</dd></div>'
  return block
}

function identBlock(): HTMLElement {
  const block = el('dl', 'ident')
  block.innerHTML = '<dt>IDENT</dt><dd data-ident>&mdash;</dd>'
  return block
}

// ─── pieces ─────────────────────────────────────────────────────────────────

function el(tag: string, className = ''): HTMLElement {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

function span(className: string): HTMLElement {
  return el('span', className)
}

function text(value: string): HTMLElement {
  const node = el('span')
  node.textContent = value
  return node
}

function wordmark(): HTMLElement {
  const box = el('div', 'wordmark')
  const name = document.createElement('b')
  name.textContent = 'Creature Forge'
  const sub = el('span')
  sub.style.cssText = 'font-family:var(--figure);font-size:9px;color:var(--faint)'
  sub.textContent = 'SHT 01'
  box.append(name, sub)
  return box
}

function group(label: string, content: HTMLElement): HTMLElement {
  const box = el('div', 'group')
  box.append(text(label), content)
  return box
}

/** A compact slider for the mode strip, where there is no room for a label row. */
function dial(value: number, onInput: (value: number) => void): HTMLElement {
  const input = document.createElement('input')
  input.type = 'range'
  input.min = '0'
  input.max = '1'
  input.step = '0.01'
  input.value = String(value)
  input.className = 'dial'
  input.addEventListener('input', () => onInput(Number(input.value)))
  return input
}

function tab(left: string, right: string): HTMLElement {
  const box = el('div', 'tab')
  box.append(text(left), text(right))
  return box
}

/**
 * How many columns a row of `count` choices lays itself out in: up to five, one
 * per option, and beyond that an even split. A grid sized to the whole list
 * leaves the last option standing alone on a row of its own.
 */
export function columnsFor(count: number): number {
  const options = Math.max(1, Math.round(count))
  return options <= 5 ? options : Math.ceil(options / 2)
}

const COLUMN_WORDS = ['one', 'two', 'three', 'four', 'five', 'six'] as const

function gridClass(count: number): string {
  const columns = columnsFor(count)
  return `pack ${COLUMN_WORDS[Math.min(columns, COLUMN_WORDS.length) - 1]}`
}

/** Several pickers stacked, each already sized to its own list. */
function stack(rows: HTMLElement[]): HTMLElement {
  const wrap = el('div')
  wrap.append(...rows)
  return wrap
}

function lines(
  paths: readonly SliderPath[],
  spec: CreatureSpec,
  changed: () => void,
  handlers: UiHandlers,
): HTMLElement {
  const pack = el('div', 'pack lines')
  for (const path of paths) {
    const def = SLIDERS.find((slider) => slider.path === path)
    if (!def) continue

    const row = document.createElement('label')
    row.className = 'line'
    const name = el('span')
    name.textContent = def.label

    const input = document.createElement('input')
    input.type = 'range'
    input.min = '0'
    input.max = '1'
    input.step = '0.01'
    input.value = String(readSlider(spec, path))

    const readout = document.createElement('em')
    readout.textContent = readSlider(spec, path).toFixed(2)

    const lens = REVEALS[path] ?? null
    input.addEventListener('input', () => {
      writeSlider(spec, path, Number(input.value))
      readout.textContent = Number(input.value).toFixed(2)
      changed()
    })
    reveal(input, lens, handlers)

    row.append(name, input, readout)
    pack.append(row)
  }
  return pack
}

/**
 * Draw what this control changes while it is being touched, and stop when it is
 * let go — by pointer or by keyboard, so the sheet annotates itself either way.
 */
function reveal(node: HTMLElement, lens: Lens | null, handlers: UiHandlers): void {
  if (!lens) return
  const on = () => handlers.onFocus(lens)
  const off = () => handlers.onFocus(null)
  node.addEventListener('pointerenter', on)
  node.addEventListener('pointerleave', off)
  node.addEventListener('focus', on)
  node.addEventListener('blur', off)
}

function choiceButton(
  label: string,
  selected: boolean,
  onPick: () => void,
  lens: Lens | null = null,
  handlers?: UiHandlers,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.setAttribute('aria-pressed', String(selected))
  button.addEventListener('click', onPick)
  if (lens && handlers) reveal(button, lens, handlers)
  return button
}

function choices<T extends string | number>(
  options: readonly T[],
  selected: T,
  onPick: (value: T) => void,
  lens: Lens | null = null,
  handlers?: UiHandlers,
): HTMLElement {
  const row = el('div', gridClass(options.length))
  const buttons = options.map((option) => {
    const button = choiceButton(String(option), option === selected, () => {
      for (const other of buttons) other.setAttribute('aria-pressed', 'false')
      button.setAttribute('aria-pressed', 'true')
      onPick(option)
    }, lens, handlers)
    return button
  })
  row.append(...buttons)
  return row
}

function pills<T extends string | number>(
  options: readonly T[],
  selected: T,
  onPick: (value: T) => void,
  lens: Lens | null = null,
  handlers?: UiHandlers,
): HTMLElement {
  const row = el('div')
  row.style.cssText = 'display:flex;gap:3px'
  const buttons = options.map((option) =>
    choiceButton(String(option), option === selected, () => {
      for (const other of buttons) other.setAttribute('aria-pressed', 'false')
      buttons[options.indexOf(option)]!.setAttribute('aria-pressed', 'true')
      onPick(option)
    }, lens, handlers),
  )
  row.append(...buttons)
  return row
}

function toggles<T extends string>(
  options: readonly T[],
  active: Set<T>,
  onToggle: (value: T, on: boolean) => void,
): HTMLElement {
  const row = el('div')
  row.style.cssText = 'display:flex;gap:3px'
  for (const option of options) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = LENS_LABEL[option as Lens] ?? option
    button.setAttribute('aria-pressed', String(active.has(option)))
    button.addEventListener('click', () => {
      const on = button.getAttribute('aria-pressed') !== 'true'
      button.setAttribute('aria-pressed', String(on))
      onToggle(option, on)
    })
    row.append(button)
  }
  return row
}

function rollButton(onRoll: () => void): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'roll'
  button.textContent = 'Randomise'
  button.addEventListener('click', onRoll)
  return button
}
