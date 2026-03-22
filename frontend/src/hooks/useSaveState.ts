import { useState, useCallback } from 'react'

export interface SaveState {
  saving: boolean
  saved: boolean
  saveErr: string | null
  dirty: boolean
  setDirty: (v: boolean) => void
  wrapSave: (fn: () => Promise<void>) => Promise<void>
  clearErr: () => void
  reset: () => void
}

/**
 * Shared save state for settings pages.
 *
 * Usage:
 *   const { saving, saved, saveErr, dirty, setDirty, wrapSave } = useSaveState()
 *
 *   async function save() {
 *     await wrapSave(async () => {
 *       await someApi.update(...)
 *     })
 *   }
 */
export function useSaveState(): SaveState {
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [dirty,   setDirty]   = useState(false)

  const wrapSave = useCallback(async (fn: () => Promise<void>) => {
    setSaving(true)
    setSaveErr(null)
    setSaved(false)
    try {
      await fn()
      setSaved(true)
      setDirty(false)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [])

  const clearErr = useCallback(() => setSaveErr(null), [])
  const reset    = useCallback(() => { setSaved(false); setSaveErr(null) }, [])

  return { saving, saved, saveErr, dirty, setDirty, wrapSave, clearErr, reset }
}
