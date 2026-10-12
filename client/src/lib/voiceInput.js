/**
 * voiceInput — microphone + Silero VAD (@ricky0123/vad-web) cutting speech segments.
 *
 * requestMic() must be called inside the Start tap (user gesture). createVoiceInput() wraps MicVAD;
 * setCapture(true|false) starts/stops capture, serialized so rapid toggles cannot interleave. Stopping
 * capture stops the mic tracks (nothing is recorded while the terminal speaks or cools down).
 * Segments arrive as 16 kHz mono Float32 audio; those under MIN_SEGMENT_MS are ignored.
 */
import { MicVAD } from '@ricky0123/vad-web'

export const MIC_CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }
export const SAMPLE_RATE = 16000
export const MIN_SEGMENT_MS = 400

const ASSET_PATH = `${import.meta.env.BASE_URL}vad/` // copied by vite-plugin-static-copy (vite.config.js)

/** getUserMedia with the terminal's constraints; rejects with a readable reason. */
export function requestMic() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(Object.assign(new Error('microphone API unavailable (needs HTTPS)'), { name: 'NotSupportedError' }))
  }
  return navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
}

/** Short reason for the dev overlay. */
export function micErrorReason(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError': return 'microphone permission denied'
    case 'NotFoundError':
    case 'OverconstrainedError': return 'no microphone found'
    case 'NotReadableError': return 'microphone busy or unavailable'
    case 'NotSupportedError': return err.message
    default: return `microphone error: ${err?.message || err}`
  }
}

/**
 * @param {object} o
 * @param {Promise<MediaStream>} o.firstStream    from requestMic() in the tap
 * @param {AudioContext} [o.audioContext]         shared context (already resumed by the tap)
 * @param {(audio: Float32Array, info: {durationMs: number, endedAt: number}) => void} o.onSegment
 * @param {(p: number) => void} [o.onProbability] per-frame speech probability
 * @param {(err: Error) => void} [o.onError]
 */
export async function createVoiceInput({ firstStream, audioContext, onSegment, onProbability, onError }) {
  let pendingFirst = firstStream
  const vad = await MicVAD.new({
    model: 'v5',
    baseAssetPath: ASSET_PATH,
    onnxWASMBasePath: ASSET_PATH,
    audioContext,
    startOnLoad: false,
    minSpeechMs: MIN_SEGMENT_MS,
    getStream: async () => {
      if (pendingFirst) {
        const s = pendingFirst
        pendingFirst = null
        return s
      }
      return navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS)
    },
    pauseStream: async (stream) => stream.getTracks().forEach(t => t.stop()),
    resumeStream: async () => navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS),
    onSpeechEnd: (audio) => {
      const durationMs = (audio.length / SAMPLE_RATE) * 1000
      if (durationMs < MIN_SEGMENT_MS) return
      onSegment(audio, { durationMs, endedAt: performance.now() })
    },
    onFrameProcessed: (probs) => onProbability?.(probs.isSpeech),
  })

  // Serialize start/pause and coalesce to the latest wanted state.
  let wanted = false
  let chain = Promise.resolve()
  const setCapture = (on) => {
    wanted = on
    chain = chain.then(async () => {
      try {
        if (wanted && !vad.listening) await vad.start()
        else if (!wanted && vad.listening) await vad.pause()
      } catch (err) {
        onError?.(err)
      }
    })
    return chain
  }

  return {
    setCapture,
    destroy: () => { wanted = false; return chain.then(() => vad.destroy()).catch(() => {}) },
  }
}
