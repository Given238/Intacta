/**
 * Dialog — modal for the portal (add/edit forms, confirmations). Not in Figma.
 * Bottom sheet below 640px, centered dialog from 640px.
 * Esc and the backdrop close it; focus moves into it on open and back on close.
 */
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export default function Dialog({ title, onClose, children, footer }) {
  const { t } = useTranslation()
  const ref = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  // Runs once per open: an inline onClose must not re-focus the first field on every render
  useEffect(() => {
    const previous = document.activeElement
    const first = ref.current?.querySelector('input, select, textarea, button:not([data-close])')
    ;(first || ref.current)?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [])

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        className="flex max-h-[90dvh] w-full flex-col rounded-t-card bg-surface text-white shadow-[0_0_24px_rgba(6,19,44,0.5)] outline-none sm:max-w-[520px] sm:rounded-card"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center justify-between gap-2 px-6 pt-4 pb-2">
          <h2 id="dialog-title" className="text-title">{title}</h2>
          <button
            type="button"
            data-close
            onClick={onClose}
            aria-label={t('portal.common.close')}
            className="flex h-[44px] w-[44px] items-center justify-center rounded-full text-muted"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-3">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-6 pt-2 pb-4">{footer}</div>}
      </div>
    </div>
  )
}

export function DialogButton({ variant = 'primary', ...props }) {
  const styles = {
    primary: 'bg-intacta-dark text-white',
    danger:  'bg-[#dc2626] text-white',
    ghost:   'text-muted',
  }
  return (
    <button
      type="button"
      {...props}
      className={`text-body flex min-h-[44px] items-center justify-center gap-2 rounded-control px-5 font-semibold disabled:opacity-60 ${styles[variant]}`}
    />
  )
}
