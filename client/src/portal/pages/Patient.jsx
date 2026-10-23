/**
 * Patient — live status, speak-to-tablet and interaction log (Figma 60:120, iPhone 17 402×874).
 *
 *   Status card (name, online dot Figma 60:540, battery ring), speak bar (Figma 60:4796 circle = mic, white field),
 *   logs card (InteractionLog.jsx). From 768px: status + speak bar on the left, logs on the right.
 *   Figma sizes are a reference; text uses the portal type scale.
 *
 * Data: GET /api/patient/status + live device:status; broadcast:message over the caregiver socket.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Mic, SendHorizontal } from 'lucide-react'

import onlineDot   from '../../assets/icons/status-dot-online.svg'
import speakCircle from '../../assets/icons/speak-circle.svg'
import { portalFetch } from '../portalApi'
import { getSession } from '../session'
import { usePortalLoad, sessionPatientId } from '../usePortalLoad'
import { usePortalSocket, emitWithAck } from '../usePortalSocket'
import PortalToast from '../components/PortalToast'
import { Loading, LoadError } from '../components/LoadState'
import InteractionLog from './InteractionLog'

const BROADCAST_MAX = 200
const PANEL = 'rounded-card bg-surface text-white'

async function loadStatus() {
  const pid = encodeURIComponent(getSession()?.patient_id)
  const { status } = await portalFetch(`/api/patient/status?patientId=${pid}`)
  return status
}

export default function Patient() {
  const { t } = useTranslation()
  const { data: status, setData: setStatus, loading, error, retry } = usePortalLoad(loadStatus)
  const { socket } = usePortalSocket()
  const [toast, setToast] = useState(null)

  // Live battery / online from the tablet
  useEffect(() => {
    if (!socket) return
    const onStatus = ({ device_id, online, battery }) => {
      setStatus(s => s && ({
        ...s,
        device: { ...(s.device || { id: device_id, name: getSession()?.device_name }), online, battery },
      }))
    }
    socket.on('device:status', onStatus)
    return () => socket.off('device:status', onStatus)
  }, [socket, setStatus])

  const showToast = (message) => {
    setToast(message)
    setTimeout(() => setToast(cur => (cur === message ? null : cur)), 4000)
  }

  return (
    <div className="text-white">
      <PortalToast message={toast} />
      <h1 className="text-title mb-4">{t('portal.tabs.patient')}</h1>
      {/* Phones: stacked. From 768px: status + speak on the left, the log on the right */}
      <div className="grid gap-6 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)] md:items-start">
        <div>
          {loading && !status && <Loading />}
          {error && !loading && <LoadError onRetry={retry} />}
          {status && !error && (
            <>
              <StatusCard status={status} />
              <SpeakBar
                socket={socket}
                language={status.language}
                onError={showToast}
              />
            </>
          )}
        </div>
        <InteractionLog socket={socket} />
      </div>
    </div>
  )
}

function StatusCard({ status }) {
  const { t } = useTranslation()
  const device  = status.device
  const online  = !!device?.online
  const battery = Number.isInteger(device?.battery) ? device.battery : null

  return (
    <section className={`${PANEL} mx-auto w-full max-w-[340px] p-4`} aria-label={t('portal.patient.statusTitle')}>
      <p className="text-secondary text-muted">{t('portal.patient.statusTitle')}</p>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-card min-w-0 truncate">
          {status.patient_name || t('portal.home.fallbackPatient')}
        </span>
        <span className="flex shrink-0 items-center gap-1" role="status">
          {online
            ? <img src={onlineDot} alt="" width={12} height={12} />
            : <span className="block h-[12px] w-[12px] rounded-full bg-[#9aa5ab]" aria-hidden="true" />}
          <span className="text-caption">
            {online ? t('portal.patient.online') : t('portal.patient.offline')}
          </span>
        </span>
      </div>
      <div className="mt-3 h-px bg-[#d9d9d9]" />
      {device ? (
        <BatteryRing percent={battery} />
      ) : (
        <p className="text-secondary mt-4 text-center text-muted">{t('portal.patient.noDevice')}</p>
      )}
    </section>
  )
}

