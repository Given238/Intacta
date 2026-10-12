/**
 * usePortalLoad — run an async loader on mount, with loading / error / retry.
 * A 401 is not an error here: portalFetch is already redirecting to /portal/pair.
 */
import { useEffect, useState } from 'react'

export function usePortalLoad(loader) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    loader()
      .then(result => {
        if (cancelled) return
        setData(result)
        setError(false)
      })
      .catch(err => {
        if (cancelled || err.code === 'unauthorized') return
        console.error('portal load failed:', err.message)
        setError(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // loader is a module-level function per screen; reloads only on retry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  const retry = () => {
    setLoading(true)
    setError(false)
    setAttempt(a => a + 1)
  }

  return { data, setData, loading, error, retry }
}

/** Numeric patient id from the stored session (the API's zod schemas expect an integer). */
export function sessionPatientId(session) {
  const n = Number(session?.patient_id)
  return Number.isInteger(n) ? n : session?.patient_id
}
