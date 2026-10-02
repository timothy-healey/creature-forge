import './style.css'
import type { Gait } from './animate'
import { generate } from './generate'
import { createViewport } from './render'
import { defaultSpec, type CreatureSpec } from './spec'
import { mountControls } from './ui'

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')
const panel = document.querySelector<HTMLElement>('#controls')
const counter = document.querySelector<HTMLElement>('#triangles')
if (!canvas || !panel || !counter) throw new Error('the page is missing its viewport or controls')

const viewport = createViewport(canvas)

function show(spec: CreatureSpec): void {
  const creature = generate(spec)
  viewport.show(creature, spec.body)
  counter!.textContent = `${creature.triangleCount} tris`
}

const spec = defaultSpec()
mountControls(panel, spec, {
  onSpecChange: show,
  onGaitChange: (gait: Gait) => viewport.setGait(gait),
})

show(spec)
