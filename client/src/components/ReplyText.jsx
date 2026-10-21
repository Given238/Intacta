/**
 * ReplyText — the only text slot on the terminal (Figma 62:25: Inter ExtraBold, white, centered, soft shadow).
 *
 * idle: the greeting. With a reply: cross-fades (FADE_MS) to the reply with a word-by-word highlight.
 * Fluid: both start at the fluid maximum for the viewport (24 → 56px) and shrink until they fit the text slot
 * (<TerminalBody text>); refitted on every resize. Only if it still does not fit at FONT_MIN does the slot scroll.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TEXT_SHADOW, UPCOMING_COLOR } from '../lib/contrast'
import { LINE_HEIGHT, FONT_MIN, fitFontSize, fluidMaxFont } from '../lib/replyLayout'

export const FADE_MS = 250

const TEXT_STYLE = { lineHeight: LINE_HEIGHT, textShadow: TEXT_SHADOW }
const LAYER = { position: 'absolute', inset: 0, transition: `opacity ${FADE_MS}ms ease` }

/** Font size that makes `pRef`'s text fit `boxRef`, recomputed when the box resizes or `deps` change. */
function useFitFont(boxRef, pRef, deps) {
  const [size, setSize] = useState(() => fluidMaxFont(typeof window === 'undefined' ? 1194 : window.innerWidth))
  const [overflow, setOverflow] = useState(false)
  useLayoutEffect(() => {
    const box = boxRef.current
    const p = pRef.current
    if (!box || !p) return
    const measure = () => {
      const max = fluidMaxFont(window.innerWidth)
      const fits = (s) => {
        p.style.fontSize = `${s}px`
        return p.scrollHeight <= box.clientHeight + 1
      }
      const s = fitFontSize(fits, { max, min: Math.min(FONT_MIN, max) })
      p.style.fontSize = `${s}px`
      setOverflow(!fits(s))
      p.style.fontSize = `${s}px`
      setSize(s)
    }
    measure()
    document.fonts?.ready.then(measure).catch(() => {})
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(box)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { size, overflow }
}

export default function ReplyText({ greeting, phase, reply, highlightIndex }) {
  // Keep the last reply mounted while it fades out.
  const [shown, setShown] = useState(reply)
  useEffect(() => {
    if (reply) { setShown(reply); return }
    const t = setTimeout(() => setShown(null), FADE_MS)
    return () => clearTimeout(t)
  }, [reply])

  /* ── Word highlight, advanced per animation frame while speaking ── */
  const [hi, setHi] = useState(-1)
  useEffect(() => {
    if (!reply) return
    if (phase !== 'speaking') { setHi(reply.words.length - 1); return }
    let raf = 0
    const tick = () => {
      const i = highlightIndex()
      setHi(prev => (prev === i ? prev : i))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [reply, phase, highlightIndex])

  const greetBoxRef = useRef(null)
  const greetRef = useRef(null)
  const replyBoxRef = useRef(null)
  const replyRef = useRef(null)
  const greetFit = useFitFont(greetBoxRef, greetRef, [greeting])
  const replyFit = useFitFont(replyBoxRef, replyRef, [shown?.id])

  return (
    <>
      {/* Greeting (idle only) */}
      <div ref={greetBoxRef} style={{ ...LAYER, opacity: phase === 'idle' ? 1 : 0 }} aria-hidden={phase !== 'idle'}>
        <p ref={greetRef} className="term-reply" style={{ ...TEXT_STYLE, fontSize: greetFit.size }}>{greeting}</p>
      </div>

      {/* Reply (same slot and style as the greeting) */}
      {shown && (
        <div
          ref={replyBoxRef}
          data-testid="reply"
          style={{ ...LAYER, opacity: reply ? 1 : 0, overflowY: replyFit.overflow ? 'auto' : 'hidden' }}
        >
          <p
            key={shown.id}
            ref={replyRef}
            className="term-reply reply-in"
            style={{ ...TEXT_STYLE, fontSize: replyFit.size }}
            aria-live="polite"
          >
            {shown.words.map((word, i) => (
              <span key={i} style={{ color: i <= hi ? '#ffffff' : UPCOMING_COLOR, transition: 'color 0.15s ease' }}>
                {word}{' '}
              </span>
            ))}
          </p>
        </div>
      )}
    </>
  )
}
