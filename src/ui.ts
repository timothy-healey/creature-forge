import { GAITS, type Gait } from './animate'
import { RENDER_MODES, type RenderMode, type ViewSettings } from './render'
import {
  COLOR_KEYS,
  COLOR_LABELS,
  EAR_TYPES,
  FRONT_LIMBS,
  BUILDS,
  HEAD_TYPES,
  EYE_COUNTS,
  HORN_COUNTS,
  LEG_TYPES,
  MESH_MODES,
  MUTATION_GROUPS,
  RIDGE_TYPES,
  SEGMENT_COUNTS,
  SLIDERS,
  TAIL_TYPES,
  WING_TYPES,
  randomSpec,
  readSlider,
  writeSlider,
  type CreatureSpec,
} from './spec'

/**
 * The controls, split by what they are about rather than piled into one list.
 *
 * Along the top: how you are looking at the creature — the gait, how it is
 * built, how it is drawn, and the two knobs that set the era. Down the left:
 * what it structurally *is*. On the right: its own measurements. Nothing in
 * here is hand-listed that the spec already knows — sliders build themselves
 * from `SLIDERS` and every picker reads its options from the lists in `spec`.
 */

export interface Zones {
  modes: HTMLElement
  mutations: HTMLElement
  body: HTMLElement
}

export interface UiHandlers {
  onSpecChange(spec: CreatureSpec): void
  onGaitChange(gait: Gait): void
  onViewChange(view: ViewSettings): void
}

export function mountUi(zones: Zones, spec: CreatureSpec, view: ViewSettings, handlers: UiHandlers): void {
  const changed = () => handlers.onSpecChange(spec)
  const remount = (next: CreatureSpec) => {
    mountUi(zones, next, view, handlers)
    handlers.onSpecChange(next)
  }

  mountModes(zones.modes, spec, view, handlers, changed, remount)
  mountMutations(zones.mutations, spec, changed)
  mountBody(zones.body, spec, changed)
}

// ─── top: how you are looking at it ─────────────────────────────────────────

function mountModes(
  panel: HTMLElement,
  spec: CreatureSpec,
  view: ViewSettings,
  handlers: UiHandlers,
  changed: () => void,
  remount: (spec: CreatureSpec) => void,
): void {
  panel.replaceChildren(
    rollButton(() => {
      // Detail, mesh and mutation are ways of looking at a creature rather than
      // part of one, so a roll keeps whatever is selected.
      remount(randomSpec(Math.random, spec.detail.level, spec.body.mesh, spec.body.mutation))
    }),
    bar('Gait', pills(GAITS, 'idle', (gait) => handlers.onGaitChange(gait))),
    bar(
      'Built',
      pills(MESH_MODES, spec.body.mesh, (mesh) => {
        spec.body.mesh = mesh
        changed()
      }),
    ),
    bar(
      'Drawn',
      pills(RENDER_MODES, view.render, (render: RenderMode) => {
        view.render = render
        handlers.onViewChange(view)
      }),
    ),
    bar('Vertices', dial(spec.detail.level, (value) => {
      spec.detail.level = value
      changed()
    })),
    bar('Pixels', dial(view.pixels, (value) => {
      view.pixels = value
      handlers.onViewChange(view)
    })),
    bar('Wobble', dial(view.wobble, (value) => {
      view.wobble = value
      handlers.onViewChange(view)
    })),
  )
}

// ─── left: what it structurally is ──────────────────────────────────────────

function mountMutations(panel: HTMLElement, spec: CreatureSpec, changed: () => void): void {
  const buttons: HTMLButtonElement[] = []

  panel.replaceChildren(
    ...MUTATION_GROUPS.flatMap((group) => {
      const heading = document.createElement('h2')
      heading.textContent = group.title

      const list = document.createElement('div')
      list.className = 'stack'
      list.append(
        ...group.items.map((mutation) => {
          const button = document.createElement('button')
          button.type = 'button'
          button.textContent = mutation
          button.setAttribute('aria-pressed', String(mutation === spec.body.mutation))
          button.addEventListener('click', () => {
            for (const other of buttons) other.setAttribute('aria-pressed', 'false')
            button.setAttribute('aria-pressed', 'true')
            spec.body.mutation = mutation
            changed()
          })
          buttons.push(button)
          return button
        }),
      )

      return [heading, list]
    }),
  )
}

// ─── right: its own measurements ────────────────────────────────────────────

