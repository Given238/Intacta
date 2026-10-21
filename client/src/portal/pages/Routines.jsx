/**
 * Routines — daily routine schedule (Figma page "Caregiver -> Routines": frame 60:30 holds only the header and the
 * "enable all routines" label; the rest sits on the canvas: switch 93:202, chip 93:222, card 93:223, rows 93:254…).
 *
 *   Top:   chip 181×42 #043961 r10 ("active:" / "next:" Inter ExtraBold 12 + Light) · "enable all routines" Bold 12 + switch 52×32
 *   Card:  374 wide #043961 r10; "Daily Routines" Inter ExtraBold 24; plus-circle opens the add modal
 *   Row:   time pill 106×32 #466781 r10 (Light 16) · title Light 14 · switch 46×26 · pen · trash
 *          days "S M T W T F S" below (Inter 14, selected Bold)
 *
 * Data: GET/POST/PUT/DELETE /api/routines; toggles optimistic with rollback, the form waits for the server.
 * Home's Schedule reads the same endpoint. Safety: an unsafe title/script is refused (422 unsafe_content) and shown in
 * the form; a stored routine that fails the re-check has blocked_category → red "Blocked for safety" label, never fired.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import penIcon        from '../../assets/icons/pen.svg'
import trashIcon      from '../../assets/icons/trash.svg'
import plusCircleIcon from '../../assets/icons/plus-circle.svg'
import { portalFetch } from '../portalApi'
import { jakartaClock } from '../../lib/jakartaTime'
import { getSession } from '../session'
import { usePortalLoad, sessionPatientId } from '../usePortalLoad'
import { formatClock, timeToMinutes } from '../format'
import PortalToast from '../components/PortalToast'
import Switch from '../components/Switch'
import Dialog, { DialogButton } from '../components/Dialog'
import { Loading, LoadError, Empty } from '../components/LoadState'
import RoutineForm from './RoutineForm'

const PANEL     = 'rounded-[10px] bg-[#043961] text-white'
const ALL_DAYS  = [0, 1, 2, 3, 4, 5, 6]
const GROUPS    = [
  { key: 'morning',   from: 0,       to: 12 * 60 },
  { key: 'afternoon', from: 12 * 60, to: 18 * 60 },
  { key: 'evening',   from: 18 * 60, to: 24 * 60 },
]

const daysOf   = (r) => (Array.isArray(r.days) && r.days.length ? r.days.map(Number) : ALL_DAYS)
const byTime   = (a, b) => timeToMinutes(a.trigger_time) - timeToMinutes(b.trigger_time)

async function loadRoutines() {
  const pid = encodeURIComponent(getSession()?.patient_id)
  const { routines = [] } = await portalFetch(`/api/routines?patientId=${pid}`)
  return routines
}

export default function Routines() {
  const { t } = useTranslation()
  const { data: routines, setData: setRoutines, loading, error, retry } = usePortalLoad(loadRoutines)
  const [toast,    setToast]    = useState(null)
  const [editing,  setEditing]  = useState(null)   // null | 'new' | routine
  const [deleting, setDeleting] = useState(null)
  const [now]                   = useState(() => new Date())

  const showToast = (message) => {
    setToast(message)
    setTimeout(() => setToast(cur => (cur === message ? null : cur)), 4000)
  }

  const replace = (id, next) => setRoutines(list => list.map(r => (r.id === id ? next : r)))

  /* PUT a change optimistically; restore the previous row on failure */
  const update = async (routine, changes) => {
    const optimistic = { ...routine, ...changes }
    replace(routine.id, optimistic)
    try {
      const { routine: saved } = await portalFetch(`/api/routines/${routine.id}`, { method: 'PUT', body: JSON.stringify(changes) })
      replace(routine.id, saved)
      return true
    } catch (err) {
      if (err.code === 'unauthorized') return false
      console.error('routine update failed:', err.message)
      replace(routine.id, routine)
      showToast(t('portal.routines.saveFailed'))
      return false
    }
  }

  const toggleAll = async (on) => {
    const changed = routines.filter(r => r.is_active !== on)
    const results = await Promise.all(changed.map(r => update(r, { is_active: on })))
    if (results.includes(false)) showToast(t('portal.routines.toggleAllFailed'))
  }

  const toggleDay = (routine, day) => {
    const current = daysOf(routine)
    const next = current.includes(day) ? current.filter(d => d !== day) : [...current, day].sort()
    if (next.length === 0) {
      showToast(t('portal.routines.oneDayMin'))
      return
    }
    update(routine, { days: next })
  }

  /* Add / edit from the form: waits for the server so a safety refusal can be shown inside the form.
     Returns 'ok' | 'unsafe' | 'error'. */
  const save = async (values) => {
    try {
      if (editing === 'new') {
        const { routine } = await portalFetch('/api/routines', {
          method: 'POST',
          body: JSON.stringify({ patientId: sessionPatientId(getSession()), ...values, is_active: true }),
        })
        setRoutines(list => [...list, routine])
      } else {
        const { routine } = await portalFetch(`/api/routines/${editing.id}`, { method: 'PUT', body: JSON.stringify(values) })
        replace(editing.id, routine)
      }
      setEditing(null)
      return 'ok'
    } catch (err) {
      if (err.code === 'unauthorized') return 'error'
      if (err.code === 'unsafe_content') return 'unsafe'
      console.error('routine save failed:', err.message)
      showToast(t(editing === 'new' ? 'portal.routines.createFailed' : 'portal.routines.saveFailed'))
      return 'error'
    }
  }

  const remove = async (routine) => {
    setDeleting(null)
    const index = routines.findIndex(r => r.id === routine.id)
    setRoutines(list => list.filter(r => r.id !== routine.id))
    try {
      await portalFetch(`/api/routines/${routine.id}`, { method: 'DELETE' })
    } catch (err) {
      if (err.code === 'unauthorized' || err.status === 404) return
      console.error('routine delete failed:', err.message)
      setRoutines(list => { const next = [...list]; next.splice(Math.min(index, next.length), 0, routine); return next })
      showToast(t('portal.routines.deleteFailed'))
    }
  }

  return (
    <div className="px-[10px] pt-[19px] text-white">
      <PortalToast message={toast} />
      {loading && !routines && <Loading />}
      {error && !loading && <LoadError onRetry={retry} />}
      {routines && !error && (
        <>
          <Summary routines={routines} now={now} onToggleAll={toggleAll} />
          <section className={`${PANEL} mt-[8px] pt-[24px] pb-[20px] pl-[14px] pr-[12px]`} aria-labelledby="routines-title">
            <div className="flex items-center justify-between pl-[12px]">
              <h2 id="routines-title" className="text-display text-[24px] leading-[20px] tracking-[0.1px]">
                {t('portal.routines.title')}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setEditing('new')}
              aria-label={t('portal.routines.add')}
              className="mt-[18px] -ml-[12px] flex h-[44px] items-center gap-2 px-[12px]"
            >
              <img src={plusCircleIcon} alt="" width={20.6667} height={20.6667} />
              <span className="text-body-medium text-[13px] text-intacta-text">{t('portal.routines.add')}</span>
            </button>

            {routines.length === 0 && <div className="py-4 pl-[10px]"><Empty>{t('portal.routines.empty')}</Empty></div>}
            {GROUPS.map(group => {
              const items = routines
                .filter(r => { const m = timeToMinutes(r.trigger_time); return m >= group.from && m < group.to })
                .sort(byTime)
              if (items.length === 0) return null
              return (
                <div key={group.key} className="mt-[8px]">
                  <h3 className="text-title-semibold pt-[6px] pb-[2px] text-[12px] uppercase tracking-wide text-intacta-text">
                    {t(`portal.routines.groups.${group.key}`)}
                  </h3>
                  <ul className="flex flex-col gap-[10px]">
                    {items.map(r => (
                      <RoutineRow
                        key={r.id}
                        routine={r}
                        onToggle={on => update(r, { is_active: on })}
                        onToggleDay={day => toggleDay(r, day)}
                        onEdit={() => setEditing(r)}
                        onDelete={() => setDeleting(r)}
                      />
                    ))}
                  </ul>
                </div>
              )
            })}
          </section>
        </>
      )}

      {editing && (
        <RoutineForm
          routine={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      )}
      {deleting && (
        <Dialog
          title={t('portal.routines.deleteTitle')}
          onClose={() => setDeleting(null)}
          footer={<>
            <DialogButton variant="ghost" onClick={() => setDeleting(null)}>{t('portal.common.cancel')}</DialogButton>
            <DialogButton variant="danger" onClick={() => remove(deleting)}>{t('portal.routines.delete')}</DialogButton>
          </>}
        >
          <p className="text-body-regular text-[15px] leading-snug">
            {t('portal.routines.deleteBody', { title: deleting.title || t(`portal.home.category.${deleting.category}`) })}
          </p>
        </Dialog>
      )}
    </div>
  )
}

