/**
 * Context — daily + permanent notes the tablet's LLM uses (Figma 60:60, iPhone 17 402×874).
 *
 *   Two cards (Daily, Permanent), side by side from 768px. Items with pen + trash (Figma 107:1627), white pill input
 *   with plus-circle (Figma 107:1634). Figma sizes are a reference; text uses the portal type scale.
 *
 * Data: GET /api/context-items (today's daily + permanent), POST / DELETE with optimistic update + rollback.
 * Every mutation makes the server push context:sync to the paired terminal.
 * Safety: the server refuses text that could frighten the patient (422 unsafe_content) → inline message, text kept.
 * While the server checks it the button says "Checking..."; if it cannot verify the text (503 safety_unavailable) nothing is
 * saved and the caregiver is asked to try again (fail closed).
 * Stored items that fail a re-check come back with blocked_category: shown with a red "Blocked for safety" label,
 * never sent to the tablet, still editable (PUT) and deletable. A distressing but factual note (sensitive) is kept as
 * background with a small "Private note" label: the assistant never mentions it.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import penIcon        from '../../assets/icons/pen.svg'
import trashIcon      from '../../assets/icons/trash.svg'
import plusCircleIcon from '../../assets/icons/plus-circle.svg'
import { portalFetch } from '../portalApi'
import { getSession } from '../session'
import { usePortalLoad, sessionPatientId } from '../usePortalLoad'
import PortalToast from '../components/PortalToast'
import { CARD, Loading, LoadError, Empty } from '../components/LoadState'

const MAX_CHARS     = 200
const COUNTER_FROM  = 160
const SCOPES        = ['daily', 'permanent']
let tempSeq = 0

async function loadContext() {
  const pid = encodeURIComponent(getSession()?.patient_id)
  const { items = [] } = await portalFetch(`/api/context-items?patientId=${pid}`)
  return {
    daily:     items.filter(i => i.scope === 'daily'),
    permanent: items.filter(i => i.scope === 'permanent'),
  }
}

export default function Context() {
  const { t } = useTranslation()
  const { data, setData, loading, error, retry } = usePortalLoad(loadContext)
  const [toast, setToast] = useState(null)

  const showToast = (message) => {
    setToast(message)
    setTimeout(() => setToast(cur => (cur === message ? null : cur)), 4000)
  }

  const addItem = async (scope, text) => {
    const temp = { id: `tmp-${++tempSeq}`, scope, text, pending: true }
    setData(d => ({ ...d, [scope]: [...d[scope], temp] }))
    try {
      const { item } = await portalFetch('/api/context-items', {
        method: 'POST',
        body: JSON.stringify({ patientId: sessionPatientId(getSession()), scope, text }),
      })
      setData(d => ({ ...d, [scope]: d[scope].map(i => (i.id === temp.id ? item : i)) }))
      return 'ok'
    } catch (err) {
      setData(d => ({ ...d, [scope]: d[scope].filter(i => i.id !== temp.id) }))
      if (err.code === 'unauthorized') return 'error'
      if (err.code === 'unsafe_content') return 'unsafe'
      if (err.code === 'safety_unavailable') return 'unavailable'
      console.error('add context failed:', err.message)
      showToast(t('portal.context.addFailed'))
      return 'error'
    }
  }

  const editItem = async (scope, item, text) => {
    try {
      const { item: saved } = await portalFetch(`/api/context-items/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({ text }),
      })
      setData(d => ({ ...d, [scope]: d[scope].map(i => (i.id === item.id ? saved : i)) }))
      return 'ok'
    } catch (err) {
      if (err.code === 'unauthorized') return 'error'
      if (err.code === 'unsafe_content') return 'unsafe'
      if (err.code === 'safety_unavailable') return 'unavailable'
      console.error('edit context failed:', err.message)
      showToast(t('portal.context.addFailed'))
      return 'error'
    }
  }

  const deleteItem = async (scope, item) => {
    const index = data[scope].findIndex(i => i.id === item.id)
    setData(d => ({ ...d, [scope]: d[scope].filter(i => i.id !== item.id) }))
    try {
      await portalFetch(`/api/context-items/${item.id}`, { method: 'DELETE' })
    } catch (err) {
      if (err.code === 'unauthorized') return
      // 404: already gone on the server, keep it removed
      if (err.status === 404) return
      console.error('delete context failed:', err.message)
      setData(d => {
        const list = [...d[scope]]
        list.splice(Math.min(index, list.length), 0, item)
        return { ...d, [scope]: list }
      })
      showToast(t('portal.context.deleteFailed'))
    }
  }

  return (
    <div className="text-white">
      <h1 className="text-title mb-4">{t('portal.tabs.context')}</h1>
      <PortalToast message={toast} />
      {loading && !data && <Loading />}
      {error && !loading && <LoadError onRetry={retry} />}
      {data && !error && (
        /* The two lists side by side from 768px */
        <div className="grid gap-6 md:grid-cols-2 md:items-start">
          {SCOPES.map(scope => (
            <ContextCard
              key={scope}
              scope={scope}
              items={data[scope]}
              onAdd={text => addItem(scope, text)}
              onEdit={(item, text) => editItem(scope, item, text)}
              onDelete={item => deleteItem(scope, item)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ContextCard({ scope, items, onAdd, onEdit, onDelete }) {
  const { t } = useTranslation()
  const [text,       setText]       = useState('')
  const [inputError, setInputError] = useState(null)
  const [confirmId,  setConfirmId]  = useState(null)
  const [saving,     setSaving]     = useState(false)

  const trimmed  = text.trim()
  const tooLong  = trimmed.length > MAX_CHARS
  const inputId  = `context-add-${scope}`
  const errorId  = `${inputId}-error`

  const submit = async (e) => {
    e.preventDefault()
    if (saving) return
    if (!trimmed) {
      setInputError(t('portal.context.errors.empty'))
      return
    }
    if (tooLong) {
      setInputError(t('portal.context.errors.tooLong', { max: MAX_CHARS }))
      return
    }
    if (items.some(i => i.text.trim().toLowerCase() === trimmed.toLowerCase())) {
      setInputError(t('portal.context.errors.duplicate'))
      return
    }
    setInputError(null)
    setSaving(true)
    setText('')
    const result = await onAdd(trimmed)
    setSaving(false)
    if (result !== 'ok') setText(trimmed) // give the text back so it can be retried or rephrased
    if (result === 'unsafe' || result === 'unavailable') setInputError(t(`portal.safety.${result}`))
  }


  return (
    <section className={`${CARD} p-4`} aria-labelledby={`${inputId}-title`}>
      <h2 id={`${inputId}-title`} className="text-card">
        {t(`portal.context.${scope}.title`)}
      </h2>

      <ul className="mt-2 flex flex-col gap-1">
        {items.length === 0 && (
          <li className="py-2"><Empty>{t(`portal.context.${scope}.empty`)}</Empty></li>
        )}
        {items.map(item => (
          <ContextItemRow
            key={item.id}
            item={item}
            confirming={confirmId === item.id}
            onConfirm={() => setConfirmId(item.id)}
            onCancelConfirm={() => setConfirmId(null)}
            onDelete={() => { setConfirmId(null); onDelete(item) }}
            onEdit={text => onEdit(item, text)}
          />
        ))}
      </ul>

      <form onSubmit={submit} noValidate className="mt-4">
        <div className="flex items-center gap-3">
          <label htmlFor={inputId} className="sr-only">{t(`portal.context.${scope}.placeholder`)}</label>
          <input
            id={inputId}
            type="text"
            enterKeyHint="done"
            value={text}
            onChange={e => { setText(e.target.value); setInputError(null) }}
            placeholder={t(`portal.context.${scope}.placeholder`)}
            aria-invalid={!!inputError || tooLong}
            aria-describedby={errorId}
            className="text-body h-[44px] min-w-0 flex-1 rounded-full bg-white px-4 text-black
                       outline-none placeholder:text-black/60 focus-visible:ring-2 focus-visible:ring-[#54aed3]"
          />
          <button
            type="submit"
            disabled={saving}
            aria-label={saving ? t('portal.safety.checking') : t('portal.context.add')}
            className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full disabled:opacity-50"
          >
            {saving
              ? <Loader2 size={20} className="animate-spin" aria-hidden="true" />
              : <img src={plusCircleIcon} alt="" width={20.6667} height={20.6667} />}
          </button>
        </div>
        <div id={errorId} aria-live="polite" className="text-caption flex min-h-[18px] justify-between gap-2 px-4 pt-1">
          <span className="text-danger-soft">
            {saving
              ? <span className="text-muted">{t('portal.safety.checking')}</span>
              : inputError || (tooLong ? t('portal.context.errors.tooLong', { max: MAX_CHARS }) : '')}
          </span>
          {trimmed.length >= COUNTER_FROM && (
            <span className={`shrink-0 tabular-nums ${tooLong ? 'text-danger-soft' : 'text-muted'}`}>
              {trimmed.length}/{MAX_CHARS}
            </span>
          )}
        </div>
      </form>
    </section>
  )
}

function ContextItemRow({ item, confirming, onConfirm, onCancelConfirm, onDelete, onEdit }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(item.text)
  const [error,   setError]   = useState(null)
  const [saving,  setSaving]  = useState(false)
  const blocked = !!item.blocked_category
  const inputId = `context-edit-${item.id}`
  const errorId = `${inputId}-error`

  const save = async (e) => {
    e.preventDefault()
    const clean = draft.trim()
    if (!clean) { setError(t('portal.context.errors.empty')); return }
    if (clean.length > MAX_CHARS) { setError(t('portal.context.errors.tooLong', { max: MAX_CHARS })); return }
    setSaving(true)
    const result = await onEdit(clean)
    setSaving(false)
    if (result === 'ok') { setEditing(false); setError(null) }
    else if (result === 'unsafe' || result === 'unavailable') setError(t(`portal.safety.${result}`))
  }

  if (editing) {
    return (
      <li>
        <form onSubmit={save} noValidate className="flex flex-col gap-2 py-1">
          <label htmlFor={inputId} className="sr-only">{t('portal.safety.editItem', { text: item.text })}</label>
          <input
            id={inputId}
            value={draft}
            onChange={e => { setDraft(e.target.value); setError(null) }}
            aria-invalid={!!error}
            aria-describedby={errorId}
            autoFocus
            className="text-body h-[44px] w-full rounded-full bg-white px-4 text-black outline-none focus-visible:ring-2 focus-visible:ring-[#54aed3]"
          />
          <p id={errorId} aria-live="polite" className="text-caption px-2 text-danger-soft">{error}</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setEditing(false); setDraft(item.text); setError(null) }}
              className="text-body min-h-[44px] rounded-full px-3 text-muted"
            >
              {t('portal.safety.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="text-body min-h-[44px] rounded-full bg-white px-4 font-semibold text-[#043961] disabled:opacity-50"
            >
              {saving
                ? <span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" aria-hidden="true" />{t('portal.safety.checking')}</span>
                : t('portal.safety.save')}
            </button>
          </div>
        </form>
      </li>
    )
  }

  return (
    <li className="flex items-start gap-2">
      <div className="min-w-0 flex-1 py-2">
        <p className={`text-body whitespace-pre-line break-words ${item.pending ? 'opacity-60' : ''}`}>
          {item.text}
        </p>
        {blocked && (
          <p className="text-caption mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="rounded-full bg-[#dc2626] px-2 py-[2px] text-white">{t('portal.safety.blocked')}</span>
            <span className="text-danger-soft">{t('portal.safety.blockedHint')}</span>
          </p>
        )}
        {!blocked && item.safety_pending && !item.pending && (
          <p className="text-caption mt-1 text-muted">{t('portal.safety.pending')}</p>
        )}
        {!blocked && !item.safety_pending && item.sensitive && (
          <p className="text-caption mt-1 text-muted">{t('portal.safety.private')}</p>
        )}
      </div>
      {confirming ? (
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onDelete}
            className="text-secondary min-h-[44px] rounded-full bg-[#dc2626] px-3 font-semibold text-white"
          >
            {t('portal.context.delete')}
          </button>
          <button
            type="button"
            onClick={onCancelConfirm}
            className="text-secondary min-h-[44px] rounded-full px-2 text-muted"
          >
            {t('portal.common.cancel')}
          </button>
        </span>
      ) : (
        <span className="flex shrink-0 items-center">
          <button
            type="button"
            disabled={item.pending}
            onClick={() => { setDraft(item.text); setEditing(true) }}
            aria-label={t('portal.safety.editItem', { text: item.text })}
            className="flex h-[44px] w-[44px] items-center justify-center rounded-full disabled:opacity-40"
          >
            <img src={penIcon} alt="" width={14.9333} height={14.9333} />
          </button>
          <button
            type="button"
            disabled={item.pending}
            onClick={onConfirm}
            aria-label={t('portal.context.deleteItem', { text: item.text })}
            className="flex h-[44px] w-[44px] items-center justify-center rounded-full disabled:opacity-40"
          >
            <img src={trashIcon} alt="" width={13.6} height={14.9333} />
          </button>
        </span>
      )}
    </li>
  )
}
