import { useTranslation } from 'react-i18next'
import { Activity } from 'lucide-react'
import logoSvg from '../assets/logo.svg'

export default function StartGate({ onStart, language }) {
  const { t } = useTranslation()

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center cursor-pointer select-none relative overflow-hidden"
      onClick={onStart}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onStart()}
      aria-label={t('start')}
    >
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <div className="absolute inset-0" style={{ background: '#05668d', opacity: 0.6 }} />
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse at 80% 20%, #ff6b6b55 0%, transparent 60%), radial-gradient(ellipse at 20% 80%, #6dd5a055 0%, transparent 60%), radial-gradient(ellipse at 50% 50%, #f7b73133 0%, transparent 70%)',
          }}
        />
      </div>

      {/* Logo */}
      <div className="flex items-center gap-3 mb-4 relative z-10">
        <img src={logoSvg} alt="" style={{ width: 'clamp(48px,7vw,80px)', height: 'clamp(64px,9.5vw,107px)' }} />
        <span
          className="font-brand text-white"
          style={{ fontSize: 'clamp(40px, 6vw, 72px)', fontWeight: 800, lineHeight: 1.1 }}
        >
          {t('brand')}
        </span>
      </div>

      <p
        className="font-ui text-white mb-16 opacity-80"
        style={{ fontSize: 'clamp(16px, 2.5vw, 24px)', fontWeight: 500 }}
      >
        {t('tagline')}
      </p>

      {/* Large start button */}
      <div className="flex flex-col items-center gap-4">
        <div
          className="rounded-full flex items-center justify-center shadow-xl"
          style={{
            background: 'rgba(5,102,141,0.85)',
            width:  'clamp(140px, 18vw, 220px)',
            height: 'clamp(140px, 18vw, 220px)',
          }}
        >
          <Activity size={72} color="white" strokeWidth={1.5} className="animate-pulse" />
        </div>
        <span
          className="font-ui text-white font-semibold"
          style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 700 }}
        >
          {t('start')}
        </span>
        <span
          className="font-ui text-white opacity-60"
          style={{ fontSize: 'clamp(14px, 2vw, 20px)' }}
        >
          {t('startHint')}
        </span>
      </div>
    </div>
  )
}