function Summary({ routines, now, onToggleAll }) {
  const { t } = useTranslation()
  const active  = routines.filter(r => r.is_active !== false)
  const clock   = jakartaClock(now) // routine times are Asia/Jakarta
  const nowMins = clock.minutes
  const next    = active
    .filter(r => daysOf(r).includes(clock.weekday) && timeToMinutes(r.trigger_time) > nowMins)
    .sort(byTime)[0]
  const allOn   = routines.length > 0 && active.length === routines.length

  return (
    <div className="flex items-center justify-between gap-2 pl-[4px]">
      <div className="min-w-0 max-w-[230px] rounded-[10px] bg-[#043961] px-[9px] py-[1px] text-[12px] leading-[20px] tracking-[0.1px]" role="status">
        <p className="truncate">
          <span className="text-display">{t('portal.routines.active')} </span>
          <span className="text-body-light">{active.length}</span>
        </p>
        <p className="truncate">
          <span className="text-display">{t('portal.routines.next')} </span>
          <span className="text-body-light">
            {next
              ? t('portal.routines.nextAt', { title: next.title || t(`portal.home.category.${next.category}`), time: formatClock(timeToMinutes(next.trigger_time), t) })
              : t('portal.routines.noneToday')}
          </span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-[8px] pr-[8px]">
        <label htmlFor="enable-all" className="text-title-bold text-center text-[12px] leading-tight whitespace-pre-line">
          {t('portal.routines.enableAll')}
        </label>
        <Switch id="enable-all" checked={allOn} disabled={routines.length === 0} onChange={onToggleAll} />
      </div>
    </div>
  )
}

