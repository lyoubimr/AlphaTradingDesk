// ── ProfileContext ────────────────────────────────────────────────────────
// Provides the list of active profiles and the currently selected profile
// to the entire app. Active profile_id is persisted in localStorage.
//
// Usage:
//   const { activeProfile, profiles, setActiveProfileId, loading } = useProfile()

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import { profilesApi } from '../lib/api'
import type { Profile } from '../types/api'

const LS_KEY = 'atd_active_profile_id'

// ── Context shape ─────────────────────────────────────────────────────────

interface ProfileContextValue {
  profiles: Profile[]
  activeProfile: Profile | null
  activeProfileId: number | null
  setActiveProfileId: (id: number) => void
  loading: boolean
  error: string | null
  refetch: () => void
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

// ── Provider ──────────────────────────────────────────────────────────────

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles]         = useState<Profile[]>([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState<string | null>(null)
  const [activeProfileId, _setActiveId] = useState<number | null>(() => {
    const stored = localStorage.getItem(LS_KEY)
    return stored ? parseInt(stored, 10) : null
  })

  const setActiveProfileId = useCallback((id: number) => {
    localStorage.setItem(LS_KEY, String(id))
    _setActiveId(id)
  }, [])

  const fetchProfiles = useCallback(() => {
    setLoading(true)
    setError(null)
    profilesApi
      .list()
      .then((list) => {
        // Only show active profiles
        const active = list.filter((p) => p.status === 'active')
        setProfiles(active)

        // Auto-select: keep stored id if still valid, else pick first
        _setActiveId((prev) => {
          const valid = active.find((p) => p.id === prev)
          if (valid) return prev
          if (active.length > 0) {
            const firstId = active[0].id
            localStorage.setItem(LS_KEY, String(firstId))
            return firstId
          }
          return null
        })
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchProfiles() }, [fetchProfiles]) // fetchProfiles uses async .then() — not a synchronous setState

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? null

  return (
    <ProfileContext.Provider
      value={{
        profiles,
        activeProfile,
        activeProfileId,
        setActiveProfileId,
        loading,
        error,
        refetch: fetchProfiles,
      }}
    >
      {children}
    </ProfileContext.Provider>
  )
}

// ── Hook ──────────────────────────────────────────────────────────────────
// eslint-disable-next-line react-refresh/only-export-components
export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('useProfile must be used inside <ProfileProvider>')
  return ctx
}
