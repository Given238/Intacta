/**
 * StartGate — one-time full-screen "Tap to start" on every page load (not persisted).
 *
 * Browsers only allow audio playback and the microphone after a real user gesture; the tap is that
 * gesture (App's handleStart unlocks audio synchronously inside it). Looks like the home screen:
 * same layout, mesh, header and still waveform, with the prompt in the greeting's slot and style.
 */
import { useTranslation } from 'react-i18next'
import TerminalStage, { TerminalBody } from './TerminalStage'
import Header from './Header'
import WaveformBars from './WaveformBars'
import { TEXT_SHADOW } from '../lib/contrast'
import { LINE_HEIGHT } from '../lib/replyLayout'

export default function StartGate({ onStart, language }) {
  const { t } = useTranslation()

  return (
    <div
      className="fixed inset-0 cursor-pointer select-none"
      onClick={onStart}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onStart()}
      role="button"
      tabIndex={0}
      aria-label={t('start')}
    >
      <TerminalStage header={<Header language={language} />}>
        <TerminalBody
          wave={<WaveformBars />}
          text={
            <p className="term-reply start-pulse" style={{ fontSize: 'var(--term-reply-max)', lineHeight: LINE_HEIGHT, textShadow: TEXT_SHADOW }}>
              {t('start')}
            </p>
          }
        />
      </TerminalStage>
    </div>
  )
}