function mountBody(panel: HTMLElement, spec: CreatureSpec, changed: () => void): void {
  panel.replaceChildren(
    section('Shape', slidersFor('Shape', spec, changed)),
    section('Frame', [
      choice('Build', BUILDS, spec.body.build, (build) => {
        spec.body.build = build
        changed()
      }),
      choice('Front', FRONT_LIMBS, spec.body.frontLimb, (frontLimb) => {
        spec.body.frontLimb = frontLimb
        changed()
      }),
      choice('Segments', SEGMENT_COUNTS, spec.torso.segments, (segments) => {
        spec.torso.segments = segments
        changed()
      }),
    ]),
    section('Head', [
      choice('Shape', HEAD_TYPES, spec.head.type, (type) => {
        spec.head.type = type
        changed()
      }),
      choice('Horns', HORN_COUNTS, spec.head.horns, (horns) => {
        spec.head.horns = horns
        changed()
      }),
      choice('Eyes', EYE_COUNTS, spec.head.eyes, (eyes) => {
        spec.head.eyes = eyes
        changed()
      }),
      choice('Ears', EAR_TYPES, spec.head.ears, (ears) => {
        spec.head.ears = ears
        changed()
      }),
      ...slidersFor('Head', spec, changed),
    ]),
    section('Neck', slidersFor('Neck', spec, changed)),
    section('Torso', slidersFor('Torso', spec, changed)),
    section('Arms', slidersFor('Arms', spec, changed)),
    section('Legs', [
      choice('Stance', LEG_TYPES, spec.legs.type, (type) => {
        spec.legs.type = type
        changed()
      }),
      ...slidersFor('Legs', spec, changed),
    ]),
    section('Tail', [
      choice('Shape', TAIL_TYPES, spec.tail.type, (type) => {
        spec.tail.type = type
        changed()
      }),
    ]),
    section('Back', [
      choice('Ridge', RIDGE_TYPES, spec.back.ridge, (ridge) => {
        spec.back.ridge = ridge
        changed()
      }),
      choice('Wings', WING_TYPES, spec.wings.type, (type) => {
        spec.wings.type = type
        changed()
      }),
    ]),
    section(
      'Palette',
      COLOR_KEYS.map((key) =>
        colorRow(COLOR_LABELS[key], spec.colors[key], (value) => {
          spec.colors[key] = value
          changed()
        }),
      ),
    ),
  )
}

// ─── pieces ─────────────────────────────────────────────────────────────────

function slidersFor(group: string, spec: CreatureSpec, changed: () => void): HTMLElement[] {
  return SLIDERS.filter((slider) => slider.group === group).map((slider) =>
    sliderRow(slider.label, readSlider(spec, slider.path), (value) => {
      writeSlider(spec, slider.path, value)
      changed()
    }),
  )
}

function rollButton(onRoll: () => void): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'roll'
  button.textContent = 'Randomise'
  button.addEventListener('click', onRoll)
  return button
}

/** One labelled cell of the top bar. */
function bar(label: string, content: HTMLElement): HTMLElement {
  const cell = document.createElement('div')
  cell.className = 'cell'

  const name = document.createElement('span')
  name.textContent = label

  cell.append(name, content)
  return cell
}

function section(title: string, children: HTMLElement[]): HTMLElement {
  const element = document.createElement('section')
  const heading = document.createElement('h2')
  heading.textContent = title
  element.append(heading, ...children)
  return element
}

function dial(value: number, onInput: (value: number) => void): HTMLElement {
  const input = document.createElement('input')
  input.type = 'range'
  input.min = '0'
  input.max = '1'
  input.step = '0.01'
  input.value = String(value)
  input.addEventListener('input', () => onInput(Number(input.value)))
  return input
}

function sliderRow(label: string, value: number, onInput: (value: number) => void): HTMLElement {
  const row = document.createElement('label')
  row.className = 'row'

  const name = document.createElement('span')
  name.textContent = label

  row.append(name, dial(value, onInput))
  return row
}

function colorRow(label: string, value: string, onInput: (value: string) => void): HTMLElement {
  const row = document.createElement('label')
  row.className = 'row'

  const name = document.createElement('span')
  name.textContent = label

  const input = document.createElement('input')
  input.type = 'color'
  input.value = value
  input.addEventListener('input', () => onInput(input.value))

  row.append(name, input)
  return row
}

function pills<T extends string | number>(
  options: readonly T[],
  selected: T,
  onPick: (value: T) => void,
): HTMLElement {
  const group = document.createElement('div')
  group.className = 'choices'

  const buttons = options.map((option) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = String(option)
    button.setAttribute('aria-pressed', String(option === selected))
    button.addEventListener('click', () => {
      for (const other of buttons) other.setAttribute('aria-pressed', 'false')
      button.setAttribute('aria-pressed', 'true')
      onPick(option)
    })
    return button
  })

  group.append(...buttons)
  return group
}

function choice<T extends string | number>(
  label: string,
  options: readonly T[],
  selected: T,
  onPick: (value: T) => void,
): HTMLElement {
  const row = document.createElement('div')
  row.className = options.length > 4 ? 'row wide' : 'row'

  const name = document.createElement('span')
  name.textContent = label

  row.append(name, pills(options, selected, onPick))
  return row
}
