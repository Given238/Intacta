import { useCallback, useEffect, useRef, useState } from 'react'
import { createReplyLifecycle } from '../lib/replyLifecycle'

/**
 * React wrapper around createReplyLifecycle.
 * Returns {phase, reply, presentReply, highlightIndex}; presentReply is stable.
 */
export function useReplyLifecycle({ playbackSpeed = 1, fallbackText = '' } = {}) {
  const [snapshot, setSnapshot] = useState({ phase: 'idle', reply: null })
  const lifecycleRef = useRef(null)
  if (!lifecycleRef.current) lifecycleRef.current = createReplyLifecycle({ onChange: setSnapshot })

  const optsRef = useRef({ playbackSpeed, fallbackText })
  optsRef.current = { playbackSpeed, fallbackText }

  useEffect(() => () => lifecycleRef.current.dispose(), [])

  /** presentReply({text, parts, audioEl?, source?}) — one entry point for typed, voice, broadcast, routine. */
  const presentReply = useCallback(
    (reply) => lifecycleRef.current.present({ ...optsRef.current, ...reply }),
    [],
  )
  const highlightIndex = useCallback(() => lifecycleRef.current.highlightIndex(), [])

  return { phase: snapshot.phase, reply: snapshot.reply, presentReply, highlightIndex }
}
