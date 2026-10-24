/**
 * StartMenu — "/" : who is using this device? Patient tablet → /terminal, Caregiver → /portal.
 *
 * Mesh gradient, logo + wordmark + tagline, two large cards (side by side from 700px, stacked below), EN/ID toggle and
 * "Remember this choice on this device" (default on; stored by lib/startMode.js). main.jsx mounts it and swaps in the
 * chosen app without a reload, so the "Patient tablet" tap is the gesture that unlocks audio and asks for the mic
 * (the terminal then skips its "Tap to start" gate).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Smartphone, Tablet } from 'lucide-react'
import '../terminal.css'
import MeshBackground from '../components/MeshBackground'
import logoSvg from '../assets/logo.svg'
import { setStoredMode, clearStoredMode } from '../lib/startMode'

const FOCUS = 'outline-none focus-visible:ring-4 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#05324d]'

function ModeCard({ icon: Icon, title, body, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[56px] w-full items-start gap-4 rounded-card bg-intacta-dark p-6 text-left text-white
                  shadow-[0_0_9px_5px_rgba(6,19,44,0.25)] transition-colors hover:bg-intacta-mid ${FOCUS}`}
    >
      <Icon size={40} strokeWidth={1.75} className="mt-1 shrink-0" aria-hidden="true" />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-title">{title}</span>
        <span className="text-body">{body}</span>
      </span>
    </button>
  )
}

export default function StartMenu({ onChoose }) {
  const { t, i18n } = useTranslation()
  const [remember, setRemember] = useState(true)
  const lang = i18n.language === 'id' ? 'id' : 'en'

  const choose = (mode) => {
    if (remember) setStoredMode(mode)
    else clearStoredMode()
    onChoose(mode)
  }

  const langBtn = (code) => (
    <button
      type="button"
      onClick={() => i18n.changeLanguage(code)}
      aria-pressed={lang === code}
      aria-label={t(`startMenu.${code}Name`)}
      className={`text-body min-h-[44px] min-w-[56px] rounded-control px-3 font-semibold ${FOCUS}
                  ${lang === code ? 'bg-white text-[#05324d]' : 'text-white hover:bg-white/10'}`}
    >
      {t(`startMenu.${code}`)}
    </button>
  )

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden text-white" lang={lang}>
      <MeshBackground opacity={0.88} />
      <main className="relative z-[1] mx-auto flex min-h-[100dvh] w-full max-w-[960px] flex-col items-center justify-center px-4 py-8">
        <div className="w-full rounded-card bg-[#05324d]/90 px-4 py-6 shadow-[0_8px_32px_rgba(0,0,0,0.35)] sm:px-8 sm:py-8">
          {/* Brand */}
          <div className="flex items-center justify-center gap-3">
            <img src={logoSvg} alt="" className="h-12 w-auto sm:h-14" />
            <div className="flex min-w-0 flex-col">
              <span className="term-wordmark" style={{ fontSize: 'clamp(36px, 30px + 1.5vw, 48px)' }}>{t('brand')}</span>
              <span className="text-secondary text-intacta-text">{t('tagline')}</span>
            </div>
          </div>

          <h1 className="text-title mt-6 text-center">{t('startMenu.title')}</h1>

          <div className="mt-6 grid gap-4 min-[700px]:grid-cols-2">
            <ModeCard icon={Tablet} title={t('startMenu.patientTitle')} body={t('startMenu.patientBody')} onClick={() => choose('patient')} />
            <ModeCard icon={Smartphone} title={t('startMenu.caregiverTitle')} body={t('startMenu.caregiverBody')} onClick={() => choose('caregiver')} />
          </div>

          <div className="mt-6 flex flex-col items-center gap-4 min-[700px]:flex-row min-[700px]:justify-between">
            <div role="group" aria-label={t('startMenu.language')} className="flex gap-1 rounded-control border border-white/40 p-1">
              {langBtn('en')}
              {langBtn('id')}
            </div>
            <label className="text-body flex min-h-[44px] cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
                className="h-6 w-6 shrink-0 cursor-pointer accent-[#54aed3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              />
              {t('startMenu.remember')}
            </label>
          </div>
        </div>
      </main>
    </div>
  )
}
