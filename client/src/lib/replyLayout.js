/** Reply box geometry in the 1194×834 stage (same box as the Figma greeting, node 62:25). */
export const REPLY_BOX = { left: 271, top: 610, width: 703 }
export const STAGE_H = 834
export const BOTTOM_MARGIN = 16

export const FONT_MAX = 40
export const FONT_MIN = 32
export const FONT_STEP = 2
export const MAX_LINES = 3
export const LINE_HEIGHT = 1.2

/**
 * Largest font size in [FONT_MIN, FONT_MAX] (FONT_STEP steps) whose text fits in MAX_LINES;
 * FONT_MIN when none does (the box then grows downward).
 * @param {(size:number) => number} linesAt  measured line count at a font size
 */
export function fitFontSize(linesAt, { max = FONT_MAX, min = FONT_MIN, step = FONT_STEP, maxLines = MAX_LINES } = {}) {
  for (let size = max; size > min; size -= step) {
    if (linesAt(size) <= maxLines) return size
  }
  return min
}

/** Box top: the greeting position, moved up only as far as needed to keep the text above the stage bottom. */
export function boxTop(contentHeight) {
  const limit = STAGE_H - BOTTOM_MARGIN - contentHeight
  return Math.min(REPLY_BOX.top, Math.max(0, limit))
}
