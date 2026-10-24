/**
 * Pairing — waiting-for-caregiver screen (fluid layout).
 * App.jsx wraps it in <TerminalStage header={<Header/>}>. The code panel sits top-right on wide screens and
 * centered on compact ones (.term-pair-panel); waveform and greeting as on the home screen.
 */
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import WaveformBars from '../components/WaveformBars'
import ConnectCard from '../components/ConnectCard'
import { TerminalBody } from '../components/TerminalStage'
import { TEXT_SHADOW } from '../lib/contrast'
import { LINE_HEIGHT } from '../lib/replyLayout'

export default function Pairing({ code, expiresAt, loading, onRegenerate }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  useEffect(() => {
    if (!code) navigate('/terminal', { replace: true })
  }, [code, navigate])

  if (!code) return null

  return (
    <>
      <TerminalBody
        wave={<WaveformBars />}
        text={
          <p className="term-reply" style={{ fontSize: 'var(--term-reply-max)', lineHeight: LINE_HEIGHT, textShadow: TEXT_SHADOW }}>
            {t('greeting')}
          </p>
        }
      />

      {/* ── Pairing code panel ── */}
      <div className="term-pair-panel term-popover" style={{ position: 'absolute', top: 12 }} role="alertdialog" aria-label={t('connect.title')}>
        <ConnectCard code={code} expiresAt={expiresAt} loading={loading} onRegenerate={onRegenerate} />
      </div>

      {/* Dismiss */}
      <button
        type="button"
        onClick={() => navigate('/terminal')}
        className="absolute bottom-[max(12px,env(safe-area-inset-bottom))] left-1/2 z-20 min-h-[44px] -translate-x-1/2 px-4 text-[15px] text-white/80"
      >
        {t('tapToClose')}
      </button>
    </>
  )
}
