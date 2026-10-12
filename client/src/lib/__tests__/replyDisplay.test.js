import { describe, expect, it } from 'vitest'
import { UPCOMING_ALPHA, composite, contrastRatio } from '../contrast'
import { BOTTOM_MARGIN, FONT_MAX, FONT_MIN, REPLY_BOX, STAGE_H, boxTop, fitFontSize } from '../replyLayout'
import { proceduralLevels } from '../amplitude'
import { sampleBicubic } from '../../components/MeshBackground'

const WHITE = [255, 255, 255]
const STAGE_W = 1194
const MESH_OPACITY = 0.88 // MeshBackground over the white stage backdrop

/** Mesh colour actually rendered at stage point (x, y). */
const meshAt = (x, y) => composite(sampleBicubic(x / (STAGE_W - 1), y / (STAGE_H - 1)), MESH_OPACITY, WHITE)

/** Contrast of `textRgb(bg)` against the gradient over a stage region, sampled every `step` px. */
function sampleContrast({ top, bottom }, textRgb, step = 4) {
  const ratios = []
  for (let y = top; y <= bottom; y += step) {
    for (let x = REPLY_BOX.left; x <= REPLY_BOX.left + REPLY_BOX.width; x += step) {
      const bg = meshAt(x, y)
      ratios.push(contrastRatio(textRgb(bg), bg))
    }
  }
  ratios.sort((a, b) => a - b)
  const r = (v) => Math.round(v * 100) / 100
  return { min: r(ratios[0]), median: r(ratios[ratios.length >> 1]), max: r(ratios[ratios.length - 1]) }
}

// Regions: the greeting / one-line reply (40px × 1.2), and the whole area a long reply can grow into.
const REGIONS = {
  'greeting line (y 610-658)': { top: REPLY_BOX.top, bottom: REPLY_BOX.top + FONT_MAX * 1.2 },
  'full reply area (y 610-818)': { top: REPLY_BOX.top, bottom: STAGE_H - BOTTOM_MARGIN },
}
// Floors = measured minimums on 2026-10-12 (see PROGRESS.md "Known visual diffs"). Below 7:1 by design
// (no panel behind the text); these only catch the background getting brighter. The text-shadow is not counted.
const FLOOR = { white: 2.1, upcoming: 1.8 }

describe('reply/greeting contrast against the gradient behind the text box', () => {
  for (const [name, region] of Object.entries(REGIONS)) {
    it(`reports white text on ${name}`, () => {
      const white = sampleContrast(region, () => WHITE)
      const upcoming = sampleContrast(region, bg => composite(WHITE, UPCOMING_ALPHA, bg))
      console.log(`contrast ${name}: white ${JSON.stringify(white)}, upcoming words ${JSON.stringify(upcoming)} (target 7:1)`)
      expect(white.min).toBeGreaterThanOrEqual(FLOOR.white)
      expect(upcoming.min).toBeGreaterThanOrEqual(FLOOR.upcoming)
    })
  }
})

describe('fitFontSize', () => {
  it('keeps 40px when the text fits in 3 lines', () => {
    expect(fitFontSize(() => 2)).toBe(FONT_MAX)
  })
  it('shrinks until it fits', () => {
    expect(fitFontSize(size => (size > 36 ? 4 : 3))).toBe(36)
  })
  it('stops at 32px when nothing fits (the box grows instead)', () => {
    expect(fitFontSize(() => 6)).toBe(FONT_MIN)
  })
})

describe('boxTop', () => {
  it('stays at the greeting position while the text fits above the stage bottom', () => {
    expect(boxTop(120)).toBe(REPLY_BOX.top)
  })
  it('moves up only as much as needed for tall text', () => {
    const h = 260
    const top = boxTop(h)
    expect(top).toBeLessThan(REPLY_BOX.top)
    expect(top + h).toBe(STAGE_H - BOTTOM_MARGIN)
  })
})

describe('procedural amplitude', () => {
  it('gives 11 levels in 0..1 that change smoothly over time', () => {
    let prev = proceduralLevels(0)
    expect(prev).toHaveLength(11)
    for (let t = 16; t < 3000; t += 16) {
      const cur = proceduralLevels(t)
      cur.forEach((v, i) => {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
        expect(Math.abs(v - prev[i])).toBeLessThan(0.35)
      })
      prev = cur
    }
  })
})
