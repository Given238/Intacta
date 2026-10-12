/**
 * Dialog — modal sheet for the portal (add/edit forms, confirmations). Not in Figma.
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
        className="flex max-h-[90dvh] w-full max-w-[480px] flex-col rounded-t-[20px] bg-[#043961] text-white shadow-[0_0_24px_rgba(6,19,44,0.5)] outline-none sm:rounded-[20px]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center justify-between gap-2 px-[20px] pt-[16px] pb-[8px]">
          <h2 id="dialog-title" className="text-display text-[19px] leading-[24px]">{title}</h2>
          <button
            type="button"
            data-close
            onClick={onClose}
            aria-label={t('portal.common.close')}
            className="flex h-[44px] w-[44px] items-center justify-center rounded-full text-intacta-text"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-[20px] pb-[12px]">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-[20px] pt-[8px] pb-[16px]">{footer}</div>}
      </div>
    </div>
  )
}

export function DialogButton({ variant = 'primary', ...props }) {
  const styles = {
    primary: 'bg-intacta-dark text-white',
    danger:  'bg-[#dc2626] text-white',
    ghost:   'text-intacta-text',
  }
  return (
    <button
      type="button"
      {...props}
      className={`text-title-bold flex min-h-[44px] items-center justify-center gap-2 rounded-[10px] px-5 text-[15px] disabled:opacity-60 ${styles[variant]}`}
    />
  )
}
