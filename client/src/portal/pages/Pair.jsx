/**
 * Pair — caregiver code entry (Figma 62:171, iPhone 17 402×874).
 *
 *   Page bg #164c67, back link, screen title, then a centered card (#137ba6) on every width:
 *   subtitle, divider (#54aed3), "Enter code:", code box (#234053), Confirm (#0e5f80).
 *   Below them (not in Figma): "or" + "Scan QR code" (camera) → QrScannerSheet (lazy-loaded with its decoder).
 *   A scanned code fills the field, shows "Code detected, connecting..." and goes through the same pair call and errors.
 *   Figma sizes are a reference; text uses the portal type scale.
 */
import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Camera, Loader2 } from 'lucide-react'

import PortalHeader from '../components/PortalHeader'
import PortalToast  from '../components/PortalToast'
import dividerSvg   from '../../assets/portal-divider.svg'
import { pairWithCode } from '../portalApi'
import { getSession, setSession, clearSession } from '../session'
import { CODE_LENGTH, toRawCode, takeCodeParam } from '../pairCode'

// The scanner (and its QR decoder) loads only when the caregiver opens it
const QrScannerSheet = lazy(() => import('../components/QrScannerSheet'))

const SEPARATOR   = ' - '

const ERROR_KEYS = {
  code_required: 'invalid',
  invalid_code:  'invalid',
  code_expired:  'expired',
  code_used:     'used',
  rate_limited:  'rateLimited',
  network:       'network',
}

const toDisplay = (raw) => (raw.length > 3 ? `${raw.slice(0, 3)}${SEPARATOR}${raw.slice(3)}` : raw)

