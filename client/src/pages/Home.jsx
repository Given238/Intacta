/**
 * Home — Patient Terminal home screen.
 *
 * 1194×834 stage, all coordinates absolute from stage origin.
 * Wrapped in <TerminalStage> which handles CSS scale.
 *
 * The terminal's only screen: replies (typed, voice, broadcast, routine) appear in the greeting's
 * place via App's presentReply → {phase, reply}; the waveform moves only while phase is 'speaking'.
 * TODO(clock): the clock mode screen was removed for now; bring it back as an idle state of this screen.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Loader2 } from 'lucide-react'

import TerminalStage  from '../components/TerminalStage'
import MeshBackground from '../components/MeshBackground'
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
    <TerminalStage>
      {/* Mesh gradient background */}
      <MeshBackground opacity={0.88} />

      {/* Header with brand + buttons */}
      <Header
        language={language}
        showPopup={showPopup}
        onAuthCode={handleAuthCode}
        pairingCode={pairingCode}
        onEnterCaregiver={handleEnterCaregiver}
        regLoading={regLoading}
      />

      {/* ── Error toast ── */}
      {regError && (
        <div
          role="alert"
          style={{
            position:    'absolute',
            left:        '50%',
            top:         130,
            transform:   'translateX(-50%)',
            display:     'flex',
            alignItems:  'center',
            gap:         10,
            background:  '#dc2626',
            color:       'white',
            borderRadius: 14,
            padding:     '10px 20px',
            fontFamily:  '"Inter", system-ui, sans-serif',
            fontSize:    18,
            fontWeight:  500,
            boxShadow:   '0 4px 20px rgba(0,0,0,0.3)',
            zIndex:      25,
          }}
        >
          <AlertCircle size={22} />
          {/* Dev: show the HTTP status + reason; prod: friendly message only */}
          {import.meta.env.DEV ? regError : t('error')}
        </div>
      )}

      {/* ── Waveform bars (Figma positions; move only while speaking) ── */}
      <WaveformBars speaking={phase === 'speaking'} audioEl={reply?.audioEl || null} />

      {/* ── Greeting / reply — one box: left 271, top 610, width 703 ── */}
      <ReplyText
        greeting={t('greeting')}
        phase={phase}
        reply={reply}
        highlightIndex={highlightIndex}
      />

      {/* ── Typed dev input (` key or ?dev=1), under the header ── */}
      {typedSlot}
    </TerminalStage>
  )
}
