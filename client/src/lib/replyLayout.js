/**
 * Terminal text sizing (fluid layout, C2).
 *
 * The greeting / reply starts at the fluid maximum (24px on phones → ~40px on tablets → 56px on large screens,
 * same as --term-reply-max in terminal.css) and shrinks in FONT_STEP steps until it fits its slot; it only
 * scrolls if it still does not fit at FONT_MIN.
 *
 * REPLY_BOX / STAGE_* are the Figma 1:2 reference geometry (1194×834): the contrast test samples the gradient
 * behind the text region there. The live layout is fluid and does not use them.
 */
export const REPLY_BOX = { left: 271, top: 610, width: 703 }
export const STAGE_W = 1194
export const STAGE_H = 834
export const BOTTOM_MARGIN = 16

export const FONT_MIN_FLUID = 24  // phones
export const FONT_MAX_FLUID = 56  // large screens
export const FONT_MIN = 16        // last resort before scrolling
export const FONT_STEP = 2
export const LINE_HEIGHT = 1.25

/** Fluid maximum for a viewport width: clamp(24px, 16.6px + 2.05vw, 56px). */
export function fluidMaxFont(viewportWidth) {
  return Math.round(Math.min(FONT_MAX_FLUID, Math.max(FONT_MIN_FLUID, 16.6 + 0.0205 * viewportWidth)))
}

/**
 * Largest font size in [min, max] (FONT_STEP steps down from max) for which `fits(size)` is true; `min` when
 * none fits (the slot then scrolls).
 * @param {(size:number) => boolean} fits  measured: does the text fit the slot at this size
 */
export function fitFontSize(fits, { max = FONT_MAX_FLUID, min = FONT_MIN, step = FONT_STEP } = {}) {
  for (let size = max; size > min; size -= step) {
    if (fits(size)) return size
  }
  return min
}
