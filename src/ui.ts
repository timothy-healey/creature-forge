import { GAITS, type Gait } from './animate'
import {
  BUILDS,
  COLOR_KEYS,
  COLOR_LABELS,
  EAR_TYPES,
  FRONT_LIMBS,
  HEAD_TYPES,
  HORN_COUNTS,
  LEG_TYPES,
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
 * The control panel. Sliders build themselves from `SLIDERS` and every picker
 * reads its options from the lists in `spec`, so a new part type or slider
 * appears here without this file being touched.
 */

export interface UiHandlers {
  onSpecChange(spec: CreatureSpec): void
  onGaitChange(gait: Gait): void
}

/**
 * Builds the panel for a spec. Rolling a new creature rebuilds the whole panel
 * rather than hunting down each control to update it — the panel is cheap, and
 * one code path means a rolled value can never disagree with its slider.
 */
export function mountControls(panel: HTMLElement, spec: CreatureSpec, handlers: UiHandlers): void {
  const changed = () => handlers.onSpecChange(spec)
  panel.replaceChildren()

  panel.append(
    rollButton(() => {
      // Detail is a viewing choice, not part of the creature — a roll keeps it.
      const rolled = randomSpec(Math.random, spec.detail.level)
      mountControls(panel, rolled, handlers)
      handlers.onSpecChange(rolled)
    }),
    choiceGroup('Gait', GAITS, 'idle', (gait) => handlers.onGaitChange(gait)),
    section('Detail', slidersFor('Detail', spec, changed)),
    section('Body', [
      choiceGroup('Build', BUILDS, spec.body.build, (build) => {
        spec.body.build = build
        changed()
      }),
      choiceGroup('Front', FRONT_LIMBS, spec.body.frontLimb, (frontLimb) => {
        spec.body.frontLimb = frontLimb
        changed()
      }),
      choiceGroup('Segments', SEGMENT_COUNTS, spec.torso.segments, (segments) => {
        spec.torso.segments = segments
        changed()
      }),
    ]),
    section('Head', [
      choiceGroup('Shape', HEAD_TYPES, spec.head.type, (type) => {
        spec.head.type = type
        changed()
      }),
      choiceGroup('Horns', HORN_COUNTS, spec.head.horns, (horns) => {
        spec.head.horns = horns
        changed()
      }),
      choiceGroup('Ears', EAR_TYPES, spec.head.ears, (ears) => {
        spec.head.ears = ears
        changed()
      }),
      ...slidersFor('Head', spec, changed),
    ]),
    section('Neck', slidersFor('Neck', spec, changed)),
    section('Torso', slidersFor('Torso', spec, changed)),
    section('Arms', slidersFor('Arms', spec, changed)),
    section('Legs', [
      choiceGroup('Stance', LEG_TYPES, spec.legs.type, (type) => {
        spec.legs.type = type
        changed()
      }),
      ...slidersFor('Legs', spec, changed),
    ]),
    section('Tail', [
      choiceGroup('Shape', TAIL_TYPES, spec.tail.type, (type) => {
        spec.tail.type = type
        changed()
      }),
    ]),
    section('Back', [
      choiceGroup('Ridge', RIDGE_TYPES, spec.back.ridge, (ridge) => {
        spec.back.ridge = ridge
        changed()
      }),
      choiceGroup('Wings', WING_TYPES, spec.wings.type, (type) => {
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

function section(title: string, children: HTMLElement[]): HTMLElement {
  const element = document.createElement('section')
  const heading = document.createElement('h2')
  heading.textContent = title
  element.append(heading, ...children)
  return element
}

function sliderRow(label: string, value: number, onInput: (value: number) => void): HTMLElement {
  const row = document.createElement('label')
  row.className = 'row'

  const name = document.createElement('span')
  name.textContent = label

  const input = document.createElement('input')
  input.type = 'range'
  input.min = '0'
  input.max = '1'
  input.step = '0.01'
  input.value = String(value)
  input.addEventListener('input', () => onInput(Number(input.value)))

  row.append(name, input)
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

function choiceGroup<T extends string | number>(
  label: string,
  options: readonly T[],
  selected: T,
  onPick: (value: T) => void,
): HTMLElement {
  const row = document.createElement('div')
  row.className = 'row'

  const name = document.createElement('span')
  name.textContent = label

  const choices = document.createElement('div')
  choices.className = 'choices'

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

  choices.append(...buttons)
  row.append(name, choices)
  return row
}
