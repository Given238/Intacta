/**
 * Reply lifecycle for the terminal's single screen: idle → speaking → holding → idle.
 *
 * idle      greeting shown
 * speaking  reply shown, waveform moving, word highlight advancing (audio duration, or estimated)
 * holding   reply stays on screen HOLD_MS after speaking ends, then back to idle
 *
 * A new reply replaces the current one at any phase: every pending timer and audio
 * listener of the old one is cancelled first.
 *
 * Framework-free so it can be unit tested with fake timers; useReplyLifecycle wraps it for React.
 */

/** How long a reply stays on screen after speaking ends. */
export const HOLD_MS = 8000

/** Speech rate used to estimate duration when no audio is available (words per second). */
export const WORDS_PER_SECOND = 2.5

/** Padding added to the estimated duration. */
export const ESTIMATE_PAD_MS = 500

/** Server shape {text, parts[]} → display text ('' when there is nothing usable). */
export function replyTextOf({ text, parts } = {}) {
  if (typeof text === 'string' && text.trim()) return text.trim()
  if (Array.isArray(parts)) return parts.filter(p => typeof p === 'string' && p.trim()).join(' ').trim()
  return ''
}

export function splitWords(text) {
  return String(text || '').split(/\s+/).filter(Boolean)
}

/** words / 2.5 per second, divided by playback_speed, plus 0.5 s. */
export function estimateSpeechMs(wordCount, playbackSpeed = 1) {
  const speed = Number(playbackSpeed) > 0 ? Number(playbackSpeed) : 1
  return Math.round((wordCount / WORDS_PER_SECOND) * 1000 / speed + ESTIMATE_PAD_MS)
}

/**
 * @param {object}   opts
 * @param {function} opts.onChange      called with the new snapshot on every transition
 * @param {number}  [opts.holdMs]
 * @param {function}[opts.now]          clock (ms), injectable for tests
 */
export function createReplyLifecycle({ onChange, holdMs = HOLD_MS, now = () => Date.now() } = {}) {
  let snapshot = { phase: 'idle', reply: null }
  let seq = 0
  let timer = null
  let detachAudio = null

  const emit = (next) => {
    snapshot = next
    onChange?.(snapshot)
  }

  const cancel = () => {
    clearTimeout(timer)
    timer = null
    detachAudio?.()
    detachAudio = null
  }

  const toIdle = (id) => {
    if (snapshot.reply?.id !== id) return
    cancel()
    emit({ phase: 'idle', reply: null })
  }

  const endSpeaking = (id) => {
    if (snapshot.reply?.id !== id || snapshot.phase !== 'speaking') return
    cancel()
    emit({ phase: 'holding', reply: snapshot.reply })
    timer = setTimeout(() => toIdle(id), holdMs)
  }

  /**
   * @param {object} reply
   * @param {string} reply.text
   * @param {string[]} [reply.parts]
   * @param {HTMLAudioElement} [reply.audioEl]  speaking lasts until it ends
   * @param {number} [reply.playbackSpeed]      for the estimate when there is no audio
   * @param {string} [reply.fallbackText]       shown when text and parts are empty
   * @returns {number|null} reply id, or null when there is nothing to show
   */
  const present = ({ text, parts, audioEl, playbackSpeed = 1, fallbackText = '', source } = {}) => {
    const shown = replyTextOf({ text, parts }) || fallbackText
    if (!shown) return null
    cancel()
    const id = ++seq
    const words = splitWords(shown)
    let durationMs = estimateSpeechMs(words.length, playbackSpeed)

    if (audioEl) {
      const known = Number.isFinite(audioEl.duration) && audioEl.duration > 0
      if (known) durationMs = Math.round(audioEl.duration * 1000)
      const onEnd = () => endSpeaking(id)
      audioEl.addEventListener('ended', onEnd)
      audioEl.addEventListener('error', onEnd)
      detachAudio = () => {
        audioEl.removeEventListener('ended', onEnd)
        audioEl.removeEventListener('error', onEnd)
      }
      // Safety net: never stay "speaking" forever if the element stalls.
      timer = setTimeout(onEnd, Math.max(durationMs, estimateSpeechMs(words.length, playbackSpeed)) * 2 + 2000)
    } else {
      timer = setTimeout(() => endSpeaking(id), durationMs)
    }

    emit({
      phase: 'speaking',
      reply: { id, text: shown, words, source, audioEl: audioEl || null, startedAt: now(), durationMs },
    })
    return id
  }

  /** Word index to highlight (−1 before the first) for the current reply. */
  const highlightIndex = (at = now()) => {
    const r = snapshot.reply
    if (!r) return -1
    if (snapshot.phase !== 'speaking') return r.words.length - 1
    let fraction
    const a = r.audioEl
    if (a && Number.isFinite(a.duration) && a.duration > 0) fraction = a.currentTime / a.duration
    else fraction = (at - r.startedAt) / r.durationMs
    return Math.min(r.words.length - 1, Math.floor(Math.max(0, fraction) * r.words.length))
  }

  return {
    present,
    highlightIndex,
    getSnapshot: () => snapshot,
    dispose: cancel,
  }
}
