/**
 * PortalHeader — teal brand bar from the iPhone frames (62:171, 29:42).
 * Figma's header rectangle is 1194 wide by mistake; here it is clipped to the viewport.
 *
 *   Bar:   115px tall, #05668d
 *   Logo:  left 26, top 19, 50×67 (same paths as the terminal logo, node 62:175)
 *   Brand: left 116, top 2,  Baloo Da 2 ExtraBold 52px white
 *   Tag:   left 118, top 71, Inter Medium 20px #c6d6df
 */
import { useTranslation } from 'react-i18next'
import logoSvg from '../../assets/logo.svg'

export default function PortalHeader() {
  const { t } = useTranslation()

  return (
    <header
      className="shrink-0 w-full overflow-hidden bg-intacta-dark"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="relative h-[115px]">
        <img
          src={logoSvg}
          alt=""
          width={50}
          height={67}
          className="absolute left-[26px] top-[19px]"
        />
        <span className="absolute left-[116px] top-[2px] text-wordmark text-[52px] leading-normal text-white">
          {t('brand')}
        </span>
        <span className="absolute left-[118px] top-[71px] right-3 truncate text-body-medium text-[20px] leading-normal text-intacta-text">
          {t('tagline')}
        </span>
      </div>
    </header>
  )
}
