/**
 * InteractionLog — the "Interaction Logs" card on the Patient screen (Figma 60:120).
 *
 *   Card:  374 wide, #043961, radius 10; title Inter ExtraBold 19px, 24px in
 *   Rows:  52px apart; time Inter ExtraBold 19px white; 132×36 white pill, radius 10
 *   Pill:  audio rows → waveform from waveform_peaks + playhead, tap = play/pause (one clip at a time);
 *          other rows → source icon + label. Tapping the time or chevron expands transcript + reply.
 *
 * Data: GET /api/interactions (newest first, cursor `before`) + live `interaction:new`.
 * The list scrolls inside the card, which stops above the tab bar.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarClock, ChevronDown, Keyboard, Loader2, Megaphone, Mic, Pause, Play } from 'lucide-react'

import { portalFetch, portalFetchBlob } from '../portalApi'
import { getSession } from '../session'
import { formatClock } from '../format'
import { LoadError, Empty } from '../components/LoadState'
import { TAB_BAR_HEIGHT } from '../layout'

const PAGE_SIZE = 20
const SOURCE_ICONS = { voice: Mic, typed: Keyboard, broadcast: Megaphone, routine: CalendarClock }
let liveSeq = 0

/* ai_response is JSONB: {text, parts} from the LLM, or {validate, reassure, redirect} from a fallback */
function replyText(ai) {
  if (!ai) return ''
  if (typeof ai === 'string') return ai
  if (ai.text) return ai.text
  if (Array.isArray(ai.parts) && ai.parts.length) return ai.parts.join(' ')
  return [ai.validate, ai.reassure, ai.redirect].filter(Boolean).join(' ')
}

const dayKey = (d) => d.toDateString()

