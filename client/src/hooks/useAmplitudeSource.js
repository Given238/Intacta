import { useEffect, useRef } from 'react'
import { analyserSource, proceduralSource } from '../lib/amplitude'

/**
 * One amplitude source for the waveform: Web Audio analyser when an <audio> element is given,
 * otherwise procedural speech-like levels. Returns a ref whose .current has sample(tMs) → number[11].
 */
export function useAmplitudeSource(audioEl) {
  const sourceRef = useRef(proceduralSource())

  useEffect(() => {
    sourceRef.current = (audioEl && analyserSource(audioEl)) || proceduralSource()
    return () => sourceRef.current.release()
  }, [audioEl])

  return sourceRef
}

/** true while the OS asks for reduced motion (live). */
export function usePrefersReducedMotion() {
  const ref = useRef(false)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    ref.current = mq.matches
    const onChange = (e) => { ref.current = e.matches }
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return ref
}
