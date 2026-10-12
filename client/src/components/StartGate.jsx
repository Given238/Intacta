/**
 * StartGate — one-time full-screen "Tap to start" on every page load (not persisted).
 *
 * Browsers only allow audio playback and the microphone after a real user gesture; the tap is that
 * gesture (App's handleStart unlocks audio synchronously inside it). Looks like the home screen:
 * same stage, mesh, header and still waveform, with the prompt in the greeting's box and style.
 */
import { useTranslation } from 'react-i18next'
import TerminalStage from './TerminalStage'
import MeshBackground from './MeshBackground'
import Header from './Header'
import WaveformBars from './WaveformBars'
import { TEXT_SHADOW } from '../lib/contrast'
import { REPLY_BOX, FONT_MAX, LINE_HEIGHT } from '../lib/replyLayout'

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
      <TerminalStage>
        <MeshBackground opacity={0.88} />
        <Header language={language} />
        <WaveformBars />
        <p
          className="start-pulse"
          style={{
            position:   'absolute',
            left:       REPLY_BOX.left,
            top:        REPLY_BOX.top,
            width:      REPLY_BOX.width,
            margin:     0,
            fontFamily: '"Inter", system-ui, sans-serif',
            fontWeight: 800,
            fontSize:   FONT_MAX,
            lineHeight: LINE_HEIGHT,
            color:      'white',
            textAlign:  'center',
            textShadow: TEXT_SHADOW,
          }}
        >
          {t('start')}
        </p>
      </TerminalStage>
    </div>
  )
}
