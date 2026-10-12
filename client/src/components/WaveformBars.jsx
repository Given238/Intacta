/**
 * WaveformBars — 11 bars at exact Figma positions (1:2, 1194×834 canvas).
 *
 * Bar layout (x, height):
 *   [63,35] [162,61] [261,150] [360,210] [459,76] [558,125]
 *   [657,170] [756,39] [855,75] [954,48] [1053,25]
 *
 * Bar bottoms sit on y≈521 (three Figma bars end at 520; tops below are the exact Figma values).
 * Rendered in stage coordinates: place directly inside <TerminalStage>, no wrapper.
 *
 * Not speaking: exact Figma heights, no animation at all.
 * Speaking: each bar's height = 35–100% of its Figma height from a smoothed amplitude
 * (useAmplitudeSource: analyser on `audioEl`, else procedural), scaled from the baseline upward.
 * On stop the bars ease back to the Figma heights in STOP_EASE_MS.
 * prefers-reduced-motion: a slow, gentle pulse instead.
 *
 * SQUARE corners — no border-radius (set globally in index.css).
 */
import { useEffect, useRef } from 'react'
import { useAmplitudeSource, usePrefersReducedMotion } from '../hooks/useAmplitudeSource'

const BAR_W = 78

// Figma 62:94, 62:92, 62:7, 62:11, 62:13, 62:15, 62:17, 62:19, 62:21, 62:96, 62:98
export const BARS = [
  { x: 63,   top: 486, height: 35  },
  { x: 162,  top: 460, height: 61  },
  { x: 261,  top: 371, height: 150 },
  { x: 360,  top: 311, height: 210 },
  { x: 459,  top: 445, height: 76  },
  { x: 558,  top: 396, height: 125 },
  { x: 657,  top: 350, height: 170 },
  { x: 756,  top: 481, height: 39  },
  { x: 855,  top: 445, height: 75  },
  { x: 954,  top: 473, height: 48  },
  { x: 1053, top: 496, height: 25  },
]

const MIN_LEVEL    = 0.35
const ATTACK_MS    = 60   // smoothing time constants
const RELEASE_MS   = 160
const STOP_EASE_MS = 400
const PULSE_MS     = 1800 // reduced-motion pulse period

const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3)

export default function WaveformBars({ speaking = false, audioEl = null }) {
  const barRefs   = useRef([])
  const scalesRef = useRef(BARS.map(() => 1))
  const sourceRef = useAmplitudeSource(audioEl)
  const reducedRef = usePrefersReducedMotion()

  useEffect(() => {
    const apply = () => {
      scalesRef.current.forEach((s, i) => {
        const el = barRefs.current[i]
        if (el) el.style.transform = s === 1 ? '' : `scaleY(${s})`
      })
    }
    let raf = 0
    let last = performance.now()

    if (speaking) {
      const start = last
      const smooth = scalesRef.current.map(s => (s - MIN_LEVEL) / (1 - MIN_LEVEL))
      const frame = (now) => {
        const dt = Math.min(100, now - last)
        last = now
        if (reducedRef.current) {
          const p = 0.5 - 0.5 * Math.cos(((now - start) / PULSE_MS) * 2 * Math.PI)
          scalesRef.current = BARS.map(() => 1 - 0.15 * p)
        } else {
          const target = sourceRef.current.sample(now)
          scalesRef.current = smooth.map((v, i) => {
            const goal = target[i] ?? 0
            const tau = goal > v ? ATTACK_MS : RELEASE_MS
            smooth[i] = v + (goal - v) * (1 - Math.exp(-dt / tau))
            return MIN_LEVEL + (1 - MIN_LEVEL) * smooth[i]
          })
        }
        apply()
        raf = requestAnimationFrame(frame)
      }
      raf = requestAnimationFrame(frame)
      return () => cancelAnimationFrame(raf)
    }

    // Not speaking: ease back to the Figma heights, then stay still.
    const from = scalesRef.current.slice()
    if (from.every(s => s === 1)) { apply(); return }
    const start = last
    const frame = (now) => {
      const k = Math.min(1, (now - start) / STOP_EASE_MS)
      const e = easeOutCubic(k)
      scalesRef.current = from.map(s => (k >= 1 ? 1 : s + (1 - s) * e))
      apply()
      if (k < 1) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [speaking, sourceRef, reducedRef])

  return (
    <div
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      aria-hidden="true"
      data-speaking={speaking ? 'true' : 'false'}
    >
      {BARS.map((bar, i) => (
        <div
          key={i}
          ref={el => { barRefs.current[i] = el }}
          className="waveform-bar"
          style={{
            position:        'absolute',
            left:            bar.x,
            top:             bar.top,
            width:           BAR_W,
            height:          bar.height,
            transformOrigin: 'bottom center',
            willChange:      'transform',
          }}
        />
      ))}

    </div>
  )
}