/* Battery ring: white track + green arc (Figma 60:581 is a Material progress indicator) */
function BatteryRing({ percent }) {
  const { t } = useTranslation()
  const size = 100, stroke = 9, r = (size - stroke) / 2, c = 2 * Math.PI * r
  const value = percent ?? 0
  const color = value <= 20 ? '#f59e0b' : '#109e34'
  return (
    <div
      className="relative mx-auto mt-4 h-[100px] w-[100px]"
      role="img"
      aria-label={percent == null ? t('portal.patient.batteryUnknown') : t('portal.patient.battery', { percent })}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ffffff" strokeWidth={stroke} />
        {percent != null && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={color} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${(value / 100) * c} ${c}`}
          />
        )}
      </svg>
      <span className="text-title absolute inset-0 flex items-center justify-center tabular-nums">
        {percent == null ? '–' : `${percent}%`}
      </span>
    </div>
  )
}

const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)

function SpeakBar({ socket, language, onError }) {
  const { t } = useTranslation()
  const [text,      setText]      = useState('')
  const [recording, setRecording] = useState(false)
  const [sending,   setSending]   = useState(false)
  const [sent,      setSent]      = useState(false)
  const [unsafe,    setUnsafe]    = useState(false)
  const recognitionRef = useRef(null)

  useEffect(() => () => recognitionRef.current?.abort(), [])

  const toggleMic = () => {
    if (!SpeechRecognition) return
    if (recording) {
      recognitionRef.current?.stop()
      return
    }
    const rec = new SpeechRecognition()
    rec.lang = language === 'id' ? 'id-ID' : 'en-US'
    rec.interimResults = true
    rec.continuous = false
    rec.onresult = (e) => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join('')
      setText(transcript.slice(0, BROADCAST_MAX))
    }
    rec.onerror = (e) => {
      if (e.error !== 'aborted' && e.error !== 'no-speech') onError(t('portal.patient.micError'))
    }
    rec.onend = () => setRecording(false)
    recognitionRef.current = rec
    setSent(false)
    setRecording(true)
    rec.start()
  }

  const send = async (e) => {
    e.preventDefault()
    const clean = text.trim()
    if (!clean || sending) return
    if (clean.length > BROADCAST_MAX) {
      onError(t('portal.patient.tooLong', { max: BROADCAST_MAX }))
      return
    }
    recognitionRef.current?.stop()
    setSending(true)
    setUnsafe(false)
    try {
      await emitWithAck(socket, 'broadcast:message', { patientId: sessionPatientId(getSession()), text: clean })
      setText('')
      setSent(true)
      setTimeout(() => setSent(false), 2500)
    } catch (err) {
      if (err.code === 'unsafe_content' || err.code === 'safety_unavailable') {
        setUnsafe(err.code === 'unsafe_content' ? 'unsafe' : 'unavailable') // keep the text so it can be rephrased / resent
        return
      }
      console.error('broadcast failed:', err.message)
      if (err.code === 'rate_limited') onError(t('portal.safety.rateLimited'))
      else onError(err.message === 'offline' ? t('portal.patient.sendOffline') : t('portal.patient.sendFailed'))
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={send} noValidate className="mt-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggleMic}
          disabled={!SpeechRecognition}
          aria-pressed={recording}
          aria-label={recording ? t('portal.patient.micStop') : t('portal.patient.micStart')}
          title={SpeechRecognition ? undefined : t('portal.patient.micUnsupported')}
          className="relative flex h-[44px] w-[44px] shrink-0 items-center justify-center disabled:opacity-50"
        >
          <img src={speakCircle} alt="" width={35} height={35} className={recording ? 'rounded-full ring-4 ring-[#dc2626] animate-pulse' : ''} />
          <Mic size={16} className="absolute text-white" aria-hidden="true" />
        </button>
        <label htmlFor="speak-now" className="sr-only">{t('portal.patient.speakNow')}</label>
        <div className="flex h-[48px] min-w-0 flex-1 items-center rounded-control bg-white pl-4 pr-1">
          <input
            id="speak-now"
            type="text"
            enterKeyHint="send"
            value={text}
            onChange={e => { setText(e.target.value); setSent(false); setUnsafe(false) }}
            aria-invalid={!!unsafe}
            aria-describedby="speak-now-status"
            placeholder={recording ? t('portal.patient.listening') : t('portal.patient.speakNow')}
            className="text-body min-w-0 flex-1 bg-transparent text-black outline-none placeholder:text-[#5f6366]"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            aria-label={sending ? t('portal.safety.checking') : t('portal.patient.send')}
            className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-control text-[#043961] disabled:opacity-30"
          >
            {sending ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <SendHorizontal size={18} aria-hidden="true" />}
          </button>
        </div>
      </div>
      <p id="speak-now-status" aria-live="polite" className={`text-caption min-h-[16px] pt-1 text-white ${unsafe ? 'mt-2 rounded-control bg-[#dc2626] px-3 py-2' : 'pl-[56px]'}`}>
        {unsafe
          ? t(`portal.safety.${unsafe}`)
          : sending ? t('portal.safety.checking')
          : sent ? t('portal.patient.sent') : (text.trim().length > 160 ? `${text.trim().length}/${BROADCAST_MAX}` : '')}
      </p>
    </form>
  )
}
