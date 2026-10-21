/**
 * Portal text contrast (C1): every text colour token on the surface it is used on must reach 4.5:1 (WCAG AA).
 * Tokens live in index.css (@theme). Secondary text is white 80% (text-muted) on the dark cards and panels;
 * directly on the page background (#427aa1) only full white passes, so secondary text there stays white.
 */
import { describe, expect, it } from 'vitest'
import { composite, contrastRatio } from '../contrast'

const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const WHITE = [255, 255, 255]
const white = (alpha, bg) => composite(WHITE, alpha, bg)

const SURFACE = hex('#043961')   // cards (bg-surface)
const CANVAS  = hex('#427aa1')   // page background (bg-canvas)
const PANEL   = white(0.1, SURFACE) // bg-white/10 panels inside cards (log details)
const TABBAR  = hex('#234053')   // tab bar / side rail (bg-intacta-panel)
const HEADER  = hex('#05668d')   // header (bg-intacta-dark), also the active tab
const MUTED   = 0.8              // --color-muted
const DANGER_SOFT = hex('#ffc4c4')

const CASES = [
  ['white on card',                 WHITE,                 SURFACE],
  ['muted (secondary) on card',     white(MUTED, SURFACE), SURFACE],
  ['muted on white/10 panel',       white(MUTED, PANEL),   PANEL],
  ['danger-soft on card',           DANGER_SOFT,           SURFACE],
  ['white on page background',      WHITE,                 CANVAS],
  ['muted on tab bar / rail',       white(MUTED, TABBAR),  TABBAR],
  ['white on active tab / header',  WHITE,                 HEADER],
  ['tagline (white 85%) on header', white(0.85, HEADER),   HEADER],
  ['white on red tag (#dc2626)',    WHITE,                 hex('#dc2626')],
  ['white on time pill (#466781)',  WHITE,                 hex('#466781')],
]

describe('portal text contrast ≥ 4.5:1', () => {
  it.each(CASES)('%s', (_name, fg, bg) => {
    const ratio = contrastRatio(fg, bg)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('muted text is NOT allowed on the page background (only full white passes there)', () => {
    expect(contrastRatio(white(MUTED, CANVAS), CANVAS)).toBeLessThan(4.5)
    expect(contrastRatio(hex('#c6d6df'), CANVAS)).toBeLessThan(4.5) // the old intacta-text grey
  })
})
