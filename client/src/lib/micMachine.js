/**
 * Mic state machine (FR-4.2.4): LISTENING → PROCESSING → SPEAKING (mic stopped) → COOLDOWN 3.0 s → LISTENING.
 *
 * off         no mic (not started, permission denied, no device): typed input only
 * listening   the only state that captures; a finished speech segment moves on to processing
 * processing  segment sent for transcription + reply; capture stopped
 * speaking    any reply (voice, typed, broadcast, routine, voice test) is being spoken; capture stopped
 * cooldown    COOLDOWN_MS after speaking ends; capture stopped
 *
 * `onCapture(enabled)` is called whenever capture must start or stop (true only on entering
 * listening). Framework-free with injected timers so it can be unit tested.
 */

export const COOLDOWN_MS = 3000

export const MIC = Object.freeze({
  OFF: 'off',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
  COOLDOWN: 'cooldown',
})

export function createMicMachine({ onChange, onCapture, cooldownMs = COOLDOWN_MS } = {}) {
  let state = MIC.OFF
  let available = false // mic granted
  let cooldownTimer = null

  const set = (next) => {
    if (next === state) return
    const wasCapturing = state === MIC.LISTENING
    state = next
    const capturing = state === MIC.LISTENING
    if (capturing !== wasCapturing) onCapture?.(capturing)
    onChange?.(state)
  }

  const clearCooldown = () => {
    clearTimeout(cooldownTimer)
    cooldownTimer = null
  }

  return {
    get state() { return state },

    /** Only true while listening: anything heard in any other state is dropped. */
    canCapture: () => state === MIC.LISTENING,

    /** Mic granted: start listening (unless a reply is being spoken right now). */
    enable() {
      available = true
      if (state === MIC.OFF) set(MIC.LISTENING)
    },

    /** Mic lost or denied. */
    disable() {
      available = false
      clearCooldown()
      set(MIC.OFF)
    },

    /** A speech segment ended. Returns true when it should be processed, false when it must be dropped. */
    speechEnded() {
      if (state !== MIC.LISTENING) return false
      set(MIC.PROCESSING)
      return true
    },

    /** Processing finished without a spoken reply (no speech, junk transcript, error). */
    processingDone() {
      if (state === MIC.PROCESSING) set(MIC.LISTENING)
    },

    /** Any reply starts being spoken (or is about to: TTS is loading). */
    speakStart() {
      clearCooldown()
      if (!available) return
      set(MIC.SPEAKING)
    },

    /** Speaking finished: cooldown, then listen again. */
    speakEnd() {
      if (state !== MIC.SPEAKING) return
      set(MIC.COOLDOWN)
      cooldownTimer = setTimeout(() => {
        cooldownTimer = null
        if (state === MIC.COOLDOWN) set(MIC.LISTENING)
      }, cooldownMs)
    },

    dispose() {
      clearCooldown()
    },
  }
}
