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

  it('fires once per hold', () => {
    const onFire = vi.fn()
    const lp = createLongPress({ onFire })
    lp.start(); vi.advanceTimersByTime(9000); lp.cancel()
    expect(onFire).toHaveBeenCalledTimes(1)
    expect(lp.isPending()).toBe(false)
  })
})
