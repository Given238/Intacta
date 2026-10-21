/**
 * RoutineForm — add / edit dialog for a routine (not in Figma).
 * Fields: title, time (HH:MM 24h, as the API expects), days, category, audio script (what the tablet says).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import Dialog, { DialogButton } from '../components/Dialog'

const ALL_DAYS   = [0, 1, 2, 3, 4, 5, 6]
const CATEGORIES = ['meal', 'medication', 'hygiene']
const TIME_24H   = /^([01]\d|2[0-3]):([0-5]\d)$/
const SCRIPT_MAX = 300 // spoken text: the server's content-safety maximum
const FIELD = 'text-body-regular w-full rounded-[10px] bg-white px-[14px] text-[15px] text-black outline-none focus-visible:ring-2 focus-visible:ring-[#54aed3]'

export default function RoutineForm({ routine, onCancel, onSave }) {
  const { t } = useTranslation()
  const [title,  setTitle]  = useState(routine?.title || '')
  const [time,   setTime]   = useState(routine ? String(routine.trigger_time).slice(0, 5) : '')
  const [days,   setDays]   = useState(Array.isArray(routine?.days) && routine.days.length ? routine.days.map(Number) : ALL_DAYS)
  const [category, setCategory] = useState(CATEGORIES.includes(routine?.category) ? routine.category : (routine?.category || ''))
  const [script, setScript] = useState(routine?.audio_script || '')
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [unsafe, setUnsafe] = useState(false)

  const letters = t('portal.routines.dayLetters', { returnObjects: true })
  const names   = t('portal.routines.dayNames', { returnObjects: true })

  const submit = async (e) => {
    e.preventDefault()
    if (saving) return
    const next = {}
    if (!title.trim()) next.title = t('portal.routines.errors.title')
    else if (title.trim().length > 100) next.title = t('portal.routines.errors.titleLong')
    if (!TIME_24H.test(time)) next.time = t('portal.routines.errors.time')
    if (days.length === 0) next.days = t('portal.routines.oneDayMin')
    if (!category) next.category = t('portal.routines.errors.category')
    if (!script.trim()) next.script = t('portal.routines.errors.script')
    else if (script.trim().length > SCRIPT_MAX) next.script = t('portal.routines.errors.scriptLong', { max: SCRIPT_MAX })
    setErrors(next)
    if (Object.keys(next).length) {
      document.getElementById(`routine-${Object.keys(next)[0]}`)?.focus()
      return
    }
    setUnsafe(false)
    setSaving(true)
    const result = await onSave({ title: title.trim(), trigger_time: time, days: [...days].sort(), category, audio_script: script.trim() })
    setSaving(false)
    if (result === 'unsafe') setUnsafe(true)
  }

  const err = (key) => errors[key] && (
    <p id={`routine-${key}-error`} className="text-body-medium mt-[4px] text-[12px] text-[#ffb4b4]">{errors[key]}</p>
  )
  const label = 'text-title-semibold mb-[6px] block text-[13px] text-intacta-text'

  return (
    <Dialog
      title={routine ? t('portal.routines.editTitle') : t('portal.routines.addTitle')}
      onClose={onCancel}
      footer={<>
        <DialogButton variant="ghost" onClick={onCancel}>{t('portal.common.cancel')}</DialogButton>
        <DialogButton type="submit" form="routine-form" disabled={saving}>{t('portal.common.save')}</DialogButton>
      </>}
    >
      <form id="routine-form" onSubmit={submit} noValidate className="flex flex-col gap-[14px]">
        <div>
          <label htmlFor="routine-title" className={label}>{t('portal.routines.fields.title')}</label>
          <input id="routine-title" value={title} onChange={e => { setTitle(e.target.value); setUnsafe(false) }} maxLength={120}
            aria-invalid={!!errors.title} aria-describedby="routine-title-error" className={`${FIELD} h-[44px]`} />
          {err('title')}
        </div>
        <div>
          <label htmlFor="routine-time" className={label}>{t('portal.routines.fields.time')}</label>
          <input id="routine-time" type="time" value={time} onChange={e => setTime(e.target.value)}
            aria-invalid={!!errors.time} aria-describedby="routine-time-error" className={`${FIELD} h-[44px]`} />
          {err('time')}
        </div>
        <fieldset>
          <legend className={label}>{t('portal.routines.fields.days')}</legend>
          <div id="routine-days" tabIndex={-1} className="flex justify-between gap-1">
            {ALL_DAYS.map(d => {
              const on = days.includes(d)
              return (
                <button key={d} type="button" aria-pressed={on} aria-label={names[d]}
                  onClick={() => setDays(cur => (on ? cur.filter(x => x !== d) : [...cur, d]))}
                  className={`flex h-[44px] w-[40px] items-center justify-center rounded-full text-[15px] ${on ? 'text-title-bold bg-intacta-dark text-white' : 'text-body-regular bg-white/10 text-white/70'}`}>
                  {letters[d]}
                </button>
              )
            })}
          </div>
          {err('days')}
        </fieldset>
        <div>
          <label htmlFor="routine-category" className={label}>{t('portal.routines.fields.category')}</label>
          <select id="routine-category" value={category} onChange={e => setCategory(e.target.value)}
            aria-invalid={!!errors.category} aria-describedby="routine-category-error" className={`${FIELD} h-[44px]`}>
            <option value="" disabled>{t('portal.routines.fields.categoryPick')}</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{t(`portal.home.category.${c}`)}</option>)}
            {category === 'other' && <option value="other">{t('portal.home.category.other')}</option>}
          </select>
          {err('category')}
        </div>
        <div>
          <label htmlFor="routine-script" className={label}>{t('portal.routines.fields.script')}</label>
          <textarea id="routine-script" value={script} onChange={e => { setScript(e.target.value); setUnsafe(false) }} rows={3}
            placeholder={t('portal.routines.fields.scriptHint')}
            aria-invalid={!!errors.script} aria-describedby="routine-script-error" className={`${FIELD} resize-none py-[10px]`} />
          {err('script')}
        </div>
        {unsafe && (
          <p role="alert" className="text-body-medium rounded-[10px] bg-[#dc2626]/20 px-[12px] py-[10px] text-[13px] text-[#ffd0d0]">
            {t('portal.safety.unsafe')}
          </p>
        )}
      </form>
    </Dialog>
  )
}
