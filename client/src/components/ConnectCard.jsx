/**
 * ConnectCard — content of the "Connect a caregiver" popup (header popover, compact menu, /terminal/pairing).
 *
 * Title, the pairing code, where to type it ("{origin}/portal", built from window.location.origin),
 * a QR code for {origin}/portal/pair?code=XXXXXX, the expiry countdown and "Get a new code".
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import qrcode from 'qrcode-generator'

function formatRemaining(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Re-renders every second while a code is counting down
function useNow(active) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

function QrCode({ text, label }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(text)
    qr.make()
    const n = qr.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`
    }
    return { size: n, path: d }
  }, [text])
  // 2-module quiet zone, black on white so phone cameras read it
  return (
    <svg className="term-qr" viewBox={`-2 -2 ${size + 4} ${size + 4}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x="-2" y="-2" width={size + 4} height={size + 4} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  )
}

export default function ConnectCard({ code, expiresAt, loading, onRegenerate }) {
  const { t } = useTranslation()
  const now = useNow(!!code && !!expiresAt)
  const expired = !!code && !!expiresAt && expiresAt <= now
  const live = !!code && !expired
  const origin = window.location.origin
  const portalUrl = `${origin}/portal`

  return (
    <>
      <p className="term-popover-title">{t('connect.title')}</p>
      <div className="term-code-pill" aria-live="polite">{live ? code : '------'}</div>
      <p className="term-popover-note">
        {t('connect.helpBefore')}<span className="term-connect-url">{portalUrl}</span>{t('connect.helpAfter')}
      </p>
      {live && (
        <>
          <QrCode text={`${portalUrl}/pair?code=${encodeURIComponent(code)}`} label={t('connect.qrLabel')} />
          <p className="term-popover-note mt-[6px]">{t('connect.scan')}</p>
        </>
      )}
      {live && expiresAt && (
        <p className="term-popover-note term-connect-expiry mt-[6px]">
          {t('connect.expiresIn', { time: formatRemaining(expiresAt - now) })}
        </p>
      )}
      {expired && <p className="term-popover-note mt-[6px]" role="status">{t('connect.expired')}</p>}
      <button
        type="button"
        onClick={onRegenerate}
        disabled={loading}
        className="mx-auto mt-[6px] block min-h-[44px] px-3 text-[14px] text-white/80 underline disabled:opacity-60"
      >
        {loading ? t('connect.loading') : t('regenerate')}
      </button>
    </>
  )
}
