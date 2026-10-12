/**
 * Amplitude sources for the speaking waveform. Each returns 11 raw levels in 0..1 per call;
 * smoothing and the 35–100% height mapping happen in WaveformBars.
 *
 * (a) analyserSource(audioEl): Web Audio AnalyserNode on the element (MediaElementSource is created
 *     once per element: a second createMediaElementSource on the same element throws).
 * (b) proceduralSource(): smooth pseudo-random levels shaped like speech (syllable envelope + value noise).
 */

export const BAR_COUNT = 11

/* ── (b) procedural ── */

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** 1D value noise, smooth (cosine-eased) between integer lattice points. */
function valueNoise(x) {
  const i = Math.floor(x)
  const f = x - i
  const u = (1 - Math.cos(f * Math.PI)) / 2
  return hash(i) * (1 - u) + hash(i + 1) * u
}

export function proceduralLevels(tMs, count = BAR_COUNT) {
  const t = tMs / 1000
  // syllable-rate envelope (~4 Hz) with slower phrase swell, never fully silent
  const syllable = 0.55 + 0.45 * Math.abs(Math.sin(t * Math.PI * 4 + valueNoise(t * 0.7) * 3))
  const phrase = 0.7 + 0.3 * valueNoise(t * 0.9 + 17)
  const levels = new Array(count)
  for (let i = 0; i < count; i++) {
    const n = valueNoise(t * 6 + i * 13.37)
    levels[i] = Math.max(0, Math.min(1, syllable * phrase * (0.35 + 0.65 * n)))
  }
  return levels
}

export function proceduralSource() {
  return { sample: (tMs) => proceduralLevels(tMs), release() {} }
}

/* ── (a) analyser ── */

let sharedCtx = null
const nodesByElement = new WeakMap()

function audioContext() {
  if (sharedCtx) return sharedCtx
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return null
  sharedCtx = new Ctx()
  return sharedCtx
}

/** Returns null when Web Audio is unavailable (caller falls back to procedural). */
export function analyserSource(audioEl) {
  const ctx = audioContext()
  if (!ctx) return null
  let nodes = nodesByElement.get(audioEl)
  if (!nodes) {
    try {
      const source = ctx.createMediaElementSource(audioEl)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.6
      source.connect(analyser)
      source.connect(ctx.destination)
      nodes = { analyser, data: new Uint8Array(analyser.frequencyBinCount) }
      nodesByElement.set(audioEl, nodes)
    } catch (e) {
      console.error('analyser setup failed:', e.message)
      return null
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})

  const { analyser, data } = nodes
  // Speech energy sits in the low bins; spread the 11 bars over bins 1..48 (log-ish spacing).
  const edges = Array.from({ length: BAR_COUNT + 1 }, (_, i) => Math.round(1 + 47 * Math.pow(i / BAR_COUNT, 1.6)))

  return {
    sample() {
      analyser.getByteFrequencyData(data)
      let total = 0
      for (let b = 1; b <= 48; b++) total += data[b]
      const overall = total / (48 * 255)
      const levels = new Array(BAR_COUNT)
      for (let i = 0; i < BAR_COUNT; i++) {
        const lo = edges[i]
        const hi = Math.max(lo + 1, edges[i + 1])
        let sum = 0
        for (let b = lo; b < hi; b++) sum += data[b]
        const band = sum / ((hi - lo) * 255)
        levels[i] = Math.min(1, (0.6 * band + 0.4 * overall) * 1.6)
      }
      return levels
    },
    release() {},
  }
}
