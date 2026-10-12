import { Component, useState, useEffect, useCallback, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import './i18n'
import './index.css'

import { useSocket } from './hooks/useSocket'
import { useReplyLifecycle } from './hooks/useReplyLifecycle'
import { useVoiceLoop } from './hooks/useVoiceLoop'
import { terminalFetch } from './lib/terminalApi'
import { replyTextOf } from './lib/replyLifecycle'
import { speak, unlockAudio } from './lib/speaker'
import { requestMic } from './lib/voiceInput'

import StartGate from './components/StartGate'
import Home      from './pages/Home'
import Pairing   from './pages/Pairing'
import TerminalStage from './components/TerminalStage'
import MeshBackground from './components/MeshBackground'
import Header from './components/Header'

const API = import.meta.env.VITE_API_URL || ''

/* ?dev=1 pins the typed input + debug overlay open (tablet has no keyboard).
   Read once at load, before the catch-all redirect drops the query string. */
const DEV_MODE = new URLSearchParams(window.location.search).get('dev') === '1'

/* ` toggles typed input, ~ (Shift+`) toggles debug overlay; ignored while typing in a field */
function useDevShortcuts() {
  const [typedOpen, setTypedOpen] = useState(DEV_MODE)
  const [debugOpen, setDebugOpen] = useState(DEV_MODE)

  useEffect(() => {
    if (DEV_MODE) return
    const handler = (e) => {
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (e.code !== 'Backquote' && e.key !== '`' && e.key !== '~') return
      e.preventDefault()
      if (e.shiftKey || e.key === '~') setDebugOpen(v => !v)
      else setTypedOpen(v => !v)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return { typedOpen, setTypedOpen, debugOpen }
}

export default function App() {
  const { t } = useTranslation()
  // Start gate on every load: audio (and the mic) need a real user gesture per page session.
  const [started,     setStarted]     = useState(false)
  const [deviceToken, setDeviceToken] = useState(() => localStorage.getItem('device_token') || null)
  const [patientId,   setPatientId]   = useState(() => localStorage.getItem('patient_id') || null)
  const [language,    setLanguage]    = useState(() => localStorage.getItem('terminal_language') || 'en')
  const [pairingCode, setPairingCode] = useState(null)
  const [regLoading, setRegLoading]  = useState(false)
  const [regError,   setRegError]   = useState(null)
  const [context,    setContext]     = useState(null)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [volumeDb,      setVolumeDb]      = useState(65)
  const [ttsError,      setTtsError]      = useState(null) // dev overlay: why the last reply used browser speech
  const [micStream,     setMicStream]     = useState(null) // Promise<MediaStream>, requested inside the Start tap
  const navigateRef = useRef(null)

  const { socket } = useSocket(deviceToken)

  /* ── One reply path (via say below): typed/voice (/api/respond, response:ready), broadcast, routine, voice test ── */
  const { phase, reply, presentReply: present, highlightIndex } = useReplyLifecycle({
    playbackSpeed,
    fallbackText: t('response.noText'),
  })
  const presentReply = useCallback(({ text, parts, audioEl, speech, source, playbackSpeed: speed }) => {
    const id = present({ text, parts, audioEl, speech, source, ...(speed ? { playbackSpeed: speed } : {}) })
    // The reply is shown on the home screen; leave the pairing screen if it is open.
    if (id && window.location.pathname !== '/terminal') navigateRef.current?.('/terminal')
    return id
  }, [present])

  /* ── Mic: VAD → server STT → reply; muted while anything is spoken + 3.0 s cooldown (FR-4.2.4) ── */
  const sayRef = useRef(null)
  const pendingSaysRef = useRef(0)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const { micState, micInfo, micUnavailable, speakStart, speakAbandoned } =
    useVoiceLoop({ micStream, phase, sayRef, pendingSaysRef })

  /* ── Speak + show: ElevenLabs via /api/tts on the shared <audio>, else browser speech ── */
  const voiceRef = useRef({})
  voiceRef.current = { deviceToken, language, playbackSpeed, volumeDb, noText: t('response.noText') }
  const say = useCallback(async ({ text, parts, source, playbackSpeed: speed }) => {
    const v = voiceRef.current
    const shown = replyTextOf({ text, parts }) || v.noText
    pendingSaysRef.current++
    speakStart() // mic stops before the first sound
    let result
    try {
      result = await speak(shown, {
        deviceToken:   v.deviceToken,
        language:      v.language,
        playbackSpeed: speed || v.playbackSpeed,
        volumeDb:      v.volumeDb,
      })
    } finally {
      pendingSaysRef.current--
    }
    if (result.mode === 'cancelled') {
      speakAbandoned(phaseRef.current)
      return null
    }
    if (result.mode === 'audio') {
      setTtsError(null)
      return presentReply({ text: shown, source, audioEl: result.audioEl })
    }
    console.warn('tts fallback to browser speech:', result.reason)
    setTtsError(result.reason)
    return presentReply({ text: shown, source, speech: result.speech || undefined, playbackSpeed: speed })
  }, [presentReply, speakStart, speakAbandoned])
  sayRef.current = say

  /* ── Start gate ── */
  const handleStart = useCallback(() => {
    unlockAudio() // synchronously inside the tap
    const mic = requestMic() // also inside the tap (iOS needs the gesture)
    mic.catch(() => {}) // handled in useVoiceLoop
    setMicStream(mic)
    setStarted(true)
    emitDeviceStatus(true)
  }, [])

  /* ── Register device → get pairing code ── */
  const handleRegisterDevice = useCallback(async () => {
    setRegLoading(true)
    setRegError(null)
    const deviceId = localStorage.getItem('device_id') || crypto.randomUUID()
    localStorage.setItem('device_id', deviceId)
    try {
      let res
      try {
        res = await fetch(`${API}/api/devices/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_id: deviceId }),
        })
      } catch (netErr) {
        throw new Error(`register failed: network (${netErr.message})`)
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(`register failed: ${res.status}${err.code || err.error ? ` (${err.code || err.error})` : ''}`)
      }
      const data = await res.json()
      setPairingCode(data.code)
      localStorage.setItem('device_token', data.device_token)
      setDeviceToken(data.device_token)
    } catch (e) {
      console.error(e)
      setRegError(e.message || 'register failed')
    } finally {
      setRegLoading(false)
    }
  }, [])

  /* ── Send device:status ── */
  const emitDeviceStatus = useCallback((online, battery) => {
    if (!socket) return
    socket.emit('device:status', { online, battery })
  }, [socket])

  /* ── On device:paired ── */
  useEffect(() => {
    if (!socket) return
    const onPair = async (payload) => {
      localStorage.setItem('patient_id', payload.patient_id)
      setPatientId(payload.patient_id)
      try {
        const p = await terminalFetch('/api/patients/me')
        if (p?.language) {
          localStorage.setItem('terminal_language', p.language)
          setLanguage(p.language)
        }
      } catch (e) {
        console.error('patients/me failed:', e.message)
      }
      setPairingCode(null)
    }
    socket.on('device:paired', onPair)
    return () => socket.off('device:paired', onPair)
  }, [socket])

  /* ── context:sync (also carries the patient's language) ── */
  useEffect(() => {
    if (!socket) return
    const onSync = (body) => {
      setContext(body)
      const lang = body?.payload?.language
      if (lang === 'id' || lang === 'en') setLanguage(lang)
    }
    socket.on('context:sync', onSync)
    return () => socket.off('context:sync', onSync)
  }, [socket])

  /* ── settings:sync — playback_speed feeds the speaking-duration estimate ── */
  useEffect(() => {
    if (!socket) return
    const onSettings = ({ payload } = {}) => {
      const speed = Number(payload?.playback_speed)
      if (speed > 0) setPlaybackSpeed(speed)
      const vol = Number(payload?.volume_db)
      if (vol >= 60 && vol <= 70) setVolumeDb(vol)
    }
    socket.on('settings:sync', onSettings)
    return () => socket.off('settings:sync', onSettings)
  }, [socket])

  /* ── Server → terminal replies, all through presentReply ── */
  useEffect(() => {
    if (!socket) return
    const onResponse = (payload = {}) => say({ text: payload.text, parts: payload.parts, source: payload.source })
    // caregiver's typed/dictated message
    const onBroadcast = ({ text } = {}) => text && say({ text, source: 'broadcast' })
    const onRoutine = ({ audio_script } = {}) => audio_script && say({ text: audio_script, source: 'routine' })
    // Settings "Test Voice": the server already applies the saved voice/speed in /api/tts
    const onVoiceTest = ({ text, playback_speed } = {}) =>
      text && say({ text, source: 'voice_test', playbackSpeed: Number(playback_speed) || undefined })

    socket.on('response:ready', onResponse)
    socket.on('broadcast:message', onBroadcast)
    socket.on('routine:trigger', onRoutine)
    socket.on('voice:test', onVoiceTest)
    return () => {
      socket.off('response:ready', onResponse)
      socket.off('broadcast:message', onBroadcast)
      socket.off('routine:trigger', onRoutine)
      socket.off('voice:test', onVoiceTest)
    }
  }, [socket, say])

  /* ── Battery watcher ── */
  useEffect(() => {
    if (!started) return
    const watch = () => {
      if (navigator.getBattery) {
        navigator.getBattery().then(b => emitDeviceStatus(true, Math.round(b.level * 100)))
      } else {
        emitDeviceStatus(true)
      }
    }
    watch()
    const id = setInterval(watch, 60_000)
    return () => clearInterval(id)
  }, [started, emitDeviceStatus])

  /* StartGate uses the full viewport, not the terminal stage */
  if (!started) {
    return (
      <BrowserRouter>
        <StartGate onStart={handleStart} language={language} />
      </BrowserRouter>
    )
  }

  return (
    <BrowserRouter>
      <TerminalRoutes
        language={language}
        pairingCode={pairingCode}
        onEnterCaregiver={handleRegisterDevice}
        regLoading={regLoading}
        regError={regError}
        context={context}
        phase={phase}
        reply={reply}
        highlightIndex={highlightIndex}
        say={say}
        ttsError={ttsError}
        micState={micState}
        micInfo={micInfo}
        micUnavailable={micUnavailable}
        navigateRef={navigateRef}
        socket={socket}
        deviceToken={deviceToken}
        patientId={patientId}
      />
    </BrowserRouter>
  )
}

/* ── Routes sub-component (inside BrowserRouter) ── */
function TerminalRoutes({ language, pairingCode, onEnterCaregiver, regLoading, regError, context, phase, reply, highlightIndex, say, ttsError, micState, micInfo, micUnavailable, navigateRef, socket, deviceToken, patientId }) {
  const navigate = useNavigate()
  const { typedOpen, setTypedOpen, debugOpen } = useDevShortcuts()
  // No microphone (denied / missing): the typed input is the way to talk to the terminal.
  const showTyped = typedOpen || micUnavailable

  useEffect(() => {
    navigateRef.current = navigate
  }, [navigate])

  return (
    <>
      <TerminalErrorBoundary onHome={() => navigate('/terminal', { replace: true })}>
      <Routes>
        <Route
          path="/terminal"
          element={
            <Home
              language={language}
              pairingCode={pairingCode}
              onEnterCaregiver={onEnterCaregiver}
              regLoading={regLoading}
              regError={regError}
              phase={phase}
              reply={reply}
              highlightIndex={highlightIndex}
              typedSlot={showTyped && (
                <TypedUtterance onReply={say} onClose={DEV_MODE || micUnavailable ? null : () => setTypedOpen(false)} />
              )}
            />
          }
        />
        <Route
          path="/terminal/pairing"
          element={
            <TerminalStage>
              <MeshBackground opacity={0.88} />
              <Header language={language} />
              <Pairing
                code={pairingCode}
                language={language}
                onRegenerate={onEnterCaregiver}
              />
            </TerminalStage>
          }
        />
        {/* TODO(clock): clock mode screen removed for now (see Clock.jsx in git history, before this commit) */}
        <Route path="*" element={<Navigate to="/terminal" replace />} />
      </Routes>
      </TerminalErrorBoundary>

      {/* Debug overlay (~ key, or ?dev=1) */}
      {debugOpen && (
        <DebugOverlay
          socket={socket}
          phase={phase}
          language={language}
          deviceToken={deviceToken}
          patientId={patientId}
          context={context}
          ttsError={ttsError}
          micState={micState}
          micInfo={micInfo}
        />
      )}
    </>
  )
}

/* ── Hidden typed-utterance input ──
   Rendered inside the stage (Home's typedSlot), just under the header, so it never covers the reply box. */
const TYPED_BOX = { left: (1194 - 600) / 2, top: 140, width: 600 }

function TypedUtterance({ onReply, onClose }) {
  const { t } = useTranslation()
  const inp = useRef(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    inp.current?.focus()
  }, [])

  const handleSubmit = async (transcript) => {
    if (!transcript.trim()) return
    setError(null)
    try {
      const data = await terminalFetch('/api/respond', {
        method: 'POST',
        body: JSON.stringify({ transcript, source: 'typed' }),
      })
      setValue('')
      onReply({ text: data?.text, parts: data?.parts, source: 'typed' })
    } catch (e) {
      console.error('respond failed:', e.message)
      if (e.code === 'no_device_token') setError(t('notRegistered'))
      else setError(import.meta.env.DEV ? `respond failed: ${e.message}` : t('error'))
    }
  }

  return (
    <div style={{ position: 'absolute', ...TYPED_BOX, zIndex: 30 }}>
      <input
        ref={inp}
        className="w-full px-4 py-2 rounded-lg bg-black/45 text-white placeholder-white/60 border border-white/40 text-lg"
        placeholder="Type an utterance, Enter to send"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') handleSubmit(value)
          if (e.key === 'Escape' && onClose) onClose()
        }}
        aria-label="Typed utterance"
      />
      {error && (
        <div className="mt-2 px-4 py-2 rounded-lg bg-red-800/90 text-white text-base" role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

/* ── Error boundary: friendly message + back to home instead of a blank screen ── */
class TerminalErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('terminal render error:', error, info.componentStack)
  }

  handleHome = () => {
    this.setState({ error: null })
    this.props.onHome()
  }

  render() {
    if (!this.state.error) return this.props.children
    return <TerminalErrorScreen onHome={this.handleHome} />
  }
}

function TerminalErrorScreen({ onHome }) {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-8 bg-[#052846] text-white p-8 text-center">
      <p className="text-4xl font-extrabold">{t('errorBoundary.message')}</p>
      <button
        type="button"
        onClick={onHome}
        className="px-10 py-5 rounded-2xl bg-white text-[#052846] text-3xl font-bold"
      >
        {t('errorBoundary.home')}
      </button>
    </div>
  )
}

/* ── Debug overlay ── */
function DebugOverlay({ socket, phase, language, deviceToken, patientId, context, ttsError, micState, micInfo }) {
  const location = useLocation()
  const [connected, setConnected] = useState(!!socket?.connected)

  useEffect(() => {
    if (!socket) return
    const update = () => setConnected(socket.connected)
    update()
    socket.on('connect', update)
    socket.on('disconnect', update)
    return () => {
      socket.off('connect', update)
      socket.off('disconnect', update)
    }
  }, [socket])

  const rows = [
    ['route',   location.pathname],
    ['socket',  connected ? 'connected' : 'disconnected'],
    ['reply',   phase],
    ['lang',    language],
    ['token',   deviceToken ? 'yes' : 'no'],
    ['patient', patientId || '-'],
    ['context', context ? 'synced' : '-'],
    ['dev=1',   DEV_MODE ? 'on' : 'off'],
    ['voice',   ttsError ? 'browser speech' : 'elevenlabs'],
    ['mic',     micState],
    ['vad p',   (micInfo?.prob ?? 0).toFixed(2)],
    ['heard',   micInfo?.transcript ? `"${micInfo.transcript}"` : '-'],
  ]
  const tm = micInfo?.timings
  if (tm) {
    rows.push(['ms', tm.noSpeech
      ? `seg ${tm.segmentMs} · vad→stt ${tm.vadToTranscriptMs} (stt ${tm.sttMs}) · no speech`
      : `seg ${tm.segmentMs} · vad→transcript ${tm.vadToTranscriptMs} (stt ${tm.sttMs}) · →reply ${tm.transcriptToReplyMs} · →audio ${tm.replyToAudioMs} · total ${tm.totalMs}`])
  }

  return (
    <div
      className="fixed bottom-2 left-2 max-w-[255px] px-3 py-2 rounded bg-black/70 text-white font-mono text-xs pointer-events-none break-words"
      style={{ zIndex: 1000 }}
      aria-hidden="true"
    >
      {rows.map(([k, v]) => (
        <div key={k}><span className="opacity-60">{k}</span> {v}</div>
      ))}
      {ttsError && <div className="text-red-300 whitespace-normal">tts: {ttsError}</div>}
      {micInfo?.error && <div className="text-red-300 whitespace-normal">mic: {micInfo.error}</div>}
    </div>
  )
}
