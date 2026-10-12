/**
 * Pair — caregiver code entry (Figma 62:171, iPhone 17 402×874).
 *
 *   Page bg #164c67, header 115px
 *   Back link:  top 183, left 48, Inter 20px white → /terminal
 *   Title:      top 233, left 49, 40px bold white
 *   Card:       top 320, 328×348, #137ba6, radius 12, shadow 0 0 9 5 rgba(6,19,44,.25)
 *     subtitle top 20 (23px Baloo), divider top 71 (274 wide, #54aed3),
 *     "Enter code:" top 98 (32px #dff3ff), code box top 170 (260×57 #234053 r10, 30px),
 *     Confirm top 269 (163×48 #0e5f80 r9, 25px #e4f5ff)
 */
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import PortalHeader from '../components/PortalHeader'
import PortalToast  from '../components/PortalToast'
import dividerSvg   from '../../assets/portal-divider.svg'
import { pairWithCode } from '../portalApi'
import { getSession, setSession, clearSession } from '../session'

const CODE_LENGTH = 6
const SEPARATOR   = ' - '

const ERROR_KEYS = {
  code_required: 'invalid',
  invalid_code:  'invalid',
  code_expired:  'expired',
  code_used:     'used',
  rate_limited:  'rateLimited',
  network:       'network',
}

const toRaw = (value) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH)
const toDisplay = (raw) => (raw.length > 3 ? `${raw.slice(0, 3)}${SEPARATOR}${raw.slice(3)}` : raw)

export default function Pair() {
  const { t }    = useTranslation()
  const navigate = useNavigate()
  // ?link=1 (Settings → "Pair New Tablet"): link the tablet to the signed-in caregiver's patient
  const [params] = useSearchParams()
  const linkToken = params.get('link') === '1' ? getSession()?.token : null
  const [code,    setCode]    = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  // Toast clears itself after a few seconds
  useEffect(() => {
    if (!error) return
    const id = setTimeout(() => setError(null), 5000)
    return () => clearTimeout(id)
  }, [error])

  const handleChange = (e) => {
    let raw = toRaw(e.target.value)
    // Backspace over the " - " separator removes the character before it
    if (raw === code && e.target.value.length < toDisplay(code).length) raw = raw.slice(0, -1)
    setCode(raw)
    setError(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (loading) return
    if (code.length !== CODE_LENGTH) {
      setError(t('portal.pair.errors.invalid'))
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await pairWithCode(code, { token: linkToken })
      setSession(data)
      navigate(linkToken ? '/portal/settings' : '/portal', { replace: true })
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
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-[#164c67] text-white">
      <PortalHeader />
      <PortalToast message={error} />

      <main className="mx-auto w-full max-w-[402px] px-[41px] pb-10">
        {linkToken ? (
          <Link
            to="/portal/settings"
            className="mt-[64px] -ml-2 inline-flex min-h-[44px] items-center gap-2 px-2 text-body-regular text-[20px] text-white"
          >
            <span aria-hidden="true">←</span>
            {t('portal.pair.backToSettings')}
          </Link>
        ) : (
          /* "← back to patient page" — the terminal is its own app, so a full page load */
          <a
            href="/terminal"
            className="mt-[64px] -ml-2 inline-flex min-h-[44px] items-center gap-2 px-2 text-body-regular text-[20px] text-white"
          >
            <span aria-hidden="true">←</span>
            {t('portal.pair.back')}
          </a>
        )}

        <h1 className="mt-[2px] text-title-bold text-[40px] leading-normal text-white">
          {t('portal.pair.title')}
        </h1>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="mt-[30px] flex flex-col items-center rounded-[12px] bg-intacta-mid px-[29px] pt-[20px] pb-[31px]
                     shadow-[0_0_9px_5px_rgba(6,19,44,0.25)]"
        >
          <p className="text-center text-title-bold text-[21px] leading-normal text-white">
            {t(linkToken ? 'portal.pair.subtitleLink' : 'portal.pair.subtitle')}
          </p>

          <img src={dividerSvg} alt="" width={274} height={2} className="mt-[13px] w-full max-w-[274px]" />

          <label
            htmlFor="pair-code"
            className="mt-[25px] text-title-bold text-[32px] leading-normal text-[#dff3ff]"
          >
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
            className="mt-[28px] h-[57px] w-full max-w-[260px] rounded-[10px] border-0 bg-intacta-panel text-center
                       text-title-bold text-[30px] uppercase text-white
                       outline-none placeholder:text-white/50 focus-visible:ring-2 focus-visible:ring-[#54aed3]"
          />

          <button
            type="submit"
            disabled={loading}
            className="mt-[42px] flex h-[48px] w-[163px] items-center justify-center gap-2 rounded-[9px] bg-[#0e5f80]
                       text-title-semibold text-[25px] text-[#e4f5ff]
                       disabled:opacity-70 disabled:cursor-wait"
          >
            {loading && <Loader2 size={22} className="animate-spin" aria-hidden="true" />}
            {t('portal.pair.confirm')}
          </button>
        </form>
      </main>
    </div>
  )
}
