/**
 * PortalHeader — teal brand bar (Figma 62:171, 29:42), clipped to the viewport and fluid.
 * Logo + "Intacta" wordmark (Baloo Da 2, the only Baloo text in the portal) + tagline (Inter, 85% white = 5.1:1).
 */
import { useTranslation } from 'react-i18next'
import logoSvg from '../../assets/logo.svg'

export default function PortalHeader() {
  const { t } = useTranslation()

  return (
    <header className="w-full shrink-0 overflow-hidden bg-intacta-dark" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="mx-auto flex h-[76px] w-full max-w-[1100px] items-center gap-3 px-4 md:h-[96px] md:px-6 lg:max-w-none">
        <img src={logoSvg} alt="" className="h-[48px] w-auto shrink-0 md:h-[60px]" />
        <div className="min-w-0">
          <span className="text-wordmark block text-[clamp(34px,4vw+18px,48px)] leading-none text-white">{t('brand')}</span>
          <span className="text-secondary block truncate text-white/85">{t('tagline')}</span>
        </div>
      </div>
    </header>
  )
}
