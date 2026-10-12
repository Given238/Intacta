/**
 * WCAG contrast helpers + the reply text colours. White text sits directly on the mesh gradient;
 * replyDisplay.test.js samples the gradient behind the text box and reports the ratio.
 */

/** Words not yet spoken: white at this alpha (spoken words are solid white). */
export const UPCOMING_ALPHA = 0.8

/** Same soft shadow on the greeting and the reply. */
export const TEXT_SHADOW = '0 2px 12px rgba(0,0,0,0.35)'

export const UPCOMING_COLOR = `rgba(255,255,255,${UPCOMING_ALPHA})`

const channel = (c) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

export function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrastRatio(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** fg at alpha over an opaque bg. */
export function composite(fg, alpha, bg) {
  return fg.map((v, i) => v * alpha + bg[i] * (1 - alpha))
}
