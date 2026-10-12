import { useRef, useCallback, useEffect, useState } from 'react'

/**
 * Audio mode state machine: LISTENING → PROCESSING → SPEAKING → COOLDOWN (3s) → LISTENING
 * Mic is muted during SPEAKING and COOLDOWN (FR-4.2.4)
 */
export function useAudioMode({ onTranscript, onSpeakingEnd } = {}) {
  const [mode, setMode] = useState('IDLE') // IDLE | LISTENING | PROCESSING | SPEAKING | COOLDOWN
  const mediaRef  = useRef(null)
  const recognRef = useRef(null)
  const cooldownRef = useRef(null)

  /* ── Mic: Web Speech API ── */
  const startListening = useCallback(async () => {
    if (mode !== 'IDLE' && mode !== 'COOLDOWN') return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      mediaRef.current = stream

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      if (!SpeechRecognition) return

      const recogn = new SpeechRecognition()
      recogn.continuous      = false
      recogn.interimResults   = false
      recogn.lang            = localStorage.getItem('terminal_language') === 'id' ? 'id-ID' : 'en-US'

      recogn.onresult = (e) => {
        const transcript = e.results[0][0].transcript.trim()
        if (transcript) {
          stopListening()
          setMode('PROCESSING')
          onTranscript?.(transcript)
        }
      }
      recogn.onerror = () => { stopListening(); setMode('IDLE') }
      recogn.onend   = () => { stopListening(); setMode('IDLE') }

      recognRef.current = recogn
      recogn.start()
      setMode('LISTENING')
    } catch {
      setMode('IDLE')
    }
  }, [mode, onTranscript])

  const stopListening = useCallback(() => {
    recognRef.current?.stop()
    recognRef.current = null
    mediaRef.current?.getTracks().forEach(t => t.stop())
    mediaRef.current = null
  }, [])

  /* ── TTS end → COOLDOWN for 3s ── */
  const handleSpeakingEnd = useCallback(() => {
    setMode('COOLDOWN')
    onSpeakingEnd?.()
    clearTimeout(cooldownRef.current)
    cooldownRef.current = setTimeout(() => {
      setMode('IDLE')
      startListening()
    }, 3000)
  }, [onSpeakingEnd, startListening])

  /* ── Public trigger for TTS end ── */
  const onTTSEnd = useCallback(() => handleSpeakingEnd(), [handleSpeakingEnd])

  useEffect(() => () => {
    stopListening()
    clearTimeout(cooldownRef.current)
  }, [stopListening])

  return { mode, startListening, stopListening, setMode, onTTSEnd }
}
