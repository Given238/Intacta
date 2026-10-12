/**
 * Shared loading / error / empty states for portal screens (same look as Home).
 */
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

export const CARD = 'rounded-[25px] bg-[#043961] text-white'

export function Loading({ label }) {
  const { t } = useTranslation()
  return (
    <div role="status" className="mt-10 flex flex-col items-center gap-3 text-white">
      <Loader2 size={28} className="animate-spin" aria-hidden="true" />
      <span className="text-body-medium text-[15px]">{label || t('portal.common.loading')}</span>
    </div>
  )
}

export function LoadError({ message, onRetry }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className={`${CARD} mt-[18px] flex flex-col items-center gap-4 px-6 py-6 text-center`}>
      <p className="text-body-medium text-[15px] leading-snug">{message || t('portal.common.loadError')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-title-bold min-h-[44px] rounded-[10px] bg-intacta-dark px-6 text-[15px] text-white"
      >
        {t('portal.common.retry')}
      </button>
    </div>
  )
}

export function Empty({ children }) {
  return <p className="text-body-light text-[13px] leading-normal text-intacta-text">{children}</p>
}
