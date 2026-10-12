import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HOLD_MS,
  createReplyLifecycle,
  estimateSpeechMs,
  replyTextOf,
} from '../replyLifecycle'

/** Minimal HTMLAudioElement stand-in: duration, currentTime and ended/error events. */
function fakeAudio(duration = NaN) {
  const listeners = {}
  return {
    duration,
    currentTime: 0,
    addEventListener: (type, fn) => { (listeners[type] ||= new Set()).add(fn) },
    removeEventListener: (type, fn) => { listeners[type]?.delete(fn) },
    fire: (type) => listeners[type]?.forEach(fn => fn()),
    count: (type) => listeners[type]?.size || 0,
  }
}

describe('estimateSpeechMs', () => {
  it('is words / 2.5 per second / playback speed + 0.5 s', () => {
    expect(estimateSpeechMs(10)).toBe(4500)
    expect(estimateSpeechMs(10, 0.85)).toBe(Math.round(4000 / 0.85 + 500))
    expect(estimateSpeechMs(0)).toBe(500)
  })

  it('treats a missing or invalid speed as 1.0', () => {
    expect(estimateSpeechMs(5, 0)).toBe(2500)
    expect(estimateSpeechMs(5, undefined)).toBe(2500)
  })
})

describe('replyTextOf', () => {
  it('prefers text, then joined parts, else empty', () => {
    expect(replyTextOf({ text: ' Hi ', parts: ['x'] })).toBe('Hi')
    expect(replyTextOf({ parts: ['You are safe.', '', 'Let us sit.'] })).toBe('You are safe. Let us sit.')
    expect(replyTextOf({})).toBe('')
  })
})

describe('reply lifecycle', () => {
  let clock
  let changes
  let lc

  beforeEach(() => {
    vi.useFakeTimers()
    clock = 0
    changes = []
    lc = createReplyLifecycle({ onChange: s => changes.push(s), now: () => clock })
  })
  afterEach(() => {
    lc.dispose()
    vi.useRealTimers()
  })

  const advance = (ms) => { clock += ms; vi.advanceTimersByTime(ms) }
  const phase = () => lc.getSnapshot().phase

  it('starts idle with no reply', () => {
    expect(lc.getSnapshot()).toEqual({ phase: 'idle', reply: null })
  })

  it('goes speaking → holding (after the estimate) → idle (after HOLD_MS)', () => {
    // 5 words → 5 / 2.5 s + 0.5 s = 2500 ms
    lc.present({ text: 'You are safe here today.' })
    expect(phase()).toBe('speaking')
    expect(lc.getSnapshot().reply.durationMs).toBe(2500)

    advance(2499)
    expect(phase()).toBe('speaking')
    advance(1)
    expect(phase()).toBe('holding')
    expect(lc.getSnapshot().reply.text).toBe('You are safe here today.')

    advance(HOLD_MS - 1)
    expect(phase()).toBe('holding')
    advance(1)
    expect(lc.getSnapshot()).toEqual({ phase: 'idle', reply: null })
    expect(changes.map(c => c.phase)).toEqual(['speaking', 'holding', 'idle'])
  })

  it('divides the estimate by playback speed', () => {
    lc.present({ text: 'one two three four five', playbackSpeed: 0.85 })
    expect(lc.getSnapshot().reply.durationMs).toBe(estimateSpeechMs(5, 0.85))
  })

  it('a new reply mid-speech replaces the old one and cancels its timers', () => {
    const first = lc.present({ text: 'one two three four five' }) // 2500 ms
    advance(2000)
    const second = lc.present({ text: 'six seven eight nine ten eleven twelve' }) // 7 words → 3300 ms
    expect(second).not.toBe(first)
    expect(lc.getSnapshot().reply.text).toBe('six seven eight nine ten eleven twelve')

    // the first reply's speaking timer (500 ms left) must not end the second one
    advance(600)
    expect(phase()).toBe('speaking')
    advance(3300 - 600)
    expect(phase()).toBe('holding')
    expect(lc.getSnapshot().reply.id).toBe(second)
  })

  it('a new reply during holding restarts speaking and the old hold timer never fires', () => {
    lc.present({ text: 'one two three four five' })
    advance(2500 + HOLD_MS - 100) // 100 ms before returning to idle
    expect(phase()).toBe('holding')
    lc.present({ text: 'hello there' }) // 2 words → 1300 ms
    advance(200)
    expect(phase()).toBe('speaking')
    expect(lc.getSnapshot().reply.text).toBe('hello there')
    advance(1100)
    expect(phase()).toBe('holding')
    advance(HOLD_MS)
    expect(phase()).toBe('idle')
  })

  it('uses the fallback text when the reply is empty, and ignores fully empty input', () => {
    expect(lc.present({ text: '  ', parts: [] })).toBeNull()
    expect(phase()).toBe('idle')
    lc.present({ text: '', fallbackText: 'I am here with you.' })
    expect(lc.getSnapshot().reply.text).toBe('I am here with you.')
  })

  it('advances the word highlight across the speaking duration', () => {
    lc.present({ text: 'one two three four five' }) // 2500 ms, 500 ms per word
    expect(lc.highlightIndex()).toBe(0)
    advance(1100)
    expect(lc.highlightIndex()).toBe(2)
    advance(1399)
    expect(lc.highlightIndex()).toBe(4)
    advance(1) // holding: everything lit
    expect(lc.highlightIndex()).toBe(4)
  })

  describe('with an audio element', () => {
    it('takes the duration from the audio and speaks until it ends', () => {
      const audio = fakeAudio(4)
      lc.present({ text: 'one two', audioEl: audio })
      expect(lc.getSnapshot().reply.durationMs).toBe(4000)
      advance(9_000) // past the estimate and the audio length (safety net is at 10 s): still waiting for 'ended'
      expect(phase()).toBe('speaking')
      audio.currentTime = 2
      expect(lc.highlightIndex()).toBe(1)
      audio.fire('ended')
      expect(phase()).toBe('holding')
      expect(audio.count('ended')).toBe(0)
      advance(HOLD_MS)
      expect(phase()).toBe('idle')
    })

    it('ends speaking on an audio error', () => {
      const audio = fakeAudio()
      lc.present({ text: 'one two', audioEl: audio })
      audio.fire('error')
      expect(phase()).toBe('holding')
    })

    it('has a safety timeout if the audio never ends', () => {
      lc.present({ text: 'one two', audioEl: fakeAudio(2) })
      advance(60_000)
      expect(phase()).toBe('idle')
    })

    it('detaches the old audio listeners when replaced', () => {
      const audio = fakeAudio(3)
      lc.present({ text: 'one two', audioEl: audio })
      lc.present({ text: 'three four' })
      expect(audio.count('ended')).toBe(0)
      audio.fire('ended') // late event from the old audio: no effect
      expect(phase()).toBe('speaking')
    })
  })
})
