/**
 * QR scanning for the pair screen ("Scan QR code"): camera + decoder + lifecycle, no React (tested with mocks).
 *
 * Camera: getUserMedia({video: {facingMode: environment}}), never audio. Frames are only read in memory to find a
 * QR code: nothing is recorded, stored or uploaded. stop() ends EVERY track (close, success, unmount), also when it
 * runs before the camera has started.
 * Decoder: the native BarcodeDetector when it reads QR codes, else @zxing/browser, loaded with a dynamic import only
 * when the scanner opens (the pair page stays light).
 * A frame is checked every `intervalMs`. A valid payload (portal/pairCode parseScannedCode: our own host's
 * /portal/pair?code=XXXXXX or a bare 6-character code) stops the camera FIRST, then calls onCode(code). Anything else
 * calls onInvalid() (at most once per `invalidQuietMs`) and scanning goes on.
 * Problems → onError(kind): insecure | unsupported | denied | noCamera | error.
 */
import { parseScannedCode } from './pairCode'

/** getUserMedia error → what the sheet tells the caregiver. */
export function cameraErrorKind(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'noCamera'
    default:
      return 'error'
  }
}

/** Native BarcodeDetector when it supports QR, else zxing (dynamic import). → {detect(video) → Promise<string|null>} */
export async function loadDetector(win = globalThis) {
  const Native = win.BarcodeDetector
  if (Native) {
    try {
      const formats = await Native.getSupportedFormats?.()
      if (!formats || formats.includes('qr_code')) {
        const detector = new Native({ formats: ['qr_code'] })
        return {
          kind: 'native',
          detect: async (video) => (await detector.detect(video))[0]?.rawValue ?? null,
        }
      }
    } catch { /* fall back to zxing */ }
  }
  const { BrowserQRCodeReader } = await import('@zxing/browser')
  const reader = new BrowserQRCodeReader()
  const canvas = win.document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  return {
    kind: 'zxing',
    detect: async (video) => {
      const w = video.videoWidth
      const h = video.videoHeight
      if (!w || !h) return null
      canvas.width = w
      canvas.height = h
      ctx.drawImage(video, 0, 0, w, h)
      try {
        return reader.decodeFromCanvas(canvas).getText()
      } catch {
        return null // no QR code in this frame
      }
    },
  }
}

/**
 * @param {object} o
 * @param {HTMLVideoElement} o.video
 * @param {(code: string) => void} o.onCode
 * @param {() => void} [o.onInvalid]
 * @param {(kind: string) => void} [o.onError]
 * @param {() => void} [o.onStarted]   the preview is live (torchSupported() is known)
 * @param {object} [o.env]  {mediaDevices, isSecureContext, hostname, loadDetector, setTimeout, clearTimeout} (tests)
 */
export function createScanner({ video, onCode, onInvalid, onError, onStarted, intervalMs = 250, invalidQuietMs = 2500, env = {} }) {
  const mediaDevices = 'mediaDevices' in env ? env.mediaDevices : globalThis.navigator?.mediaDevices
  const secure = 'isSecureContext' in env ? env.isSecureContext : globalThis.isSecureContext !== false
  const hostname = env.hostname ?? globalThis.location?.hostname
  const load = env.loadDetector || (() => loadDetector())
  const later = env.setTimeout || setTimeout
  const cancel = env.clearTimeout || clearTimeout

  let stream = null
  let timer = null
  let stopped = false
  let lastInvalid = -Infinity
  let torchOn = false

  const track = () => stream?.getVideoTracks?.()[0] || null

  function stop() {
    stopped = true
    if (timer != null) cancel(timer)
    timer = null
    stream?.getTracks().forEach(t => t.stop())
    stream = null
    if (video) {
      try { video.pause?.() } catch { /* ignore */ }
      video.srcObject = null
    }
  }

  async function start() {
    if (!secure) return onError?.('insecure')
    if (!mediaDevices?.getUserMedia) return onError?.('unsupported')
    let detector
    try {
      detector = await load()
    } catch {
      return stopped ? undefined : onError?.('unsupported')
    }
    if (stopped) return
    let s
    try {
      s = await mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    } catch (err) {
      return stopped ? undefined : onError?.(cameraErrorKind(err))
    }
    if (stopped) { s.getTracks().forEach(t => t.stop()); return } // closed while the permission prompt was open
    stream = s
    video.srcObject = s
    video.setAttribute?.('playsinline', '') // iOS: no fullscreen takeover
    video.muted = true
    try { await video.play() } catch { /* autoplay of a muted inline video: ignore, frames still arrive */ }
    if (stopped) return
    onStarted?.()

    const tick = async () => {
      timer = null
      if (stopped) return
      let text = null
      try { text = await detector.detect(video) } catch { text = null }
      if (stopped) return
      if (text != null) {
        const code = parseScannedCode(text, hostname)
        if (code) {
          stop() // the camera goes off before anything else happens
          onCode(code)
          return
        }
        const now = Date.now()
        if (now - lastInvalid >= invalidQuietMs) { lastInvalid = now; onInvalid?.() }
      }
      timer = later(tick, intervalMs)
    }
    timer = later(tick, intervalMs)
  }

  /** Flashlight: only when the camera track says it has one. */
  function torchSupported() {
    try { return Boolean(track()?.getCapabilities?.().torch) } catch { return false }
  }

  async function setTorch(on) {
    const t = track()
    if (!t || !torchSupported()) return false
    try {
      await t.applyConstraints({ advanced: [{ torch: !!on }] })
      torchOn = !!on
      return true
    } catch {
      return false
    }
  }

  return { start, stop, torchSupported, setTorch, isTorchOn: () => torchOn, isStopped: () => stopped }
}
