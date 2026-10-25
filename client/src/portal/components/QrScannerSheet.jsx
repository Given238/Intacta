/**
 * QrScannerSheet — "Scan QR code" on the pair screen (Part E). Full-screen sheet on phones, centered dialog from 640px.
 *
 * Live camera preview (rear camera) with a framing square, "Point the camera at the QR code on the tablet", why the
 * camera is needed, Close, and a flashlight toggle only when the camera has one. Scanning and the camera lifecycle
 * live in portal/qrScan.js: every track stops on close, on a valid code and on unmount; nothing is recorded or kept.
 * A valid code → onDetected(code) (the camera is already off). Errors (denied, no camera, insecure page, unsupported
 * browser) show short instructions; typing the code on the pair screen always stays available.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Flashlight, FlashlightOff, Loader2, X } from 'lucide-react'

import { createScanner } from '../qrScan'

export default function QrScannerSheet({ onDetected, onClose }) {
  const { t } = useTranslation()
  const videoRef = useRef(null)
  const scannerRef = useRef(null)
  const closeRef = useRef(null)
  const [status, setStatus] = useState('starting') // starting | live | error
  const [errorKind, setErrorKind] = useState(null)
  const [invalid, setInvalid] = useState(false)
  const [torch, setTorch] = useState({ supported: false, on: false })

  // Latest callbacks without restarting the camera
  const onDetectedRef = useRef(onDetected)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onDetectedRef.current = onDetected; onCloseRef.current = onClose })

  useEffect(() => {
    const scanner = createScanner({
      video: videoRef.current,
      onStarted: () => {
        setStatus('live')
        setTorch({ supported: scanner.torchSupported(), on: false })
      },
      onCode: (code) => onDetectedRef.current(code),
      onInvalid: () => setInvalid(true),
      onError: (kind) => { setErrorKind(kind); setStatus('error') },
    })
    scannerRef.current = scanner
    scanner.start()
    return () => scanner.stop() // unmount: every track stops
  }, [])

  // The "not an Intacta code" note fades after a moment
  useEffect(() => {
    if (!invalid) return
    const id = setTimeout(() => setInvalid(false), 2500)
    return () => clearTimeout(id)
  }, [invalid])

  // Esc closes; focus starts on Close
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  function close() {
    scannerRef.current?.stop()
    onCloseRef.current()
  }

  const toggleTorch = async () => {
    const next = !torch.on
    if (await scannerRef.current?.setTorch(next)) setTorch(s => ({ ...s, on: next }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/80 sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-title"
        aria-describedby="scan-why"
        data-testid="qr-scanner"
        className="flex w-full flex-col overflow-y-auto bg-[#164c67] text-white sm:max-h-[90dvh] sm:max-w-[480px] sm:rounded-card
                   sm:shadow-[0_0_24px_rgba(6,19,44,0.5)]"
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
          <h2 id="scan-title" className="text-title">{t('portal.scan.title')}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label={t('portal.scan.close')}
            className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full bg-white/10"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>

        <p id="scan-why" className="text-secondary px-4 text-muted">{t('portal.scan.why')}</p>

        {/* Preview + framing square (the area outside the square is dimmed) */}
        <div className="relative mx-4 mt-3 aspect-square w-auto max-w-full overflow-hidden rounded-card bg-black sm:aspect-[4/3]">
          <video ref={videoRef} className="h-full w-full object-cover" playsInline muted aria-hidden="true" />
          {status === 'live' && (
            <div
              className="pointer-events-none absolute top-1/2 left-1/2 aspect-square w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-[20px]
                         border-4 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] sm:w-[52%]"
              aria-hidden="true"
            />
          )}
          {status === 'starting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2" role="status">
              <Loader2 size={28} className="animate-spin" aria-hidden="true" />
              <span className="text-secondary">{t('portal.scan.starting')}</span>
            </div>
          )}
          {status === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center p-5 text-center" role="alert">
              <p className="text-body">{t(`portal.scan.errors.${errorKind || 'error'}`)}</p>
            </div>
          )}
          {torch.supported && status === 'live' && (
            <button
              type="button"
              onClick={toggleTorch}
              aria-pressed={torch.on}
              aria-label={t(torch.on ? 'portal.scan.torchOff' : 'portal.scan.torchOn')}
              className="absolute right-3 bottom-3 flex h-[48px] w-[48px] items-center justify-center rounded-full bg-black/60"
            >
              {torch.on ? <FlashlightOff size={22} aria-hidden="true" /> : <Flashlight size={22} aria-hidden="true" />}
            </button>
          )}
        </div>

        <p className="text-body mt-3 px-4 text-center" aria-live="polite">
          {invalid ? t('portal.scan.notIntacta') : t('portal.scan.help')}
        </p>

        <div className="mt-auto px-4 pt-4 sm:mt-4">
          <button
            type="button"
            onClick={close}
            className="text-body flex min-h-[48px] w-full items-center justify-center rounded-control bg-white/15 font-semibold"
          >
            {t('portal.scan.typeInstead')}
          </button>
        </div>
      </div>
    </div>
  )
}
