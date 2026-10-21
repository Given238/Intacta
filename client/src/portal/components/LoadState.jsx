/**
 * Shared loading / error / empty states for portal screens (same look as Home).
 */
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

export const CARD = 'rounded-card bg-surface text-white'

export function Loading({ label }) {
  const { t } = useTranslation()
  return (
    <div role="status" className="mt-10 flex flex-col items-center gap-3 text-white">
      <Loader2 size={28} className="animate-spin" aria-hidden="true" />
      <span className="text-body">{label || t('portal.common.loading')}</span>
    </div>
  )
}

export function LoadError({ message, onRetry }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className={`${CARD} mt-4 flex flex-col items-center gap-4 px-6 py-6 text-center`}>
      <p className="text-body">{message || t('portal.common.loadError')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-body min-h-[44px] rounded-control bg-intacta-dark px-6 font-semibold text-white"
      >
        {t('portal.common.retry')}
      </button>
    </div>
  )
}

export function Empty({ children }) {
  return <p className="text-secondary text-muted">{children}</p>
}
