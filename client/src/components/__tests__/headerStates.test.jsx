/**
 * Terminal header states (Part D): rendered to static markup (no DOM needed).
 * unpaired → buttons; paired → "Connected · {name}" chip with the buttons hidden; caregiver:updated renames;
 * several caregivers → "+N"; a reload paints the cached state; unpaired again → buttons back.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const store = new Map()
vi.stubGlobal('localStorage', {
  getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k),
})

let Header, i18n, conn
beforeAll(async () => {
  i18n = (await import('../../i18n')).default
  Header = (await import('../Header')).default
  conn = await import('../../lib/connection')
})

const render = (connection, props = {}) => renderToStaticMarkup(<Header connection={connection} {...props} />)
// Visible text with the tags dropped ("Connected · Budi" + "+2" are separate spans)
const visible = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
// The layer with the given test id is hidden (faded out, inert, aria-hidden)
const layerHidden = (html, testId) => {
  const tag = html.match(new RegExp(`<div[^>]*data-testid="${testId}"[^>]*>`))?.[0] || ''
  return /is-hidden/.test(tag) && /inert/.test(tag) && /aria-hidden="true"/.test(tag)
}

describe('terminal header', () => {
  it('unpaired: both connect buttons and the divider, no chip', () => {
    i18n.changeLanguage('en')
    const html = render(conn.UNPAIRED)
    expect(html).toContain('Enable caregiver connection')
    expect(html).toContain('Authentication code')
    expect(html).toContain('term-divider')
    expect(layerHidden(html, 'connect-actions')).toBe(false)
    expect(html).not.toContain('data-testid="connected-chip"')
  })

  it('paired: the chip "Connected · {name}" with a green dot; buttons + divider hidden and inert', () => {
    const html = render(conn.fromServer({ caregiver_name: 'Budi Santoso', caregiver_count: 1 }, { paired: true }))
    expect(html).toContain('data-testid="connected-chip"')
    expect(visible(html)).toContain('Connected · Budi Santoso')
    expect(html).toContain('term-chip-dot')
    expect(html).toContain('aria-label="Connected to Budi Santoso"')
    expect(layerHidden(html, 'connect-actions')).toBe(true)
  })

  it('caregiver:updated changes the name', () => {
    const html = render(conn.fromServer({ name: 'Rina', count: 1 }))
    expect(visible(html)).toContain('Connected · Rina')
  })

  it('several caregivers: "{first name} +N" (full name in the accessible label)', () => {
    const html = render(conn.fromServer({ name: 'Budi Santoso', count: 3 }))
    expect(visible(html)).toContain('Connected · Budi +2')
    expect(html).toContain('aria-label="Connected to Budi Santoso and 2 more caregivers"')
  })

  it('no name → "Caregiver"; Indonesian "Terhubung · …"', () => {
    expect(visible(render(conn.fromServer({ name: null, count: 1 })))).toContain('Connected · Caregiver')
    i18n.changeLanguage('id')
    expect(visible(render(conn.fromServer({ name: 'Budi', count: 2 })))).toContain('Terhubung · Budi +1')
    i18n.changeLanguage('en')
  })

  it('a reload paints the last known state from localStorage before the server answers', () => {
    conn.saveConnection({ paired: true, name: 'Sari', count: 2 })
    const html = render(conn.loadConnection())
    expect(visible(html)).toContain('Connected · Sari +1')
    expect(layerHidden(html, 'connect-actions')).toBe(true)
  })

  it('unpaired again (caregiver:updated count 0): the buttons return', () => {
    const state = conn.fromServer({ name: null, count: 0 })
    conn.saveConnection(state)
    const html = render(state)
    expect(layerHidden(html, 'connect-actions')).toBe(false)
    expect(html).toContain('Enable caregiver connection')
    expect(conn.loadConnection()).toBe(conn.UNPAIRED)
  })

  it('the chip has no click action (a tap does nothing); only the 3 s hold handlers', () => {
    const html = render(conn.fromServer({ name: 'Budi', count: 1 }), { onChipHold: () => {} })
    const chip = html.match(/<div[^>]*data-testid="connected-chip"[^>]*>/)[0]
    expect(chip).not.toMatch(/<button|onclick|tabindex/i)
    expect(chip).toContain('role="status"')
  })
})
