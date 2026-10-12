/**
 * speechQueue — routines wait their turn instead of cutting off a reply.
 *
 * enqueue(item) speaks right away when the terminal is free, otherwise keeps the item (in order) until
 * pump() is called while free. "Busy" is decided by the caller (App: a reply is being spoken, a reply's
 * TTS is loading, or the mic is processing the patient's words). Items with the same `key` (routine id)
 * are queued once. Framework-free for unit tests.
 *
 * @param {object} o
 * @param {() => boolean} o.isBusy
 * @param {(item: object) => void} o.speak   must make isBusy() true synchronously (App's say does)
 */
export function createSpeechQueue({ isBusy, speak }) {
  const items = []

  const pump = () => {
    if (!items.length || isBusy()) return false
    speak(items.shift())
    return true
  }

  return {
    enqueue(item) {
      if (item.key != null && items.some(i => i.key === item.key)) return false
      items.push(item)
      pump()
      return true
    },
    pump,
    get size() { return items.length },
    clear() { items.length = 0 },
  }
}