export default function Pair() {
  const { t }    = useTranslation()
  const navigate = useNavigate()
  // ?link=1 (Settings → "Pair New Tablet"): link the tablet to the signed-in caregiver's patient
  const [params, setParams] = useSearchParams()
  const linkToken = params.get('link') === '1' ? getSession()?.token : null
  // ?code= (the tablet's QR code) pre-fills the input; never submitted automatically
  const [code,    setCode]    = useState(() => takeCodeParam(params.toString()).code)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [scanning, setScanning] = useState(false)
  const [detected, setDetected] = useState(false) // "Code detected, connecting..."

  // Clear ?code= from the address bar once read
  useEffect(() => {
    const { had, rest } = takeCodeParam(params.toString())
    if (had) setParams(new URLSearchParams(rest), { replace: true })
  }, [params, setParams])

  // Toast clears itself after a few seconds
  useEffect(() => {
    if (!error) return
    const id = setTimeout(() => setError(null), 5000)
    return () => clearTimeout(id)
  }, [error])

  const handleChange = (e) => {
    let raw = toRawCode(e.target.value)
    // Backspace over the " - " separator removes the character before it
    if (raw === code && e.target.value.length < toDisplay(code).length) raw = raw.slice(0, -1)
    setCode(raw)
    setError(null)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    submitCode(code)
  }

  // A scan: the camera is already off; fill the field and pair right away
  const handleDetected = (scanned) => {
    setScanning(false)
    setCode(scanned)
    setDetected(true)
    submitCode(scanned)
  }

  const submitCode = async (value) => {
    if (loading) return
    if (value.length !== CODE_LENGTH) {
      setError(t('portal.pair.errors.invalid'))
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await pairWithCode(value, { token: linkToken })
      setSession(data)
      // A first pairing asks "What should we call you?" when the caregiver has no name (PortalApp useAskName)
      navigate(linkToken ? '/portal/settings' : '/portal', { replace: true, state: linkToken ? null : { askName: true } })
    } catch (err) {
      console.error('pair failed:', err.message)
      if (linkToken && err.status === 401) {
        // the stored session is no longer valid: next attempt pairs without it
        clearSession()
        setError(t('portal.pair.errors.sessionExpired'))
        navigate('/portal/pair', { replace: true })
        return
      }
      setError(t(`portal.pair.errors.${ERROR_KEYS[err.code] || 'generic'}`))
    } finally {
      setLoading(false)
      setDetected(false)
    }
  }

  const backClass = 'text-body -ml-2 inline-flex min-h-[44px] items-center gap-2 px-2 text-white'

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#164c67] text-white">
      <PortalHeader />
      <PortalToast message={error} />
      {scanning && (
        <Suspense fallback={null}>
          <QrScannerSheet onDetected={handleDetected} onClose={() => setScanning(false)} />
        </Suspense>
      )}

      {/* Centered card on every width */}
      <main className="flex flex-1 items-start justify-center px-4 py-6 sm:items-center">
        <div className="w-full max-w-[420px]">
          {linkToken ? (
            <Link to="/portal/settings" className={backClass}>
              <span aria-hidden="true">←</span>
              {t('portal.pair.backToSettings')}
            </Link>
          ) : (
            /* "← back to patient page" — the terminal is its own app, so a full page load */
            <a href="/terminal" className={backClass}>
              <span aria-hidden="true">←</span>
              {t('portal.pair.back')}
            </a>
          )}

          <h1 className="text-title mt-2 text-white">{t('portal.pair.title')}</h1>

          <form
            onSubmit={handleSubmit}
            noValidate
            className="mt-6 flex flex-col items-center rounded-card bg-intacta-mid px-6 pt-6 pb-8
                       shadow-[0_0_9px_5px_rgba(6,19,44,0.25)]"
          >
            <p className="text-card text-center text-white">
              {t(linkToken ? 'portal.pair.subtitleLink' : 'portal.pair.subtitle')}
            </p>

            <img src={dividerSvg} alt="" width={274} height={2} className="mt-3 w-full max-w-[274px]" />

            <label htmlFor="pair-code" className="text-card mt-6 text-[#dff3ff]">
              {t('portal.pair.enterCode')}
            </label>

            <input
              id="pair-code"
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              value={toDisplay(code)}
              onChange={handleChange}
              placeholder={t('portal.pair.placeholder')}
              maxLength={CODE_LENGTH + SEPARATOR.length}
              aria-invalid={!!error}
              className="text-title mt-4 h-[56px] w-full max-w-[260px] rounded-control border-0 bg-intacta-panel text-center
                         uppercase tracking-[0.08em] tabular-nums text-white
                         outline-none placeholder:text-white/60 focus-visible:ring-2 focus-visible:ring-[#54aed3]"
            />

            <button
              type="submit"
              disabled={loading}
              className="text-body mt-8 flex h-[48px] min-w-[163px] items-center justify-center gap-2 rounded-control bg-[#0e5f80] px-6
                         font-semibold text-[#e4f5ff] disabled:cursor-wait disabled:opacity-70"
            >
              {loading && <Loader2 size={20} className="animate-spin" aria-hidden="true" />}
              {t('portal.pair.confirm')}
            </button>

            <p className="text-secondary mt-3 min-h-[1.45em] text-center text-[#dff3ff]" role="status" aria-live="polite">
              {detected ? t('portal.pair.detected') : ''}
            </p>

            {/* ── or: scan the tablet's QR code ── */}
            <div className="mt-3 flex w-full max-w-[274px] items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-[#54aed3]" />
              <span className="text-secondary text-[#dff3ff]">{t('portal.pair.or')}</span>
              <span className="h-px flex-1 bg-[#54aed3]" />
            </div>
            <button
              type="button"
              onClick={() => { setError(null); setScanning(true) }}
              disabled={loading}
              data-testid="scan-qr"
              className="text-body mt-4 flex min-h-[48px] min-w-[163px] items-center justify-center gap-2 rounded-control border-2
                         border-[#54aed3] px-5 font-semibold text-white disabled:opacity-60"
            >
              <Camera size={20} aria-hidden="true" />
              {t('portal.pair.scan')}
            </button>
          </form>
        </div>
      </main>
    </div>
  )
}
