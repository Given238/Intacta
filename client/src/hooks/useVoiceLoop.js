import { useCallback, useEffect, useRef, useState } from 'react'
import { createMicMachine, MIC } from '../lib/micMachine'
import { createVoiceInput, micErrorReason, SAMPLE_RATE } from '../lib/voiceInput'
import { audioContext } from '../lib/amplitude'
import { wavBlob } from '../lib/wav'
import { terminalFetch } from '../lib/terminalApi'

const PROB_THROTTLE_MS = 150

/**
 * Voice input loop: mic (requested in the Start tap) → VAD segment → POST /api/respond (multipart WAV,
 * server STT) → say(reply). Drives the mic state machine; App's say() calls speakStart() and the
 * reply lifecycle leaving 'speaking' calls speakEnd() (→ 3.0 s cooldown → listening).
 *
 * @param {object} o
 * @param {Promise<MediaStream>|null} o.micStream  started inside the Start tap; null before it
 * @param {string} o.phase                         reply lifecycle phase
 * @param {{current: function}} o.sayRef          App's say({text, parts, source}) → resolves after audio starts
 * @param {{current: number}} o.pendingSaysRef     say() calls still loading TTS
 */
export function useVoiceLoop({ micStream, phase, sayRef, pendingSaysRef }) {
  const [state, setState] = useState(MIC.OFF)
  const [info, setInfo] = useState({ prob: 0, transcript: '', timings: null, error: null })
  const voiceRef = useRef(null)
  const machineRef = useRef(null)
  if (!machineRef.current) {
    machineRef.current = createMicMachine({
      onChange: setState,
      onCapture: (on) => voiceRef.current?.setCapture(on),
    })
  }
  const machine = machineRef.current

  /* ── One speech segment → transcript → reply ── */
  const handleSegment = useCallback(async (audio, { durationMs, endedAt }) => {
    if (!machine.speechEnded()) return // not listening: drop it
    const form = new FormData()
    form.append('source', 'voice')
    form.append('audio', wavBlob(audio, SAMPLE_RATE), 'speech.wav')
    let data
    try {
      data = await terminalFetch('/api/respond', { method: 'POST', body: form })
    } catch (err) {
      console.error('[voice] respond failed:', err.message)
      setInfo(i => ({ ...i, error: `respond failed: ${err.message}` }))
      machine.processingDone()
      return
    }
    const replyAt = performance.now()
    const serverLlmMs = data?.meta?.latency_ms ?? 0
    const toReplyMs = Math.round(replyAt - endedAt)
    if (data?.meta?.no_speech) {
      const timings = { segmentMs: Math.round(durationMs), vadToTranscriptMs: toReplyMs, sttMs: data.meta.stt_ms, noSpeech: true }
      console.info('[voice] no speech in segment', timings)
      setInfo(i => ({ ...i, transcript: '(no speech)', timings, error: null }))
      machine.processingDone()
      return
    }
    setInfo(i => ({ ...i, transcript: data.transcript || '', error: null }))
    await sayRef.current({ text: data.text, parts: data.parts, source: 'voice', meta: data.meta })
    const audioAt = performance.now()
    const timings = {
      segmentMs:          Math.round(durationMs),
      vadToTranscriptMs:  toReplyMs - serverLlmMs,  // upload + server STT
      sttMs:              data.meta?.stt_ms,
      transcriptToReplyMs: serverLlmMs,             // LLM chain (server)
      replyToAudioMs:     Math.round(audioAt - replyAt), // TTS first audio
      totalMs:            Math.round(audioAt - endedAt),
    }
    console.info('[voice] timings ms', timings)
    setInfo(i => ({ ...i, timings }))
  }, [machine, sayRef])

  /* ── Start the mic + VAD once the Start tap asked for the stream ── */
  const segmentRef = useRef(handleSegment)
  segmentRef.current = handleSegment
  useEffect(() => {
    if (!micStream) return
    let cancelled = false
    let lastProbAt = 0
    micStream
      .then(stream => createVoiceInput({
        firstStream: Promise.resolve(stream),
        audioContext: audioContext() || undefined,
        onSegment: (audio, meta) => segmentRef.current(audio, meta),
        onProbability: (p) => {
          const now = performance.now()
          if (now - lastProbAt < PROB_THROTTLE_MS) return
          lastProbAt = now
          setInfo(i => ({ ...i, prob: p }))
        },
        onError: (err) => {
          console.error('[voice] capture error:', err.message)
          setInfo(i => ({ ...i, error: micErrorReason(err) }))
          machine.disable()
        },
      }))
      .then(voice => {
        if (cancelled) { voice.destroy(); return }
        voiceRef.current = voice
        machine.enable() // → listening → setCapture(true), unless a reply is being spoken
      })
      .catch(err => {
        if (cancelled) return
        const reason = micErrorReason(err)
        console.warn('[voice] mic unavailable, typed input only:', reason)
        setInfo(i => ({ ...i, error: reason }))
        machine.disable()
      })
    return () => {
      cancelled = true
      voiceRef.current?.destroy()
      voiceRef.current = null
      machine.dispose()
    }
  }, [micStream, machine])

  /* ── Speaking ended (lifecycle left 'speaking' and no other reply is loading) → cooldown ── */
  const prevPhase = useRef(phase)
  useEffect(() => {
    if (prevPhase.current === 'speaking' && phase !== 'speaking' && pendingSaysRef.current === 0) machine.speakEnd()
    prevPhase.current = phase
  }, [phase, machine, pendingSaysRef])

  const speakStart = useCallback(() => machine.speakStart(), [machine])
  /** A say() was superseded or never reached the screen: end speaking if nothing else is playing. */
  const speakAbandoned = useCallback((currentPhase) => {
    if (pendingSaysRef.current === 0 && currentPhase !== 'speaking') machine.speakEnd()
  }, [machine, pendingSaysRef])

  return { micState: state, micInfo: info, micUnavailable: !!info.error && state === MIC.OFF, speakStart, speakAbandoned }
}
