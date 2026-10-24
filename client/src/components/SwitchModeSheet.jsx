/**
 * SwitchModeSheet — "Switch mode? This device will leave the patient screen." (opened by holding the logo 3 s).
 * Bottom sheet on phones, centered from 640px. Switch → lib/startMode goToModeChooser (/?choose=1); the device token
 * and any caregiver login stay.
 */
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

export default function SwitchModeSheet({ onCancel, onConfirm }) {
  const { t } = useTranslation()
  const cancelRef = useRef(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const btn = 'min-h-[56px] flex-1 rounded-[12px] px-4 text-[18px] font-bold outline-none focus-visible:ring-4 focus-visible:ring-white'
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55 sm:items-center"
      onPointerDown={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="switch-mode-title"
        aria-describedby="switch-mode-body"
        className="w-full rounded-t-[16px] bg-[#137ba6] px-6 pt-6 pb-[max(24px,env(safe-area-inset-bottom))] text-white
                   shadow-[0_8px_32px_rgba(0,0,0,0.4)] sm:max-w-[440px] sm:rounded-[16px] sm:pb-6"
      >
        <h2 id="switch-mode-title" className="text-[22px] font-bold leading-tight">{t('switchMode.title')}</h2>
        <p id="switch-mode-body" className="mt-2 text-[16px] leading-normal">{t('switchMode.body')}</p>
        <div className="mt-6 flex gap-3">
          <button ref={cancelRef} type="button" onClick={onCancel} className={`${btn} bg-white text-[#05324d]`}>
            {t('switchMode.cancel')}
          </button>
          <button type="button" onClick={onConfirm} className={`${btn} bg-[#234053] text-white`}>
            {t('switchMode.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