function RoutineRow({ routine, onToggle, onToggleDay, onEdit, onDelete }) {
  const { t } = useTranslation()
  const days  = daysOf(routine)
  const title = routine.title || t(`portal.home.category.${routine.category}`)
  const letters = t('portal.routines.dayLetters', { returnObjects: true })
  const names   = t('portal.routines.dayNames', { returnObjects: true })
  const off = routine.is_active === false

  return (
    <li className={routine.pending ? 'opacity-60' : ''}>
      <div className="flex items-center gap-[8px]">
        <span className={`text-body-light flex h-[32px] w-[106px] shrink-0 items-center justify-center rounded-[10px] bg-[#466781] text-[16px] tracking-[0.1px] ${off ? 'opacity-60' : ''}`}>
          {formatClock(timeToMinutes(routine.trigger_time), t)}
        </span>
        <span className={`text-body-light min-w-0 flex-1 truncate text-[14px] tracking-[0.1px] ${off ? 'opacity-60' : ''}`}>{title}</span>
        {routine.blocked_category && (
          <span className="text-title-semibold shrink-0 rounded-full bg-[#dc2626] px-2 py-[2px] text-[11px] text-white">{t('portal.safety.blocked')}</span>
        )}
        <Switch size="sm" checked={!off} disabled={routine.pending} onChange={onToggle} label={t('portal.routines.toggle', { title })} />
        <button type="button" onClick={onEdit} disabled={routine.pending} aria-label={t('portal.routines.edit', { title })}
          className="flex h-[44px] w-[30px] shrink-0 items-center justify-center disabled:opacity-40">
          <img src={penIcon} alt="" width={14.9333} height={14.9333} />
        </button>
        <button type="button" onClick={onDelete} disabled={routine.pending} aria-label={t('portal.routines.deleteItem', { title })}
          className="flex h-[44px] w-[30px] shrink-0 items-center justify-center disabled:opacity-40">
          <img src={trashIcon} alt="" width={13.6} height={14.9333} />
        </button>
      </div>
      <div className="mt-[-4px] flex gap-[1px] pl-[4px]" role="group" aria-label={t('portal.routines.daysFor', { title })}>
        {ALL_DAYS.map(d => {
          const on = days.includes(d)
          return (
            <button
              key={d}
              type="button"
              disabled={routine.pending}
              aria-pressed={on}
              aria-label={names[d]}
              onClick={() => onToggleDay(d)}
              className={`flex h-[30px] w-[24px] items-center justify-center text-[14px] tracking-[0.1px] ${on ? 'text-title-bold text-white' : 'text-body-light text-white/45'}`}
            >
              {letters[d]}
            </button>
          )
        })}
      </div>
    </li>
  )
}

