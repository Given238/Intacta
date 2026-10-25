/**
 * Settings — device, clinical rules, audio and account (Figma 60:90, iPhone 17 402×874).
 *
 *   Cards: Device (Bluetooth icon Figma 107:86, name, online + battery, "Pair New Tablet"), Rules (strict switch,
 *   max speech slider 0–15), Audio (mic 107:1504, voice select with arrow 107:1586, speed, volume, Test Voice),
 *   Account (name / email, Log Out). Two columns from 768px. Figma sizes are a reference; text uses the type scale.
 *
 * Data: GET/PUT /api/settings (PUT → server emits settings:sync to the tablet), GET /api/voices (options only, never voice IDs),
 * GET/PUT /api/caregiver, GET /api/patient/status + live device:status. Saves on release / blur / change.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, Loader2 } from 'lucide-react'

import bluetoothIcon from '../../assets/icons/bluetooth.svg'
import micIcon       from '../../assets/icons/mic.svg'
import arrowIcon     from '../../assets/icons/keyboard-arrow-up.svg'
import onlineDot     from '../../assets/icons/status-dot-online.svg'
import i18n from '../../i18n'
import { goToModeChooser } from '../../lib/startMode'
import { portalFetch, portalFetchBlob } from '../portalApi'
import { getSession, clearSession } from '../session'
import { checkName, saveCaregiverName, nameErrorKey } from '../caregiverName'
import { usePortalLoad, sessionPatientId } from '../usePortalLoad'
import { usePortalSocket, emitWithAck } from '../usePortalSocket'
import PortalToast from '../components/PortalToast'
import Switch from '../components/Switch'
import Dialog, { DialogButton } from '../components/Dialog'
import { Loading, LoadError } from '../components/LoadState'

const CARD = 'rounded-card bg-surface text-white'
const PILL = 'text-secondary flex min-h-[44px] items-center justify-center rounded-full px-4 font-semibold text-white disabled:opacity-60'

async function loadSettings() {
  const pid = encodeURIComponent(getSession()?.patient_id)
  const [{ settings }, { status }, { voices }, { caregiver }] = await Promise.all([
    portalFetch(`/api/settings?patientId=${pid}`),
    portalFetch(`/api/patient/status?patientId=${pid}`),
    portalFetch('/api/voices'),
    portalFetch('/api/caregiver'),
  ])
  return { settings, status, voices: voices || [], caregiver }
}

export default function Settings() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data, setData, loading, error, retry } = usePortalLoad(loadSettings)
  const { socket } = usePortalSocket()
  const [toast,     setToast]     = useState(null)
  const [saveState, setSaveState] = useState({})      // card → 'saving' | 'saved'
  const [confirmStrictOff, setConfirmStrictOff] = useState(false)
  const [confirmLogout,    setConfirmLogout]    = useState(false)
  const savedTimers = useRef({})

  const showToast = useCallback((message) => {
    setToast(message)
    setTimeout(() => setToast(cur => (cur === message ? null : cur)), 4000)
  }, [])

  // Live online / battery from the tablet
  useEffect(() => {
    if (!socket) return
    const onStatus = ({ device_id, online, battery }) => setData(d => d && ({
      ...d,
      status: { ...d.status, device: { ...(d.status.device || { id: device_id, name: getSession()?.device_name }), online, battery } },
    }))
    socket.on('device:status', onStatus)
    return () => socket.off('device:status', onStatus)
  }, [socket, setData])

  const markSaved = (card, state) => {
    clearTimeout(savedTimers.current[card])
    setSaveState(s => ({ ...s, [card]: state }))
    if (state === 'saved') savedTimers.current[card] = setTimeout(() => setSaveState(s => ({ ...s, [card]: null })), 2000)
  }

  /*
   * PUT /api/settings with only the changed keys; roll back on failure.
   * Saves run one at a time in order (quick slider steps must not land out of order on the server),
   * and only the newest reply is applied to the screen.
   */
  const saveQueue = useRef(Promise.resolve())
  const saveSeq   = useRef(0)
  const saveSettings = (card, changes, previous) => {
    const seq = ++saveSeq.current
    markSaved(card, 'saving')
    saveQueue.current = saveQueue.current.then(async () => {
      try {
        const { settings } = await portalFetch('/api/settings', {
          method: 'PUT',
          body: JSON.stringify({ patientId: sessionPatientId(getSession()), ...changes }),
        })
        if (seq === saveSeq.current) {
          setData(d => ({ ...d, settings }))
          markSaved(card, 'saved')
        }
      } catch (err) {
        if (err.code === 'unauthorized') return
        console.error('settings save failed:', err.message)
        setData(d => ({ ...d, settings: { ...d.settings, ...previous } }))
        markSaved(card, null)
        showToast(t('portal.settings.saveFailed'))
      }
    })
    return saveQueue.current
  }

  const setLocal = (changes) => setData(d => ({ ...d, settings: { ...d.settings, ...changes } }))

  if (loading && !data) return <Loading />
  if (error && !loading) return <LoadError onRetry={retry} />
  if (!data) return null

  const { settings, status, voices, caregiver } = data
  const language = status?.language || 'en'

  const toggleStrict = (on) => {
    if (!on) { setConfirmStrictOff(true); return }
    const previous = { strict_validation: settings.strict_validation }
    setLocal({ strict_validation: true })
    saveSettings('rules', { strict_validation: true }, previous)
  }

  const logout = () => {
    clearSession()
    navigate('/portal/pair', { replace: true })
  }

  return (
    <div className="text-white">
      <PortalToast message={toast} />
      <h1 className="text-title mb-4">{t('portal.tabs.settings')}</h1>
      {/* Sections in two columns from 768px */}
      <div className="grid gap-4 md:grid-cols-2 md:items-start md:gap-6">

      <DeviceCard status={status} onPairNew={() => navigate('/portal/pair?link=1')} />

      <Card title={t('portal.settings.rules.title')} state={saveState.rules}>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="strict-validation" className="text-body">{t('portal.settings.rules.strict')}</label>
          <Switch id="strict-validation" checked={settings.strict_validation} onChange={toggleStrict} />
        </div>
        <Slider
          id="max-speech"
          label={t('portal.settings.rules.maxSpeech')}
          min={0} max={15} step={1}
          value={settings.max_speech_seconds}
          display={(v) => (v === 0 ? t('portal.settings.rules.noLimit') : t('portal.settings.seconds', { n: v }))}
          minLabel="0" maxLabel="15"
          onChange={(v) => setLocal({ max_speech_seconds: v })}
          onCommit={(v, prev) => saveSettings('rules', { max_speech_seconds: v }, { max_speech_seconds: prev })}
        />
      </Card>

      <AudioCard
        settings={settings}
        voices={voices}
        language={language}
        socket={socket}
        online={!!status?.device?.online}
        state={saveState.audio}
        setLocal={setLocal}
        save={(changes, previous) => saveSettings('audio', changes, previous)}
        onToast={showToast}
      />

      <AccountCard
        caregiver={caregiver}
        onSaved={(next) => setData(d => ({ ...d, caregiver: next }))}
        onLogout={() => setConfirmLogout(true)}
      />

      </div>
      <p className="text-secondary mt-6 px-2 pb-2 text-center text-white">
        {t('portal.settings.recordingNotice')}
      </p>

      {confirmStrictOff && (
        <Dialog
          title={t('portal.settings.rules.offTitle')}
          onClose={() => setConfirmStrictOff(false)}
          footer={<>
            <DialogButton variant="ghost" onClick={() => setConfirmStrictOff(false)}>{t('portal.common.cancel')}</DialogButton>
            <DialogButton variant="danger" onClick={() => {
              setConfirmStrictOff(false)
              setLocal({ strict_validation: false })
              saveSettings('rules', { strict_validation: false }, { strict_validation: true })
            }}>{t('portal.settings.rules.offConfirm')}</DialogButton>
          </>}
        >
          <p className="text-body">{t('portal.settings.rules.offBody')}</p>
        </Dialog>
      )}
      {confirmLogout && (
        <Dialog
          title={t('portal.settings.account.logoutTitle')}
          onClose={() => setConfirmLogout(false)}
          footer={<>
            <DialogButton variant="ghost" onClick={() => setConfirmLogout(false)}>{t('portal.common.cancel')}</DialogButton>
            <DialogButton variant="danger" onClick={logout}>{t('portal.settings.account.logout')}</DialogButton>
          </>}
        >
          <p className="text-body">{t('portal.settings.account.logoutBody')}</p>
        </Dialog>
      )}
    </div>
  )
}

