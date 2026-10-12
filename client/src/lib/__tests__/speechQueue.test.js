import { describe, expect, it } from 'vitest'
import { createSpeechQueue } from '../speechQueue'

/** A terminal stand-in: speaking a queued item makes it busy until finish() is called. */
function terminal() {
  const spoken = []
  let speaking = false
  let processing = false
  const q = createSpeechQueue({
    isBusy: () => speaking || processing,
    speak: (item) => { spoken.push(item.text); speaking = true },
  })
  return {
    q,
    spoken,
    replyStarts: () => { speaking = true },
    finish: () => { speaking = false; q.pump() },
    setProcessing: (v) => { processing = v; if (!v) q.pump() },
  }
}

describe('routine speech queue', () => {
  it('speaks immediately when the terminal is free', () => {
    const t = terminal()
    t.q.enqueue({ key: 1, text: 'Breakfast' })
    expect(t.spoken).toEqual(['Breakfast'])
    expect(t.q.size).toBe(0)
  })

  it('waits while a reply is being spoken, then speaks it afterwards', () => {
    const t = terminal()
    t.replyStarts()
    t.q.enqueue({ key: 1, text: 'Pills' })
    expect(t.spoken).toEqual([])
    t.finish()
    expect(t.spoken).toEqual(['Pills'])
  })

  it('keeps arrival order and speaks one at a time', () => {
    const t = terminal()
    t.replyStarts()
    t.q.enqueue({ key: 1, text: 'Pills' })
    t.q.enqueue({ key: 2, text: 'Water' })
    t.finish()
    expect(t.spoken).toEqual(['Pills'])
    t.finish()
    expect(t.spoken).toEqual(['Pills', 'Water'])
    t.finish()
    expect(t.q.size).toBe(0)
  })

  it('waits while the patient\'s words are being processed', () => {
    const t = terminal()
    t.setProcessing(true)
    t.q.enqueue({ key: 1, text: 'Lunch' })
    expect(t.spoken).toEqual([])
    t.setProcessing(false)
    expect(t.spoken).toEqual(['Lunch'])
  })

  it('queues the same routine only once (e.g. delivered again on reconnect)', () => {
    const t = terminal()
    t.replyStarts()
    expect(t.q.enqueue({ key: 7, text: 'Lunch' })).toBe(true)
    expect(t.q.enqueue({ key: 7, text: 'Lunch' })).toBe(false)
    t.finish()
    t.finish()
    expect(t.spoken).toEqual(['Lunch'])
  })

  it('pump while busy does nothing', () => {
    const t = terminal()
    t.replyStarts()
    t.q.enqueue({ key: 1, text: 'Pills' })
    expect(t.q.pump()).toBe(false)
    expect(t.q.size).toBe(1)
  })
})
