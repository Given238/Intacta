import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLongPress, LONG_PRESS_MS } from '../longPress'

describe('logo long press', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('is 3 seconds', () => {
    expect(LONG_PRESS_MS).toBe(3000)
  })

  it('fires after holding 3 s', () => {
    const onFire = vi.fn()
    const lp = createLongPress({ onFire })
    lp.start()
    vi.advanceTimersByTime(2999)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('a tap or early release does nothing', () => {
    const onFire = vi.fn()
    const lp = createLongPress({ onFire })
    lp.start(); vi.advanceTimersByTime(150); lp.cancel()
    lp.start(); vi.advanceTimersByTime(2900); lp.cancel()
    vi.advanceTimersByTime(10_000)
    expect(onFire).not.toHaveBeenCalled()
  })

  it('a new press restarts the 3 s', () => {
    const onFire = vi.fn()
    const lp = createLongPress({ onFire })
    lp.start(); vi.advanceTimersByTime(2000)
    lp.start(); vi.advanceTimersByTime(2000)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('the "Connected" chip and the logo hold are independent (separate timers, no cross-talk)', () => {
    const onSwitch = vi.fn()
    const onConnect = vi.fn()
    const logo = createLongPress({ onFire: onSwitch })
    const chip = createLongPress({ onFire: onConnect })
    chip.start(); vi.advanceTimersByTime(1000)
    logo.start(); vi.advanceTimersByTime(500); logo.cancel() // a short press on the logo does not touch the chip
    vi.advanceTimersByTime(2000)
    expect(onConnect).toHaveBeenCalledTimes(1)
    expect(onSwitch).not.toHaveBeenCalled()
    chip.start(); vi.advanceTimersByTime(2999); chip.cancel() // early release cancels
    vi.advanceTimersByTime(5000)
    expect(onConnect).toHaveBeenCalledTimes(1)
  })

  it('fires once per hold', () => {
    const onFire = vi.fn()
    const lp = createLongPress({ onFire })
    lp.start(); vi.advanceTimersByTime(9000); lp.cancel()
    expect(onFire).toHaveBeenCalledTimes(1)
    expect(lp.isPending()).toBe(false)
  })
})