export default function InteractionLog({ socket }) {
  const { t, i18n } = useTranslation()
  const [rows,       setRows]       = useState([])
  const [nextBefore, setNextBefore] = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error,      setError]      = useState(false)
  const [moreError,  setMoreError]  = useState(false)
  const [attempt,    setAttempt]    = useState(0)
  const [expanded,   setExpanded]   = useState(null)
  const [now]                         = useState(() => Date.now())
  const cardRef = useRef(null)
  const maxHeight = useFitAboveTabBar(cardRef)

  const fetchPage = useCallback(async (before) => {
    const pid = encodeURIComponent(getSession()?.patient_id)
    const cursor = before ? `&before=${before}` : ''
    return portalFetch(`/api/interactions?patientId=${pid}&limit=${PAGE_SIZE}${cursor}`)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchPage(null)
      .then(page => {
        if (cancelled) return
        setRows(page.interactions || [])
        setNextBefore(page.next_before)
        setError(false)
      })
      .catch(err => {
        if (cancelled || err.code === 'unauthorized') return
        console.error('interactions load failed:', err.message)
        setError(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [attempt, fetchPage])

  // Live rows (voice replies, broadcasts, routines) arrive without an id
  useEffect(() => {
    if (!socket) return
    const onNew = (row) => setRows(r => [{ ...row, id: `live-${++liveSeq}` }, ...r])
    socket.on('interaction:new', onNew)
    return () => socket.off('interaction:new', onNew)
  }, [socket])

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return
    setLoadingMore(true)
    setMoreError(false)
    try {
      const page = await fetchPage(nextBefore)
      setRows(r => [...r, ...(page.interactions || [])])
      setNextBefore(page.next_before)
    } catch (err) {
      if (err.code !== 'unauthorized') setMoreError(true)
    } finally {
      setLoadingMore(false)
    }
  }

  const retry = () => {
    setLoading(true)
    setError(false)
    setAttempt(a => a + 1)
  }

  const today     = dayKey(new Date(now))
  const yesterday = dayKey(new Date(now - 864e5))
  const dayLabel  = (d) => {
    const k = dayKey(d)
    if (k === today) return t('portal.patient.today')
    if (k === yesterday) return t('portal.patient.yesterday')
    return d.toLocaleDateString(i18n.language, { weekday: 'short', month: 'short', day: 'numeric' })
  }

  return (
    <section
      ref={cardRef}
      aria-labelledby="interaction-logs-title"
      className="flex min-h-[260px] flex-col rounded-card bg-surface text-white"
      style={{ maxHeight }}
    >
      <h2 id="interaction-logs-title" className="text-card shrink-0 px-4 pt-4 pb-2">
        {t('portal.patient.logsTitle')}
      </h2>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        {loading && (
          <div role="status" className="flex items-center justify-center gap-2 py-8">
            <Loader2 size={22} className="animate-spin" aria-hidden="true" />
            <span className="text-secondary">{t('portal.common.loading')}</span>
          </div>
        )}
        {error && !loading && <LoadError message={t('portal.patient.logsError')} onRetry={retry} />}
        {!loading && !error && rows.length === 0 && (
          <div className="px-2 py-6"><Empty>{t('portal.patient.logsEmpty')}</Empty></div>
        )}
        {!loading && !error && rows.length > 0 && (
          <ul className="flex flex-col">
            {rows.map((row, i) => {
              const at = new Date(row.created_at)
              const showDay = i === 0 || dayKey(new Date(rows[i - 1].created_at)) !== dayKey(at)
              return (
                <li key={row.id}>
                  {showDay && (
                    <p className="text-caption px-2 pt-3 pb-1 uppercase tracking-wide text-muted">
                      {dayLabel(at)}
                    </p>
                  )}
                  <LogRow
                    row={row}
                    time={formatClock(at, t)}
                    open={expanded === row.id}
                    onToggle={() => setExpanded(e => (e === row.id ? null : row.id))}
                  />
                </li>
              )
            })}
          </ul>
        )}
        {nextBefore && !loading && !error && (
          <div className="flex flex-col items-center gap-1 pt-3">
            {moreError && <p className="text-caption text-danger-soft">{t('portal.patient.logsMoreError')}</p>}
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="text-secondary flex min-h-[44px] items-center gap-2 rounded-control px-4 font-semibold text-muted disabled:opacity-60"
            >
              {loadingMore && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              {t('portal.patient.loadOlder')}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

/* Max height so the card ends just above the tab bar (the list scrolls inside it) */
function useFitAboveTabBar(ref) {
  const [maxHeight, setMaxHeight] = useState(undefined)
  useEffect(() => {
    const fit = () => {
      const el = ref.current
      if (!el) return
      const scroller = el.closest('main')
      const top = el.getBoundingClientRect().top + (scroller?.scrollTop || 0) - (scroller?.getBoundingClientRect().top || 0)
      const viewport = scroller?.clientHeight || window.innerHeight
      setMaxHeight(Math.max(260, viewport - top - TAB_BAR_HEIGHT - 12))
    }
    fit()
    window.addEventListener('resize', fit)
    const ro = new ResizeObserver(fit)
    if (ref.current?.parentElement) ro.observe(ref.current.parentElement)
    return () => { window.removeEventListener('resize', fit); ro.disconnect() }
  }, [ref])
  return maxHeight
}

function LogRow({ row, time, open, onToggle }) {
  const { t } = useTranslation()
  const reply  = replyText(row.ai_response)
  const panelId = `log-${row.id}`
  const hasAudio = !!row.audio_available && Array.isArray(row.waveform_peaks) && row.waveform_peaks.length > 0
  const backup   = !!row.ai_response?._fallback // static fallback (the model reply failed or timed out)

  return (
    <div className="py-2">
      <div className="flex min-h-[44px] items-center justify-between gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-h-[44px] items-center gap-2 pl-2 pr-1"
        >
          <span className="text-card whitespace-nowrap tabular-nums">{time}</span>
          <ChevronDown size={18} aria-hidden="true" className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
          {backup && <BackupTag />}
        </button>
        {hasAudio ? <WaveformPill row={row} /> : <SourcePill source={row.source} />}
      </div>
      {open && (
        <div id={panelId} className="text-secondary mx-2 mt-2 rounded-control bg-white/10 px-3 py-3">
          {row.source === 'routine' ? (
            <>
              <p className="text-caption text-muted">{t('portal.patient.routine')}</p>
              <p className="text-body whitespace-pre-line break-words">{row.transcript || '–'}</p>
              <p className="text-caption mt-2 text-muted">
                {row.ai_response?.missed ? t('portal.patient.routineMissed') : t('portal.patient.intactaReplied')}
              </p>
              <p className="text-body whitespace-pre-line break-words">{(row.ai_response?.missed ? row.ai_response.script : reply) || '–'}</p>
            </>
          ) : row.source === 'broadcast' ? (
            <>
              <p className="text-caption text-muted">{t('portal.patient.youSent')}</p>
              <p className="text-body whitespace-pre-line break-words">{row.transcript}</p>
            </>
          ) : (
            <>
              <p className="text-caption text-muted">{t('portal.patient.patientSaid')}</p>
              <p className="text-body whitespace-pre-line break-words">{row.transcript || '–'}</p>
              <p className="text-caption mt-2 flex items-center gap-2 text-muted">
                {t('portal.patient.intactaReplied')}
                {backup && <BackupTag />}
              </p>
              <p className="text-body whitespace-pre-line break-words">{reply || '–'}</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* Small tag on static fallback replies (B4 observability) */
function BackupTag() {
  const { t } = useTranslation()
  return (
    <span title={t('portal.patient.backupReplyHint')} className="text-caption rounded-full border border-white/50 px-2 py-[1px] text-white">
      {t('portal.patient.backupReply')}
    </span>
  )
}

/* Text-only pill: rows without audio (typed, broadcast, routine, or before the audio backend exists) */
function SourcePill({ source }) {
  const { t } = useTranslation()
  const Icon = SOURCE_ICONS[source] || Mic
  return (
    <span className="flex h-[36px] w-[132px] shrink-0 items-center justify-center gap-2 rounded-control bg-white px-2 text-[#043961]">
      <Icon size={18} aria-hidden="true" />
      <span className="text-caption truncate">{t(`portal.patient.source.${source}`, { defaultValue: source })}</span>
    </span>
  )
}

/* One clip plays at a time across the whole list */
const player = { audio: null, url: null, stop: null }
function stopCurrent() {
  if (player.audio) player.audio.pause()
  if (player.url) URL.revokeObjectURL(player.url)
  player.stop?.()
  player.audio = player.url = player.stop = null
}

function WaveformPill({ row }) {
  const { t } = useTranslation()
  const [state,    setState]    = useState('idle') // idle | loading | playing | paused | expired | error
  const [progress, setProgress] = useState(0)
  const mine = useRef(null)

  useEffect(() => () => { if (player.audio && player.audio === mine.current) stopCurrent() }, [])

  const peaks = row.waveform_peaks.map(Number)
  const max   = Math.max(...peaks, 1e-6)
  const BARS  = 30
  const bars  = Array.from({ length: BARS }, (_, i) => {
    const p = peaks[Math.floor((i / BARS) * peaks.length)] || 0
    return Math.max(0.12, p / max)
  })

  const toggle = async () => {
    if (state === 'expired' || state === 'loading') return
    if (state === 'playing') { mine.current?.pause(); setState('paused'); return }
    if (state === 'paused' && mine.current) { await mine.current.play(); setState('playing'); return }
    stopCurrent()
    setState('loading')
    try {
      const blob  = await portalFetchBlob(row.audio_url || `/api/interactions/${row.id}/audio`)
      const url   = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.ontimeupdate = () => setProgress(audio.duration ? audio.currentTime / audio.duration : 0)
      audio.onended = () => { setState('idle'); setProgress(0); stopCurrent() }
      player.audio = audio
      player.url   = url
      player.stop  = () => { setState(s => (s === 'expired' ? s : 'idle')); setProgress(0); mine.current = null }
      mine.current = audio
      await audio.play()
      setState('playing')
    } catch (err) {
      if (err.code === 'unauthorized') return
      console.error('clip play failed:', err.message)
      setState(err.code === 'expired' ? 'expired' : 'error')
    }
  }

  const label = state === 'expired' ? t('portal.patient.clipExpired')
    : state === 'error' ? t('portal.patient.clipError')
    : state === 'playing' ? t('portal.patient.pauseClip') : t('portal.patient.playClip')

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      disabled={state === 'expired'}
      className="relative flex h-[44px] w-[132px] shrink-0 items-center gap-1 rounded-control bg-white pl-2 pr-2 text-[#1e1e1e] disabled:opacity-60"
    >
      {state === 'loading'
        ? <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden="true" />
        : state === 'playing' ? <Pause size={14} className="shrink-0" aria-hidden="true" /> : <Play size={14} className="shrink-0" aria-hidden="true" />}
      {state === 'expired' || state === 'error' ? (
        <span className="text-caption flex-1 truncate text-center">{label}</span>
      ) : (
        <span className="relative flex h-[24px] flex-1 items-center justify-between" aria-hidden="true">
          {bars.map((h, i) => (
            <span
              key={i}
              className={`w-[2px] rounded-full ${i / BARS < progress ? 'bg-[#05668d]' : 'bg-[#1e1e1e]'}`}
              style={{ height: `${Math.round(h * 24)}px` }}
            />
          ))}
          <span className="absolute top-[-4px] bottom-[-4px] w-[2px] bg-[#1e1e1e]" style={{ left: `${progress * 100}%` }} />
        </span>
      )}
    </button>
  )
}
