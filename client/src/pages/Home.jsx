/**
 * Home — Patient Terminal home screen.
 *
 * Fluid layout (<TerminalStage>, terminal.css): header, then the waveform and the text slot.
 *
 * The terminal's only screen: replies (typed, voice, broadcast, routine) appear in the greeting's
 * place via App's presentReply → {phase, reply}; the waveform moves only while phase is 'speaking'.
 * TODO(clock): the clock mode screen was removed for now; bring it back as an idle state of this screen.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertCircle } from 'lucide-react'

import TerminalStage, { TerminalBody } from '../components/TerminalStage'
import Header         from '../components/Header'
import WaveformBars   from '../components/WaveformBars'
import ReplyText     from '../components/ReplyText'

export default function Home({
  language,
  pairingCode,
  onEnterCaregiver,
  regLoading,
  regError,
  phase = 'idle',
  reply = null,
  highlightIndex,
  typedSlot = null,
}) {
  const { t }   = useTranslation()
  const navigate = useNavigate()
  const [showPopup, setShowPopup] = useState(false)

  const handleEnterCaregiver = async () => {
    setShowPopup(false)
    await onEnterCaregiver()
  }

  const handleAuthCode = () => {
    if (pairingCode) {
      navigate('/terminal/pairing')
    } else {
      setShowPopup(prev => !prev)
    }
  }

  return (
    <TerminalStage
      header={
        <Header
          language={language}
          showPopup={showPopup}
          onAuthCode={handleAuthCode}
          pairingCode={pairingCode}
          onEnterCaregiver={handleEnterCaregiver}
          regLoading={regLoading}
        />
      }
    >
      {/* ── Typed dev input (` key or ?dev=1): in the flow under the header, never over the text ── */}
      {typedSlot}

      {/* ── Error toast ── */}
      {regError && (
        <div role="alert" className="term-toast">
          <AlertCircle size={22} aria-hidden="true" />
          {/* Dev: show the HTTP status + reason; prod: friendly message only */}
          {import.meta.env.DEV ? regError : t('error')}
        </div>
      )}

      {/* ── Waveform (moves only while speaking) + greeting / reply ── */}
      <TerminalBody
        wave={<WaveformBars speaking={phase === 'speaking'} audioEl={reply?.audioEl || null} />}
        text={<ReplyText greeting={t('greeting')} phase={phase} reply={reply} highlightIndex={highlightIndex} />}
      />
    </TerminalStage>
  )
}
