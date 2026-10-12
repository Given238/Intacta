/**
 * ReplyText — the only text slot on the terminal (Figma 62:25: left 271, top 610, width 703,
 * Inter ExtraBold 40px white, centered).
 *
 * idle: the greeting. With a reply: cross-fades (FADE_MS) to the reply with a word-by-word
 * highlight. Greeting and reply share one text style (incl. a soft shadow), no background. Long
 * replies shrink to FONT_MIN, then the box grows downward, moving up only if it would pass the stage bottom.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TEXT_SHADOW, UPCOMING_COLOR } from '../lib/contrast'
import { REPLY_BOX, FONT_MAX, LINE_HEIGHT, fitFontSize, boxTop } from '../lib/replyLayout'

export const FADE_MS = 250

const TEXT_STYLE = {
  fontFamily: '"Inter", system-ui, sans-serif',
  fontWeight: 800,
  color:      'white',
  lineHeight: LINE_HEIGHT,
  textAlign:  'center',
  textShadow: TEXT_SHADOW,
  margin:     0,
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

  /* ── Fit: shrink to ≤3 lines (min 32px), then grow; keep above the stage bottom ── */
  const pRef = useRef(null)
  const [fit, setFit] = useState({ id: null, fontSize: FONT_MAX, top: REPLY_BOX.top })
  useLayoutEffect(() => {
    const p = pRef.current
    if (!shown || !p) return
    const measure = () => {
      const linesAt = (size) => {
        p.style.fontSize = `${size}px`
        return Math.round(p.offsetHeight / (size * LINE_HEIGHT))
      }
      const fontSize = fitFontSize(linesAt)
      p.style.fontSize = `${fontSize}px`
      setFit({ id: shown.id, fontSize, top: boxTop(p.offsetHeight) })
    }
    measure()
    document.fonts?.ready.then(measure).catch(() => {})
  }, [shown])

  const replyVisible = !!reply
  const fitted = fit.id === shown?.id

  return (
    <>
      {/* Greeting (idle only) */}
      <div
        style={{
          position:   'absolute',
          left:       REPLY_BOX.left,
          top:        REPLY_BOX.top,
          width:      REPLY_BOX.width,
          opacity:    phase === 'idle' ? 1 : 0,
          transition: `opacity ${FADE_MS}ms ease`,
        }}
        aria-hidden={phase !== 'idle'}
      >
        <p style={{ ...TEXT_STYLE, fontSize: FONT_MAX }}>{greeting}</p>
      </div>

      {/* Reply (same box and style as the greeting) */}
      {shown && (
        <div
          data-testid="reply"
          style={{
            position:   'absolute',
            left:       REPLY_BOX.left,
            top:        fitted ? fit.top : REPLY_BOX.top,
            width:      REPLY_BOX.width,
            opacity:    replyVisible && fitted ? 1 : 0,
            transition: `opacity ${FADE_MS}ms ease`,
          }}
        >
          <p
            key={shown.id}
            ref={pRef}
            className="reply-in"
            style={{ ...TEXT_STYLE, position: 'relative', fontSize: fitted ? fit.fontSize : FONT_MAX }}
            aria-live="polite"
          >
            {shown.words.map((word, i) => (
              <span
                key={i}
                style={{ color: i <= hi ? '#ffffff' : UPCOMING_COLOR, transition: 'color 0.15s ease' }}
              >
                {word}{' '}
              </span>
            ))}
          </p>
        </div>
      )}
    </>
  )
}
