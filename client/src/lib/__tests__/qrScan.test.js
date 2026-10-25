/**
 * Camera lifecycle of the pair screen's QR scanner (portal/qrScan.js), with a mocked camera and decoder:
 * every track stops on close, on a valid scan (before onCode) and on unmount (also mid-permission-prompt);
 * errors are classified; a non-Intacta code keeps scanning.
 */
import { describe, it, expect, vi } from 'vitest'
import { createScanner, cameraErrorKind } from '../../portal/qrScan'

function fakeStream({ torch = false } = {}) {
  const track = {
    stop: vi.fn(),
    getCapabilities: () => (torch ? { torch: true } : {}),
    applyConstraints: vi.fn(async () => {}),
  }
  return { track, stream: { getTracks: () => [track], getVideoTracks: () => [track] } }
}

function fakeVideo() {
  return { play: vi.fn(async () => {}), pause: vi.fn(), setAttribute: vi.fn(), srcObject: null, muted: false }
}

// Manual timers: tick() runs the next scheduled frame check
function harness({ frames = [], gum, torch = false, env = {} } = {}) {
  const { track, stream } = fakeStream({ torch })
  const queue = [...frames]
  let scheduled = null
  const video = fakeVideo()
  const onCode = vi.fn()
  const onInvalid = vi.fn()
  const onError = vi.fn()
  const onStarted = vi.fn()
  const getUserMedia = gum || vi.fn(async () => stream)
  const scanner = createScanner({
    video, onCode, onInvalid, onError, onStarted, invalidQuietMs: 0,
    env: {
      mediaDevices: { getUserMedia },
      isSecureContext: true,
      hostname: 'intacta.id',
      loadDetector: async () => ({ detect: async () => (queue.length ? queue.shift() : null) }),
      setTimeout: (fn) => { scheduled = fn; return 1 },
      clearTimeout: () => { scheduled = null },
      ...env,
    },
  })
  const tick = async () => { const fn = scheduled; scheduled = null; await fn?.() }
  return { scanner, track, stream, video, onCode, onInvalid, onError, onStarted, getUserMedia, tick, pending: () => scheduled != null }
}

describe('QR scanner camera lifecycle', () => {
  it('asks for the rear camera only (no audio) and shows the preview', async () => {
    const h = harness()
    await h.scanner.start()
    expect(h.getUserMedia).toHaveBeenCalledWith({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    expect(h.video.srcObject).toBe(h.stream)
    expect(h.onStarted).toHaveBeenCalled()
  })

  it('close: every track stops and the preview is cleared', async () => {
    const h = harness()
    await h.scanner.start()
    h.scanner.stop()
    expect(h.track.stop).toHaveBeenCalled()
    expect(h.video.srcObject).toBeNull()
    expect(h.pending()).toBe(false)
  })

  it('a valid scan stops the camera BEFORE onCode, and scanning ends', async () => {
    const h = harness({ frames: [null, 'https://intacta.id/portal/pair?code=ab23cd'] })
    h.onCode.mockImplementation(() => expect(h.track.stop).toHaveBeenCalled())
    await h.scanner.start()
    await h.tick() // no QR in the first frame
    expect(h.onCode).not.toHaveBeenCalled()
    await h.tick()
    expect(h.onCode).toHaveBeenCalledWith('AB23CD')
    expect(h.scanner.isStopped()).toBe(true)
    expect(h.pending()).toBe(false)
  })

  it('a code from another site shows "not an Intacta code" and keeps scanning', async () => {
    const h = harness({ frames: ['https://evil.example/portal/pair?code=AB23CD', 'AB23CD'] })
    await h.scanner.start()
    await h.tick()
    expect(h.onInvalid).toHaveBeenCalledTimes(1)
    expect(h.track.stop).not.toHaveBeenCalled()
    await h.tick()
    expect(h.onCode).toHaveBeenCalledWith('AB23CD')
  })

  it('unmount while the permission prompt is open: the camera that arrives later is stopped at once', async () => {
    let grant
    const { track, stream } = fakeStream()
    const h = harness({ gum: vi.fn(() => new Promise((r) => { grant = r })) })
    const started = h.scanner.start()
    await vi.waitFor(() => expect(grant).toBeTypeOf('function'))
    h.scanner.stop() // unmount
    grant(stream)
    await started
    expect(track.stop).toHaveBeenCalled()
    expect(h.video.srcObject).toBeNull()
    expect(h.onStarted).not.toHaveBeenCalled()
  })

  it('stop() is safe before start and twice', () => {
    const h = harness()
    expect(() => { h.scanner.stop(); h.scanner.stop() }).not.toThrow()
  })

  it('flashlight only when the track has one', async () => {
    const plain = harness()
    await plain.scanner.start()
    expect(plain.scanner.torchSupported()).toBe(false)
    expect(await plain.scanner.setTorch(true)).toBe(false)

    const lit = harness({ torch: true })
    await lit.scanner.start()
    expect(lit.scanner.torchSupported()).toBe(true)
    expect(await lit.scanner.setTorch(true)).toBe(true)
    expect(lit.track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] })
  })
})

describe('QR scanner errors', () => {
  it.each([
    ['NotAllowedError', 'denied'], ['SecurityError', 'denied'], ['NotFoundError', 'noCamera'],
    ['OverconstrainedError', 'noCamera'], ['NotReadableError', 'error'],
  ])('%s → %s', async (name, kind) => {
    expect(cameraErrorKind({ name })).toBe(kind)
    const h = harness({ gum: vi.fn(async () => { throw Object.assign(new Error('x'), { name }) }) })
    await h.scanner.start()
    expect(h.onError).toHaveBeenCalledWith(kind)
  })

  it('insecure page (http) → insecure, the camera is never requested', async () => {
    const h = harness({ env: { isSecureContext: false } })
    await h.scanner.start()
    expect(h.onError).toHaveBeenCalledWith('insecure')
    expect(h.getUserMedia).not.toHaveBeenCalled()
  })

  it('no getUserMedia, or no decoder → unsupported', async () => {
    const noMedia = harness({ env: { mediaDevices: undefined } })
    await noMedia.scanner.start()
    expect(noMedia.onError).toHaveBeenCalledWith('unsupported')

    const noDecoder = harness({ env: { loadDetector: async () => { throw new Error('import failed') } } })
    await noDecoder.scanner.start()
    expect(noDecoder.onError).toHaveBeenCalledWith('unsupported')
    expect(noDecoder.getUserMedia).not.toHaveBeenCalled()
  })
})
