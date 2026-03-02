// ── useApi — generic data-fetching hook ───────────────────────────────────
// Usage:
//   const { data, loading, error, refetch } = useApi(() => profilesApi.list())
//
// - Fires on mount and whenever `refetch()` is called.
// - `deps` array triggers a re-fetch when any value changes (like useEffect).

import { useState, useEffect, useCallback, useRef } from 'react'

interface UseApiState<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useApi<T>(
  fn: () => Promise<T>,
  deps: unknown[] = [],
): UseApiState<T> {
  const [data, setData]       = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  // Stable ref to fn — avoids stale closure without listing fn in deps
  const fnRef = useRef(fn)
  fnRef.current = fn

  const [tick, setTick] = useState(0)
  const refetch = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fnRef.current()
      .then((result) => { if (!cancelled) { setData(result); setLoading(false) } })
      .catch((err: Error) => { if (!cancelled) { setError(err.message); setLoading(false) } })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps])

  return { data, loading, error, refetch }
}
