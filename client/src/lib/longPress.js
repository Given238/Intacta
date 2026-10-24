/**
 * Long press without a visible button (terminal logo → "Switch mode?").
 * start() on press, cancel() on release / leave / cancel; onFire runs only if the press lasts `ms`.
 */
export const LONG_PRESS_MS = 3000

export function createLongPress({ ms = LONG_PRESS_MS, onFire, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null
  const cancel = () => {
    if (timer != null) clearTimer(timer)
    timer = null
  }
  const start = () => {
    cancel()
    timer = setTimer(() => {
      timer = null
      onFire?.()
    }, ms)
  }
  return { start, cancel, isPending: () => timer != null }
}