function Card({ title, state, children, className = '' }) {
  const { t } = useTranslation()
  return (
    <section className={`${CARD} p-4 ${className}`}>
      <div className="flex min-h-[24px] items-center justify-between gap-2">
        <h2 className="text-card">{title}</h2>
        <span aria-live="polite" className="text-caption flex items-center gap-1 text-muted">
          {state === 'saving' && <><Loader2 size={12} className="animate-spin" aria-hidden="true" />{t('portal.common.saving')}</>}
          {state === 'saved' && <><Check size={12} aria-hidden="true" />{t('portal.common.saved')}</>}
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  )
}

function DeviceCard({ status, onPairNew }) {
  const { t } = useTranslation()
  const device  = status?.device
  const online  = !!device?.online
  const battery = Number.isInteger(device?.battery) ? device.battery : null

  return (
    <Card title={t('portal.settings.device.title')}>
      <div className="flex items-start gap-4">
        <img src={bluetoothIcon} alt="" width={24.625} height={39.7501} className="mt-1 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-body truncate font-semibold">{device?.name || t('portal.settings.device.none')}</p>
          {device && (
            <p className="text-secondary flex items-center gap-1 tabular-nums text-muted">
              {online
                ? <img src={onlineDot} alt="" width={10} height={10} />
                : <span className="block h-[10px] w-[10px] rounded-full bg-[#9aa5ab]" aria-hidden="true" />}
              {online ? t('portal.settings.device.online') : t('portal.settings.device.offline')}
              {battery != null && ` - ${battery}%`}
            </p>
          )}
          <button type="button" onClick={onPairNew} className={`${PILL} mt-3 bg-[#5e6d77]`}>
            {t('portal.settings.device.pairNew')}
          </button>
        </div>
      </div>
    </Card>
  )
}

