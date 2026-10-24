import { useEffect, useMemo } from 'react'
import { createLongPress, LONG_PRESS_MS } from '../lib/longPress'

/**
 * Pointer handlers (touch, mouse, pen) for a long press; spread them on the element.
 * Returns {} when there is no onFire, so the element stays inert. Pass a stable onFire (useCallback).
 */
export function useLongPress(onFire, ms = LONG_PRESS_MS) {
  const press = useMemo(() => createLongPress({ ms, onFire }), [ms, onFire])
  useEffect(() => press.cancel, [press])

  return useMemo(() => {
    if (!onFire) return {}
    const cancel = () => press.cancel()
    return {
      onPointerDown: (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        if (!e.isPrimary) { cancel(); return } // a second finger cancels
        press.start()
      },
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      onContextMenu: (e) => e.preventDefault(), // no long-press menu on touch
    }
  }, [onFire, press])
}
