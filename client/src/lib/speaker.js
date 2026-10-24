/**
 * speaker — the terminal's one voice output.
 *
 * One shared <audio> element plays GET /api/tts for every reply (typed, voice, broadcast,
 * voice:test, routine). It is unlocked once by the StartGate tap (unlockAudio), and its
 * MediaElementSource feeds the waveform's AnalyserNode (lib/amplitude.js).
 *
 * speak() order:
 *   1. stream: <audio src="/api/tts?text=…&token=…"> (fastest first sound)
 *   2. if the element errors: fetch the same URL with the header → blob → play
 *      (Safari can refuse a streamed response without range support; this also gives the server's reason)
 *   3. speechSynthesis in the patient's language (the caller keeps the simulated waveform)
 * A newer speak() or stopSpeaking() cancels an older one.
 */
import { analyserSource, audioContext } from './amplitude'
import { wavBlob } from './wav'

const API = import.meta.env.VITE_API_URL || ''
const START_TIMEOUT_MS = 6000

let audioEl = null
let token = 0
let objectUrl = null

export function sharedAudio() {
  if (!audioEl) {
    audioEl = new Audio()
    audioEl.crossOrigin = 'anonymous' // the analyser can only read cross-origin audio with CORS
    audioEl.preload = 'auto'
  }
  return audioEl
}

/** 60–70 dB setting → element volume 0.5–1.0 (calibrated gain, not a measured dB SPL). */
export function volumeFor(volumeDb = 65) {
  const db = Math.min(70, Math.max(60, Number(volumeDb) || 65))
  return 0.5 + ((db - 60) / 10) * 0.5
}

/**
 * Call synchronously inside the Start tap: plays silence on the shared element, resumes the
 * AudioContext (and wires the analyser) and primes speechSynthesis, so later replies may autoplay.
 * Resolves false when the browser blocked playback (no user gesture), else true.
 */
export function unlockAudio() {
  const a = sharedAudio()
  a.src = URL.createObjectURL(wavBlob(new Float32Array(800), 16000)) // 0.05 s of silence
  // false only when the browser refused playback for lack of a user gesture (NotAllowedError)
  const unlocked = Promise.resolve(a.play()).then(
    () => { a.pause(); return true },
    (err) => err?.name !== 'NotAllowedError',
  )
  const ctx = audioContext()
  ctx?.resume?.().catch(() => {})
  analyserSource(a)
  try {
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(' ')
      u.volume = 0
      window.speechSynthesis.speak(u)
    }
  } catch { /* not supported */ }
  return unlocked
}

export function ttsUrl(text, deviceToken) {
  const q = new URLSearchParams({ text })
  if (deviceToken) q.set('token', deviceToken)
  return `${API}/api/tts?${q}`
}

/** Stop whatever is playing (audio or speech synthesis) and cancel a pending speak(). */
export function stopSpeaking() {
  token++
  const a = sharedAudio()
  a.pause()
  try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
}

/** Resolves on 'playing', rejects on 'error' or after START_TIMEOUT_MS. */
function playSrc(a, src) {
  return new Promise((resolve, reject) => {
    let timer
    const done = (fn, arg) => {
      clearTimeout(timer)
      a.removeEventListener('playing', onPlaying)
      a.removeEventListener('error', onError)
      fn(arg)
    }
    const onPlaying = () => done(resolve)
    const onError = () => {
      const code = a.error?.code
      done(reject, Object.assign(new Error(`audio element error${code ? ` (media ${code})` : ''}`), { kind: 'element' }))
    }
    timer = setTimeout(() => done(reject, Object.assign(new Error('audio did not start in time'), { kind: 'timeout' })), START_TIMEOUT_MS)
    a.addEventListener('playing', onPlaying)
    a.addEventListener('error', onError)
    a.src = src
    a.play()?.catch(err => {
      // NotAllowedError (no gesture yet) never fires 'error'; AbortError means a newer src replaced this one.
      if (err?.name === 'NotAllowedError') done(reject, Object.assign(new Error('autoplay blocked (tap Start)'), { kind: 'blocked' }))
    })
  })
}

async function fetchTtsBlob(text, deviceToken) {
  const res = await fetch(ttsUrl(text), { headers: { 'x-device-token': deviceToken || '' } })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(`tts ${res.status}${body.code ? ` ${body.code}` : ''}`)
  }
  return res.blob()
}

function speechLang(language) {
  return language === 'id' ? 'id-ID' : 'en-US'
}

/**
 * Browser speech in the patient's language. Returns a handle {onEnd(cb) → detach} or null when
 * speechSynthesis is unavailable.
 */
export function speakWithSynthesis(text, { language = 'en', playbackSpeed = 1, volumeDb = 65 } = {}) {
  if (!('speechSynthesis' in window)) return null
  const synth = window.speechSynthesis
  const u = new SpeechSynthesisUtterance(text)
  u.lang = speechLang(language)
  const voice = synth.getVoices().find(v => v.lang?.replace('_', '-').toLowerCase().startsWith(language))
  if (voice) u.voice = voice
  u.rate = Number(playbackSpeed) || 1
  u.volume = volumeFor(volumeDb)
  synth.cancel()
  synth.speak(u)
  return {
    onEnd(cb) {
      u.addEventListener('end', cb)
      u.addEventListener('error', cb)
      return () => {
        u.removeEventListener('end', cb)
        u.removeEventListener('error', cb)
      }
    },
  }
}

/**
 * Speak `text`. Resolves with
 *   {mode: 'audio', audioEl, startedAt}                 ElevenLabs audio is playing
 *   {mode: 'synth', speech, reason}                     browser speech (speech null if unsupported)
 *   {mode: 'cancelled'}                                 a newer speak()/stopSpeaking() took over
 */
export async function speak(text, { deviceToken, language = 'en', playbackSpeed = 1, volumeDb = 65 } = {}) {
  const my = ++token
  const a = sharedAudio()
  a.pause()
  try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
  a.volume = volumeFor(volumeDb)
  a.playbackRate = 1 // speed is applied by ElevenLabs (voice_settings.speed)

  const reasons = []
  if (!deviceToken) reasons.push('no device token')
  else {
    try {
      await playSrc(a, ttsUrl(text, deviceToken))
      if (my !== token) return { mode: 'cancelled' }
      return { mode: 'audio', audioEl: a }
    } catch (err) {
      if (my !== token) return { mode: 'cancelled' }
      reasons.push(err.message)
      if (err.kind === 'element') {
        try {
          const blob = await fetchTtsBlob(text, deviceToken)
          if (my !== token) return { mode: 'cancelled' }
          if (objectUrl) URL.revokeObjectURL(objectUrl)
          objectUrl = URL.createObjectURL(blob)
          await playSrc(a, objectUrl)
          if (my !== token) return { mode: 'cancelled' }
          return { mode: 'audio', audioEl: a }
        } catch (err2) {
          if (my !== token) return { mode: 'cancelled' }
          reasons.push(err2.message)
        }
      }
    }
  }
  a.pause()
  const speech = speakWithSynthesis(text, { language, playbackSpeed, volumeDb })
  if (!speech) reasons.push('speechSynthesis unsupported')
  return { mode: 'synth', speech, reason: reasons.join('; ') }
}
