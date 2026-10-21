import { describe, expect, it } from 'vitest'
import { UPCOMING_ALPHA, composite, contrastRatio } from '../contrast'
import { BOTTOM_MARGIN, FONT_MIN, REPLY_BOX, STAGE_H, STAGE_W, fitFontSize, fluidMaxFont } from '../replyLayout'
import { proceduralLevels } from '../amplitude'
import { sampleBicubic } from '../../components/MeshBackground'

const WHITE = [255, 255, 255]
const MESH_OPACITY = 0.88 // MeshBackground over the white backdrop
const FONT_MAX = 40       // the greeting size on the 1194-wide Figma reference

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

describe('fitFontSize (fluid)', () => {
  it('keeps the maximum when the text fits', () => {
    expect(fitFontSize(() => true, { max: 40 })).toBe(40)
  })
  it('shrinks in 2px steps until it fits', () => {
    expect(fitFontSize(size => size <= 34, { max: 40 })).toBe(34)
  })
  it('stops at FONT_MIN when nothing fits (the slot then scrolls)', () => {
    expect(fitFontSize(() => false, { max: 40 })).toBe(FONT_MIN)
  })
})

describe('fluidMaxFont', () => {
  it('24px on phones, ~40px on tablets, 56px on large screens', () => {
    expect(fluidMaxFont(360)).toBe(24)
    expect(fluidMaxFont(390)).toBe(25)
    expect(fluidMaxFont(834)).toBe(34)
    expect(fluidMaxFont(1194)).toBe(41)
    expect(fluidMaxFont(1920)).toBe(56)
    expect(fluidMaxFont(3000)).toBe(56)
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
