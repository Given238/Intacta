/**
 * Home — caregiver dashboard (Figma 29:42, iPhone 17 402×874).
 *
 *   Date (screen title), Caregiver + Patient cards, Daily context bar, Schedule card. Figma sizes are a reference:
 *   text uses the portal type scale. From 768px the schedule moves to a right column.
 *
 * Data: GET /api/patient/status, /api/context-items?scope=daily, /api/routines (active, today's weekday).
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Loader2 } from 'lucide-react'

import { portalFetch } from '../portalApi'
import { jakartaClock } from '../../lib/jakartaTime'
import { getSession } from '../session'

const CARD = 'rounded-card bg-surface text-white'

/* "08:00:00" → minutes since midnight */
const toMinutes = (time) => {
  const [h, m] = String(time).split(':').map(Number)
  return h * 60 + (m || 0)
}

/* days is SMALLINT[] 0=Sun..6=Sat; NULL means every day */
const runsToday = (routine, weekday) =>
  routine.is_active !== false && (!Array.isArray(routine.days) || routine.days.map(Number).includes(weekday))

async function loadHome(patientId) {
  const pid = encodeURIComponent(patientId)
  const [status, context, routines] = await Promise.all([
    portalFetch(`/api/patient/status?patientId=${pid}`),
    portalFetch(`/api/context-items?patientId=${pid}&scope=daily`),
    portalFetch(`/api/routines?patientId=${pid}`),
  ])
  const { weekday } = jakartaClock() // routine days/times are Asia/Jakarta
  return {
    status:   status.status,
    daily:    context.items || [],
    routines: (routines.routines || [])
      .filter(r => runsToday(r, weekday))
      .sort((a, b) => toMinutes(a.trigger_time) - toMinutes(b.trigger_time)),
  }
}

export default function Home() {
  const { t, i18n } = useTranslation()
  const [data,     setData]     = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(false)
  const [attempt,  setAttempt]  = useState(0)
  const [now,      setNow]      = useState(() => new Date())

  useEffect(() => {
    let cancelled = false
    loadHome(getSession()?.patient_id)
      .then(result => {
        if (cancelled) return
        setData(result)
        setNow(new Date())
        setError(false)
      })
      .catch(err => {
        if (cancelled || err.code === 'unauthorized') return // portalFetch is already redirecting to pairing
        console.error('home load failed:', err.message)
        setError(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [attempt])

  const retry = () => {
    setLoading(true)
    setError(false)
    setAttempt(a => a + 1)
  }

  const today = now.toLocaleDateString(i18n.language, { weekday: 'long', month: 'short', day: 'numeric' })
  /* "08:00:00" → "08:00 A.M" (Figma style, 12-hour) */
  const formatTime = (time) => {
    const mins = toMinutes(time)
    const h24  = Math.floor(mins / 60)
    const h12  = h24 % 12 || 12
    const pad  = (n) => String(n).padStart(2, '0')
    return `${pad(h12)}:${pad(mins % 60)} ${t(h24 < 12 ? 'portal.home.am' : 'portal.home.pm')}`
  }
  const nowMinutes = jakartaClock(now).minutes

  return (
    <div className="text-white">
      <h1 className="text-title">{today}</h1>

      {loading && !data && (
        <div role="status" className="mt-10 flex flex-col items-center gap-3 text-white">
          <Loader2 size={28} className="animate-spin" aria-hidden="true" />
          <span className="text-body">{t('portal.home.loading')}</span>
        </div>
      )}

      {error && !loading && (
        <div role="alert" className={`${CARD} mt-4 flex flex-col items-center gap-4 px-6 py-6 text-center`}>
          <p className="text-body">{t('portal.home.error')}</p>
          <button
            type="button"
            onClick={retry}
            className="text-body min-h-[44px] rounded-control bg-intacta-dark px-6 font-semibold text-white"
          >
            {t('portal.home.retry')}
          </button>
        </div>
      )}

      {data && !error && (
        /* Phones: one column. From 768px: cards on the left, the schedule on the right */
        <div className="mt-4 grid gap-4 md:grid-cols-2 md:items-start">
          {/* Caregiver + Patient cards */}
          <div className="grid grid-cols-2 gap-4">
            <div className={`${CARD} min-h-[96px] p-4`}>
              <h2 className="text-card">{t('portal.home.caregiver')}</h2>
              <p className="text-secondary mt-2 break-words text-muted">
                {/* The status API has no caregiver name yet, so this shows the fallback */}
                {t('portal.home.shift', { name: data.status?.caregiver_name || t('portal.home.fallbackCaregiver') })}
              </p>
            </div>
            <div className={`${CARD} min-h-[96px] p-4`}>
              <h2 className="text-card">{t('portal.home.patient')}</h2>
              <p className="text-secondary mt-2 break-words text-muted">
                {data.status?.patient_name || t('portal.home.fallbackPatient')}
              </p>
            </div>
          </div>

          {/* Schedule */}
          <section className={`${CARD} p-4 md:col-start-2 md:row-span-2 md:row-start-1`}>
            <h2 className="text-card">{t('portal.home.schedule')}</h2>
            {data.routines.length === 0 ? (
              <p className="text-secondary mt-3 text-muted">{t('portal.home.noRoutines')}</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {data.routines.map(r => (
                  <li key={r.id} className="text-body flex flex-wrap items-center gap-x-2">
                    {/* Figma strikes through routines that are already past for today */}
                    <span className={toMinutes(r.trigger_time) < nowMinutes ? 'text-muted line-through' : ''}>
                      <span className="tabular-nums">{formatTime(r.trigger_time)}</span>
                      {' – '}{r.title || r.display_text || t(`portal.home.category.${r.category}`)}
                    </span>
                    {r.blocked_category && (
                      <span className="text-caption rounded-full bg-[#dc2626] px-2 py-[2px] text-white">{t('portal.safety.blocked')}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Daily context bar → Context tab */}
          <Link to="/portal/context" className={`${CARD} flex min-h-[56px] items-center gap-2 px-4 py-3`}>
            <span className="min-w-0 flex-1">
              <span className="text-card block">{t('portal.home.dailyContext')}</span>
              <span className="text-secondary block truncate text-muted">
                {data.daily.find(i => !i.blocked_category)?.text || t('portal.home.noNotes')}
              </span>
            </span>
            <ChevronRight size={22} className="shrink-0" aria-hidden="true" />
          </Link>
        </div>
      )}
    </div>
  )
}
