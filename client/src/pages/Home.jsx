/**
 * Home — Patient Terminal home screen.
 *
 * Fluid layout (<TerminalStage>, terminal.css): header, then the waveform and the text slot.
 *
 * The terminal's only screen: replies (typed, voice, broadcast, routine) appear in the greeting's
 * place via App's presentReply → {phase, reply}; the waveform moves only while phase is 'speaking'.
 * TODO(clock): the clock mode screen was removed for now; bring it back as an idle state of this screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle } from 'lucide-react'

import TerminalStage, { TerminalBody } from '../components/TerminalStage'
import Header         from '../components/Header'
import WaveformBars   from '../components/WaveformBars'
import ReplyText     from '../components/ReplyText'
import SwitchModeSheet from '../components/SwitchModeSheet'
import { goToModeChooser } from '../lib/startMode'

export default function Home({
  connection,
  pairedTick = 0,
  language,
  pairingCode,
  pairingExpiresAt,
  onRequestCode,
  regLoading,
  regError,
  phase = 'idle',
  reply = null,
  highlightIndex,
  typedSlot = null,
}) {
  const { t }   = useTranslation()
  const [showPopup, setShowPopup] = useState(false)

  // "Enable caregiver connection": open/close the popup; ask for a code when there is no valid one
  const handleEnableConnection = () => {
    if (showPopup) { setShowPopup(false); return }
    setShowPopup(true)
    const valid = pairingCode && (!pairingExpiresAt || pairingExpiresAt > Date.now())
    if (!valid && !regLoading) onRequestCode()
  }
  const handleAuthCode = () => setShowPopup(prev => !prev)
  const closePopup = useCallback(() => setShowPopup(false), [])

  // Hold the logo 3 s → "Switch mode?" (no visible switch button on the patient screen)
  const [switchOpen, setSwitchOpen] = useState(false)
  const openSwitch = useCallback(() => { setShowPopup(false); setSwitchOpen(true) }, [])
  const closeSwitch = useCallback(() => setSwitchOpen(false), [])

  // Paired (the code is cleared on device:paired): close the popup
  const prevCode = useRef(pairingCode)
  useEffect(() => {
    if (prevCode.current && !pairingCode) setShowPopup(false)
    prevCode.current = pairingCode
  }, [pairingCode])
  // Every pairing (also a second caregiver joining) closes it, even when no code had been shown yet
  useEffect(() => { if (pairedTick) setShowPopup(false) }, [pairedTick])

  // Paired: holding the "Connected" chip 3 s opens the same popup with a fresh code (another caregiver can pair)
  const onRequestCodeRef = useRef(onRequestCode)
  onRequestCodeRef.current = onRequestCode
  const openForAnotherCaregiver = useCallback(() => {
    setSwitchOpen(false)
    setShowPopup(true)
    onRequestCodeRef.current()
  }, [])

  return (
    <TerminalStage
      header={
        <Header
          connection={connection}
          onChipHold={openForAnotherCaregiver}
          language={language}
          showPopup={showPopup}
          onAuthCode={handleAuthCode}
          onEnableConnection={handleEnableConnection}
          onClosePopup={closePopup}
          pairingCode={pairingCode}
          pairingExpiresAt={pairingExpiresAt}
          onRegenerate={onRequestCode}
          regLoading={regLoading}
          onLogoHold={openSwitch}
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

      {switchOpen && <SwitchModeSheet onCancel={closeSwitch} onConfirm={goToModeChooser} />}
    </TerminalStage>
  )
}