/* Range slider that saves once on release (pointer up, key up, blur), not on every step */
function Slider({ id, label, min, max, step, value, display, minLabel, maxLabel, onChange, onCommit, valueText }) {
  const committed = useRef(value)
  const commit = (e) => {
    const v = Number(e.target.value)
    if (v === committed.current) return
    const prev = committed.current
    committed.current = v
    onCommit(v, prev)
  }
  return (
    <div>
      <div className="flex max-w-[320px] items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-body">{label}</label>
        <span className="text-body font-semibold tabular-nums">{display(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min} max={max} step={step}
        value={value}
        aria-valuetext={valueText ? valueText(value) : display(value)}
        onChange={e => onChange(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        onTouchEnd={commit}
        className="portal-range mt-2 h-[32px] w-full max-w-[320px] cursor-pointer appearance-none bg-transparent"
      />
      <div className="text-caption flex w-full max-w-[320px] justify-between tabular-nums text-muted">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  )
}

function AudioCard({ settings, voices, language, socket, online, state, setLocal, save, onToast }) {
  const { t } = useTranslation()
  const [testing, setTesting] = useState(false)
  const [testNote, setTestNote] = useState(null)

  // Female / Male for the patient's language; options without a configured voice are disabled.
  const gender = settings.voice_gender || 'female'
  const voiceOptions = ['female', 'male'].map(g => {
    const available = voices.some(v => v.language === language && v.gender === g && v.available)
    const label = t(`portal.settings.audio.gender.${g}`)
    return { value: g, label: available ? label : `${label} (${t('portal.settings.audio.voiceUnavailable')})`, available }
  })

  const testVoice = async () => {
    setTesting(true)
    setTestNote(null)
    try {
      if (online) {
        await emitWithAck(socket, 'voice:test', { patientId: sessionPatientId(getSession()) })
        setTestNote(t('portal.settings.audio.testSent'))
      } else {
        await speakLocally(language, settings)
        setTestNote(t('portal.settings.audio.testLocal'))
      }
    } catch (err) {
      console.error('voice test failed:', err.message)
      try {
        await speakLocally(language, settings)
        setTestNote(t('portal.settings.audio.testLocal'))
      } catch {
        onToast(t('portal.settings.audio.testFailed'))
      }
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card title={t('portal.settings.audio.title')} state={state}>
      <div className="flex items-center gap-3">
        <img src={micIcon} alt="" width={10.9333} height={16.2667} className="shrink-0" />
        <label htmlFor="voice" className="sr-only">{t('portal.settings.audio.voiceLabel')}</label>
        <span className="relative inline-flex items-center">
          <select
            id="voice"
            value={gender}
            onChange={e => {
              const previous = { voice_gender: gender }
              const voice_gender = e.target.value
              setLocal({ voice_gender })
              save({ voice_gender }, previous)
            }}
            className="text-body min-h-[44px] appearance-none rounded-control bg-[#5e6d77] py-1 pl-3 pr-8 text-white outline-none focus-visible:ring-2 focus-visible:ring-[#54aed3]"
          >
            {voiceOptions.map(o => (
              <option key={o.value} value={o.value} disabled={!o.available && o.value !== gender}>{o.label}</option>
            ))}
          </select>
          <img src={arrowIcon} alt="" width={6.5} height={4.00833} className="pointer-events-none absolute right-[11px] rotate-180 invert" />
        </span>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4">
          <Slider
            id="playback-speed"
            label={t('portal.settings.audio.speed')}
            min={0.85} max={1} step={0.05}
            value={Number(settings.playback_speed)}
            display={(v) => `${Number(v).toFixed(2)}x`}
            minLabel="0.85x" maxLabel="1.0x"
            onChange={(v) => setLocal({ playback_speed: v })}
            onCommit={(v, prev) => save({ playback_speed: v }, { playback_speed: prev })}
          />
          <Slider
            id="volume"
            label={t('portal.settings.audio.volume')}
            min={60} max={70} step={1}
            value={settings.volume_db}
            display={(v) => `${v} dB`}
            minLabel="60 dB" maxLabel="70 dB"
            onChange={(v) => setLocal({ volume_db: v })}
            onCommit={(v, prev) => save({ volume_db: v }, { volume_db: prev })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={testVoice} disabled={testing} className={`${PILL} min-w-[120px] bg-[#5e6d77]`}>
            {testing ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : t('portal.settings.audio.test')}
          </button>
          <span aria-live="polite" className="text-caption text-muted">{testNote}</span>
        </div>
      </div>
    </Card>
  )
}

/* No tablet online: play the tablet's voice here (GET /api/tts with the JWT, saved voice + speed),
   else browser speech synthesis (rate = playback speed). 60–70 dB → volume 0.5–1. */
let localAudio = null
async function speakLocally(language, settings) {
  const text = i18n.getFixedT(language)('portal.settings.audio.testPhrase')
  const volume = 0.5 + ((Number(settings.volume_db) || 65) - 60) / 20
  try {
    const pid = encodeURIComponent(sessionPatientId(getSession()))
    const blob = await portalFetchBlob(`/api/tts?patientId=${pid}&text=${encodeURIComponent(text)}`)
    if (localAudio) { localAudio.pause(); URL.revokeObjectURL(localAudio.src) }
    localAudio = new Audio(URL.createObjectURL(blob))
    localAudio.volume = volume
    await localAudio.play()
    return
  } catch (err) {
    console.warn('tts unavailable, using browser speech:', err.message)
  }
  if (!('speechSynthesis' in window)) throw new Error('speechSynthesis unsupported')
  const u = new SpeechSynthesisUtterance(text)
  u.lang   = language === 'id' ? 'id-ID' : 'en-US'
  u.rate   = Number(settings.playback_speed) || 1
  u.volume = volume
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(u)
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function AccountCard({ caregiver, onSaved, onLogout }) {
  const { t } = useTranslation()
  const [name,  setName]  = useState(caregiver?.name || '')
  const [email, setEmail] = useState(caregiver?.email || '')
  const [errors, setErrors] = useState({})
  const [state,  setState]  = useState(null)

  const saveField = async (field, raw) => {
    // The name is shown on the tablet: person-name rules here, the same rules + the safety check on the server
    const name = field === 'name' ? checkName(raw) : null
    const value = field === 'name' ? (name.value || '') : raw.trim()
    const current = caregiver?.[field] || ''
    if (field === 'name' && !name.ok) { setErrors(e => ({ ...e, name: t('portal.settings.account.errors.name') })); return }
    if (value === current) { setErrors(e => ({ ...e, [field]: null })); return }
    if (field === 'email' && value && !EMAIL.test(value)) { setErrors(e => ({ ...e, email: t('portal.settings.account.errors.email') })); return }
    setErrors(e => ({ ...e, [field]: null }))
    setState('saving')
    try {
      const next = field === 'name'
        ? await saveCaregiverName(value || null)
        : (await portalFetch('/api/caregiver', { method: 'PUT', body: JSON.stringify({ [field]: value || null }) })).caregiver
      onSaved(next)
      if (field === 'name') setName(next?.name || '')
      setState('saved')
      setTimeout(() => setState(s => (s === 'saved' ? null : s)), 2000)
    } catch (err) {
      if (err.code === 'unauthorized') return
      setState(null)
      const key = field === 'name' ? nameErrorKey(err)
        : err.code === 'email_taken' ? 'portal.settings.account.errors.emailTaken' : 'portal.settings.saveFailed'
      setErrors(e => ({ ...e, [field]: t(key) }))
    }
  }

  const field = 'text-body h-[44px] w-full min-w-0 rounded-control bg-white px-3 text-black outline-none focus-visible:ring-2 focus-visible:ring-[#54aed3]'
  return (
    <Card title={t('portal.settings.account.title')} state={state}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-body">{t('portal.settings.account.profile')}</p>
        <button type="button" onClick={onLogout} className={`${PILL} min-w-[102px] shrink-0 bg-[#761313]`}>
          {t('portal.settings.account.logout')}
        </button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-body">{t('portal.settings.account.deviceMode')}</p>
        {/* Back to the start menu; the login and any device token stay */}
        <button type="button" onClick={goToModeChooser} className={`${PILL} min-w-[102px] shrink-0 bg-[#5e6d77]`}>
          {t('portal.settings.account.changeMode')}
        </button>
      </div>
      <div className="grid grid-cols-[56px_1fr] items-center gap-x-2 gap-y-2">
        <label htmlFor="cg-name" className="text-caption text-muted">{t('portal.settings.account.name')}</label>
        <input id="cg-name" value={name} maxLength={40} autoComplete="name"
          onChange={e => setName(e.target.value)} onBlur={e => saveField('name', e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          aria-invalid={!!errors.name} aria-describedby="cg-name-hint cg-name-error" className={field} />
        <p id="cg-name-hint" className="text-caption col-start-2 text-muted">{t('portal.settings.account.nameHint')}</p>
        {errors.name && <p id="cg-name-error" role="alert" className="text-caption col-start-2 text-danger-soft">{errors.name}</p>}
        <label htmlFor="cg-email" className="text-caption text-muted">{t('portal.settings.account.email')}</label>
        <input id="cg-email" type="email" value={email} maxLength={255} autoComplete="email" inputMode="email"
          onChange={e => setEmail(e.target.value)} onBlur={e => saveField('email', e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          aria-invalid={!!errors.email} aria-describedby="cg-email-error" className={field} />
        {errors.email && <p id="cg-email-error" className="text-caption col-start-2 text-danger-soft">{errors.email}</p>}
      </div>
    </Card>
  )
}
