import './style.css'
import type { Gait } from './animate'
import { generate } from './generate'
import { createViewport } from './render'
import { defaultSpec } from './spec'
import { mountControls } from './ui'

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')
const panel = document.querySelector<HTMLElement>('#controls')
const counter = document.querySelector<HTMLElement>('#triangles')
if (!canvas || !panel || !counter) throw new Error('the page is missing its viewport or controls')

const spec = defaultSpec()
const viewport = createViewport(canvas)

function rebuild(): void {
  const creature = generate(spec)
  viewport.show(creature)
  counter!.textContent = `${creature.triangleCount} tris`
}

mountControls(panel, spec, {
  onSpecChange: rebuild,
  onGaitChange: (gait: Gait) => viewport.setGait(gait),
})

rebuild()
