import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COOLDOWN_MS, MIC, createMicMachine } from '../micMachine'

describe('mic state machine (FR-4.2.4)', () => {
  let m
  let captures
  let states

  beforeEach(() => {
    vi.useFakeTimers()
    captures = []
    states = []
    m = createMicMachine({ onCapture: (on) => captures.push(on), onChange: (s) => states.push(s) })
  })
  afterEach(() => {
    m.dispose()
    vi.useRealTimers()
  })

  it('starts off and captures nothing until the mic is enabled', () => {
    expect(m.state).toBe(MIC.OFF)
    expect(m.canCapture()).toBe(false)
    expect(m.speechEnded()).toBe(false)
    m.enable()
    expect(m.state).toBe(MIC.LISTENING)
    expect(captures).toEqual([true])
  })

  it('runs the full voice loop LISTENING → PROCESSING → SPEAKING → COOLDOWN 3.0 s → LISTENING', () => {
    m.enable()
    expect(m.speechEnded()).toBe(true)
    expect(m.state).toBe(MIC.PROCESSING)
    m.speakStart()
    expect(m.state).toBe(MIC.SPEAKING)
    m.speakEnd()
    expect(m.state).toBe(MIC.COOLDOWN)
    vi.advanceTimersByTime(COOLDOWN_MS - 1)
    expect(m.state).toBe(MIC.COOLDOWN)
    expect(m.canCapture()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(m.state).toBe(MIC.LISTENING)
    expect(states).toEqual([MIC.LISTENING, MIC.PROCESSING, MIC.SPEAKING, MIC.COOLDOWN, MIC.LISTENING])
    expect(captures).toEqual([true, false, true]) // stopped on PROCESSING, resumed only after cooldown
  })

  it('drops speech that ends while processing, speaking or cooling down', () => {
    m.enable()
    m.speechEnded()
    expect(m.speechEnded()).toBe(false) // processing
    m.speakStart()
    expect(m.speechEnded()).toBe(false) // speaking
    m.speakEnd()
    expect(m.speechEnded()).toBe(false) // cooldown
    expect(m.state).toBe(MIC.COOLDOWN)
  })

  it('goes back to listening when processing gives no reply', () => {
    m.enable()
    m.speechEnded()
    m.processingDone()
    expect(m.state).toBe(MIC.LISTENING)
    expect(captures).toEqual([true, false, true])
  })

  it('a broadcast or routine spoken while listening stops capture, then cools down', () => {
    m.enable()
    m.speakStart()
    expect(m.state).toBe(MIC.SPEAKING)
    expect(captures).toEqual([true, false])
    m.speakEnd()
    vi.advanceTimersByTime(COOLDOWN_MS)
    expect(m.state).toBe(MIC.LISTENING)
  })

  it('a new reply during cooldown cancels the cooldown and restarts it after speaking', () => {
    m.enable()
    m.speakStart()
    m.speakEnd()
    vi.advanceTimersByTime(2000)
    m.speakStart()
    vi.advanceTimersByTime(5000)
    expect(m.state).toBe(MIC.SPEAKING) // old cooldown timer cancelled
    m.speakEnd()
    vi.advanceTimersByTime(COOLDOWN_MS)
    expect(m.state).toBe(MIC.LISTENING)
  })

  it('a late processingDone after the reply started speaking is ignored', () => {
    m.enable()
    m.speechEnded()
    m.speakStart()
    m.processingDone()
    expect(m.state).toBe(MIC.SPEAKING)
  })

  it('without a mic, speaking never turns capture on', () => {
    m.speakStart()
    m.speakEnd()
    vi.advanceTimersByTime(COOLDOWN_MS)
    expect(m.state).toBe(MIC.OFF)
    expect(captures).toEqual([])
  })

  it('enable while speaking waits for the cooldown; disable stops everything', () => {
    m.enable()
    m.speakStart()
    m.enable()
    expect(m.state).toBe(MIC.SPEAKING)
    m.disable()
    expect(m.state).toBe(MIC.OFF)
    vi.advanceTimersByTime(COOLDOWN_MS)
    expect(m.state).toBe(MIC.OFF)
  })
})
