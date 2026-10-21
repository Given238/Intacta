/**
 * Context — daily + permanent notes the tablet's LLM uses (Figma 60:60, iPhone 17 402×874).
 *
 *   Cards:  365 wide (18 / 19 side margins), #043961, radius 25, 28px apart, first 30px below the header
 *   Title:  Inter Bold 13px, 24px in, 14px from the top
 *   Items:  Inter 13px white (daily Regular, permanent Light), 293 wide, trash icon (Figma 107:1627) on the right
 *   Input:  white pill 255×43, radius 100, placeholder Inter Light 13px black; plus-circle (Figma 107:1634) to the right
 *
 * Data: GET /api/context-items (today's daily + permanent), POST / DELETE with optimistic update + rollback.
 * Every mutation makes the server push context:sync to the paired terminal.
 * Safety: the server refuses text that could frighten the patient (422 unsafe_content) → inline message, text kept.
 * Stored items that fail a re-check come back with blocked_category: shown with a red "Blocked for safety" label,
 * never sent to the tablet, still editable (PUT) and deletable.
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
    <div className="px-[18px] pt-[30px] text-[13px] text-white">
      <PortalToast message={toast} />
      {loading && !data && <Loading />}
      {error && !loading && <LoadError onRetry={retry} />}
      {data && !error && (
        <div className="flex flex-col gap-[28px]">
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
    if (result === 'unsafe') setInputError(t('portal.safety.unsafe'))
  }

  const itemWeight = scope === 'daily' ? 'text-body-regular' : 'text-body-light'

  return (
    <section className={`${CARD} pt-[14px] pb-[15px] pl-[15px] pr-[16px]`} aria-labelledby={`${inputId}-title`}>
      <h2 id={`${inputId}-title`} className="text-title-bold pl-[9px] leading-normal">
        {t(`portal.context.${scope}.title`)}
      </h2>

      <ul className="mt-[8px] flex flex-col gap-[4px] pl-[9px]">
        {items.length === 0 && (
          <li className="py-[6px]"><Empty>{t(`portal.context.${scope}.empty`)}</Empty></li>
        )}
        {items.map(item => (
          <ContextItemRow
            key={item.id}
            item={item}
            itemWeight={itemWeight}
            confirming={confirmId === item.id}
            onConfirm={() => setConfirmId(item.id)}
            onCancelConfirm={() => setConfirmId(null)}
            onDelete={() => { setConfirmId(null); onDelete(item) }}
            onEdit={text => onEdit(item, text)}
          />
        ))}
      </ul>

      <form onSubmit={submit} noValidate className="mt-[22px]">
        <div className="flex items-center gap-[12px]">
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
            className="text-body-light h-[43px] min-w-0 flex-1 rounded-[100px] bg-white px-[29px] text-[13px] text-black
                       outline-none placeholder:text-black focus-visible:ring-2 focus-visible:ring-[#54aed3]"
          />
          <button
            type="submit"
            disabled={saving}
            aria-label={t('portal.context.add')}
            className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full disabled:opacity-50"
          >
            {saving
              ? <Loader2 size={20} className="animate-spin" aria-hidden="true" />
              : <img src={plusCircleIcon} alt="" width={20.6667} height={20.6667} />}
          </button>
        </div>
        <div id={errorId} aria-live="polite" className="flex min-h-[18px] justify-between gap-2 px-[14px] pt-[4px] text-[12px]">
          <span className="text-body-medium text-[#ffb4b4]">
            {inputError || (tooLong ? t('portal.context.errors.tooLong', { max: MAX_CHARS }) : '')}
          </span>
          {trimmed.length >= COUNTER_FROM && (
            <span className={`text-body-medium shrink-0 ${tooLong ? 'text-[#ffb4b4]' : 'text-intacta-text'}`}>
              {trimmed.length}/{MAX_CHARS}
            </span>
          )}
        </div>
      </form>
    </section>
  )
}

function ContextItemRow({ item, itemWeight, confirming, onConfirm, onCancelConfirm, onDelete, onEdit }) {
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
    else if (result === 'unsafe') setError(t('portal.safety.unsafe'))
  }

  if (editing) {
    return (
      <li>
        <form onSubmit={save} noValidate className="flex flex-col gap-[6px] py-[4px]">
          <label htmlFor={inputId} className="sr-only">{t('portal.safety.editItem', { text: item.text })}</label>
          <input
            id={inputId}
            value={draft}
            onChange={e => { setDraft(e.target.value); setError(null) }}
            aria-invalid={!!error}
            aria-describedby={errorId}
            autoFocus
            className="text-body-regular h-[44px] w-full rounded-[100px] bg-white px-[18px] text-[15px] text-black outline-none focus-visible:ring-2 focus-visible:ring-[#54aed3]"
          />
          <p id={errorId} aria-live="polite" className="text-body-medium px-[6px] text-[12px] text-[#ffb4b4]">{error}</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setEditing(false); setDraft(item.text); setError(null) }}
              className="text-body-medium min-h-[44px] rounded-full px-3 text-[13px] text-intacta-text"
            >
              {t('portal.safety.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="text-title-semibold min-h-[44px] rounded-full bg-white px-4 text-[13px] text-[#043961] disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : t('portal.safety.save')}
            </button>
          </div>
        </form>
      </li>
    )
  }

  return (
    <li className="flex items-start gap-2">
      <div className="min-w-0 flex-1 py-[6px]">
        <p className={`${itemWeight} whitespace-pre-line break-words leading-normal ${item.pending ? 'opacity-60' : ''}`}>
          {item.text}
        </p>
        {blocked && (
          <p className="mt-[4px] flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
            <span className="text-title-semibold rounded-full bg-[#dc2626] px-2 py-[2px] text-white">{t('portal.safety.blocked')}</span>
            <span className="text-body-medium text-[#ffb4b4]">{t('portal.safety.blockedHint')}</span>
          </p>
        )}
      </div>
      {confirming ? (
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onDelete}
            className="text-title-semibold min-h-[32px] rounded-full bg-[#dc2626] px-3 text-[12px] text-white"
          >
            {t('portal.context.delete')}
          </button>
          <button
            type="button"
            onClick={onCancelConfirm}
            className="text-body-medium min-h-[32px] rounded-full px-2 text-[12px] text-intacta-text"
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
            className="flex h-[32px] w-[32px] items-center justify-center rounded-full disabled:opacity-40"
          >
            <img src={penIcon} alt="" width={14.9333} height={14.9333} />
          </button>
          <button
            type="button"
            disabled={item.pending}
            onClick={onConfirm}
            aria-label={t('portal.context.deleteItem', { text: item.text })}
            className="flex h-[32px] w-[32px] items-center justify-center rounded-full disabled:opacity-40"
          >
            <img src={trashIcon} alt="" width={13.6} height={14.9333} />
          </button>
        </span>
      )}
    </li>
  )
}
