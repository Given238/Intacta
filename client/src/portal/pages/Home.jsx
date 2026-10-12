/**
 * Home — caregiver dashboard (Figma 29:42, iPhone 17 402×874).
 *
 *   Date:    top 18 below header, left 21, Inter Bold 13px white
 *   Cards:   Caregiver + Patient, 160×89 each, 28px gap, #043961, radius 25,
 *            title Inter Bold 13px, value Inter Light 13px one blank line below
 *   Daily:   348×48 bar, radius 25, "Daily context" SemiBold 13px + first daily item Light 13px
 *   Schedule: 355 wide card, radius 25, "Schedule" SemiBold 13px, rows Light 13px every 25px
 *
 * Data: GET /api/patient/status, /api/context-items?scope=daily, /api/routines (active, today's weekday).
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Loader2 } from 'lucide-react'

import { portalFetch } from '../portalApi'
import { getSession } from '../session'

const CARD = 'rounded-[25px] bg-[#043961] text-white'

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
  const weekday = new Date().getDay()
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
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  return (
    <div className="pl-[21px] pr-[26px] pt-[18px] text-[13px] text-white">
      <p className="text-title-bold leading-normal">{today}</p>

      {loading && !data && (
        <div role="status" className="mt-10 flex flex-col items-center gap-3 text-white">
          <Loader2 size={28} className="animate-spin" aria-hidden="true" />
          <span className="text-body-medium text-[15px]">{t('portal.home.loading')}</span>
        </div>
      )}

      {error && !loading && (
        <div role="alert" className={`${CARD} mt-[11px] flex flex-col items-center gap-4 px-6 py-6 text-center`}>
          <p className="text-body-medium text-[15px] leading-snug">{t('portal.home.error')}</p>
          <button
            type="button"
            onClick={retry}
            className="min-h-[44px] rounded-[10px] bg-intacta-dark px-6 text-title-bold text-[15px] text-white"
          >
            {t('portal.home.retry')}
          </button>
        </div>
      )}

      {data && !error && (
        <>
          {/* Caregiver + Patient cards */}
          <div className="mt-[11px] grid grid-cols-2 gap-[28px] pl-[7px]">
            <div className={`${CARD} min-h-[89px] px-[21px] pt-[12px] pb-[12px]`}>
              <p className="text-title-bold leading-normal">{t('portal.home.caregiver')}</p>
              <p className="mt-[16px] break-words text-body-light leading-normal">
                {/* The status API has no caregiver name yet, so this shows the fallback */}
                {t('portal.home.shift', { name: data.status?.caregiver_name || t('portal.home.fallbackCaregiver') })}
              </p>
            </div>
            <div className={`${CARD} min-h-[89px] px-[18px] pt-[13px] pb-[12px]`}>
              <p className="text-title-bold leading-normal">{t('portal.home.patient')}</p>
              <p className="mt-[16px] break-words text-body-light leading-normal">
                {data.status?.patient_name || t('portal.home.fallbackPatient')}
              </p>
            </div>
          </div>

          {/* Daily context bar → Context tab */}
          <Link
            to="/portal/context"
            className={`${CARD} mt-[18px] ml-[7px] flex min-h-[48px] items-center gap-2 py-[5px] pl-[21px] pr-[16px]`}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-title-semibold leading-normal">{t('portal.home.dailyContext')}</span>
              <span className="block truncate pl-[7px] text-body-light leading-normal">
                {data.daily[0]?.text || t('portal.home.noNotes')}
              </span>
            </span>
            <ChevronRight size={22} className="shrink-0" aria-hidden="true" />
          </Link>

          {/* Schedule */}
          <section className={`${CARD} mt-[22px] pt-[14px] pb-[28px] pl-[23px] pr-[16px]`}>
            <h2 className="text-title-semibold leading-normal">{t('portal.home.schedule')}</h2>
            {data.routines.length === 0 ? (
              <p className="mt-[26px] pl-[8px] text-body-light leading-normal">{t('portal.home.noRoutines')}</p>
            ) : (
              <ul className="mt-[26px] flex flex-col gap-[9px] pl-[8px]">
                {data.routines.map(r => (
                  <li
                    key={r.id}
                    // Figma strikes through routines that are already past for today
                    className={`text-body-light leading-normal ${toMinutes(r.trigger_time) < nowMinutes ? 'line-through' : ''}`}
                  >
                    {formatTime(r.trigger_time)} - {r.title || r.display_text || t(`portal.home.category.${r.category}`)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
