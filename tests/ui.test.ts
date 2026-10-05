// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'

import { defaultView } from '../src/render'
import { defaultSpec } from '../src/spec'
import { columnsFor, mountUi } from '../src/ui'

/**
 * A picker lays itself out from how many options it has. Hand-written column
 * counts are what left `fan` alone on a row of its own after the tail list
 * changed length.
 */
describe('how wide a row of choices lays itself out', () => {
  test('a short list puts every option on one line', () => {
    expect(columnsFor(3)).toBe(3)
    expect(columnsFor(5)).toBe(5)
  })

  test('a long list splits into even rows rather than leaving an orphan', () => {
    expect(columnsFor(6)).toBe(3)
    expect(columnsFor(8)).toBe(4)
  })

  test('never asks for more columns than there are options', () => {
    for (let count = 1; count <= 12; count++) {
      expect(columnsFor(count), `${count} options`).toBeLessThanOrEqual(count)
      expect(columnsFor(count), `${count} options`).toBeGreaterThan(0)
    }
  })
})

describe('copying the link', () => {
  const sheet = () => {
    const zones = {
      modes: document.createElement('div'),
      rail: document.createElement('div'),
      spec: document.createElement('div'),
      zoneY: document.createElement('div'),
      zoneX: document.createElement('div'),
    }
    for (const zone of Object.values(zones)) document.body.append(zone)
    mountUi(zones, defaultSpec(), defaultView(), {
      onSpecChange: () => {},
      onGaitChange: () => {},
      onViewChange: () => {},
      onFocus: () => {},
    })
    return zones.spec.querySelector<HTMLButtonElement>('.copy')!
  }

  afterEach(() => {
    document.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  test('is a control on the sheet at all', () => {
    expect(sheet()).toBeTruthy()
  })

  test('puts the address on the clipboard when the browser offers one', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    const button = sheet()
    button.click()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href))
    await vi.waitFor(() => expect(button.textContent).toBe('Copied'))
  })

  /**
   * `navigator.clipboard` only exists on a secure origin. Vite serves the same
   * app on localhost and on a bare LAN address, and only the first of those is
   * one — so the control has to work without the modern API.
   */
  test('still copies when there is no clipboard API, as on a plain http origin', async () => {
    vi.stubGlobal('navigator', {})
    const copy = vi.fn().mockReturnValue(true)
    document.execCommand = copy as unknown as typeof document.execCommand

    const button = sheet()
    button.click()

    await vi.waitFor(() => expect(copy).toHaveBeenCalledWith('copy'))
    await vi.waitFor(() => expect(button.textContent).toBe('Copied'))
  })

  test('says so rather than claiming success when it truly cannot', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } })
    document.execCommand = (() => false) as unknown as typeof document.execCommand

    const button = sheet()
    button.click()

    await vi.waitFor(() => expect(button.textContent).not.toBe('Copy link'))
    expect(button.textContent).not.toBe('Copied')
  })

  test('leaves nothing behind in the document when it is done', async () => {
    vi.stubGlobal('navigator', {})
    document.execCommand = (() => true) as unknown as typeof document.execCommand

    const button = sheet()
    button.click()

    await vi.waitFor(() => expect(button.textContent).toBe('Copied'))
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })
})
