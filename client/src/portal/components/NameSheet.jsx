/**
 * NameSheet — "What should we call you?" after a first successful pairing, when the caregiver has no name yet.
 * Skippable. Saves through PUT /api/caregiver (person-name rules + the content safety check, kind display_name),
 * the same endpoint as Settings → Account & Security. The tablet then shows "Connected · {name}" (caregiver:updated).
 * Dialog = bottom sheet below 640px, centered from 640px.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import Dialog, { DialogButton } from './Dialog'
import { checkName, saveCaregiverName, nameErrorKey } from '../caregiverName'

export default function NameSheet({ onDone }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const save = async (e) => {
    e?.preventDefault()
    if (saving) return
    const checked = checkName(name)
    if (!checked.ok) { setError(t('portal.settings.account.errors.name')); return }
    if (!checked.value) { onDone(); return } // nothing typed: same as Skip
    setSaving(true)
    setError(null)
    try {
      await saveCaregiverName(checked.value)
      onDone()
    } catch (err) {
      if (err.code === 'unauthorized') return
      setError(t(nameErrorKey(err)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={t('portal.nameSheet.title')}
      onClose={onDone}
      footer={
        <>
          <DialogButton variant="ghost" onClick={onDone} disabled={saving}>{t('portal.nameSheet.skip')}</DialogButton>
          <DialogButton onClick={save} disabled={saving}>
            {saving && <Loader2 size={18} className="animate-spin" aria-hidden="true" />}
            {saving ? t('portal.safety.checking') : t('portal.nameSheet.save')}
          </DialogButton>
        </>
      }
    >
      <form onSubmit={save} noValidate>
        <p className="text-body">{t('portal.nameSheet.body')}</p>
        <label htmlFor="name-sheet-input" className="text-caption mt-4 block text-muted">{t('portal.nameSheet.label')}</label>
        <input
          id="name-sheet-input"
          value={name}
          maxLength={40}
          autoComplete="name"
          placeholder={t('portal.nameSheet.placeholder')}
          onChange={e => { setName(e.target.value); setError(null) }}
          aria-invalid={!!error}
          aria-describedby="name-sheet-error"
          className="text-body mt-1 h-[44px] w-full rounded-control bg-white px-3 text-black outline-none focus-visible:ring-2 focus-visible:ring-[#54aed3]"
        />
        {error && <p id="name-sheet-error" role="alert" className="text-caption mt-2 text-danger-soft">{error}</p>}
      </form>
    </Dialog>
  )
}
