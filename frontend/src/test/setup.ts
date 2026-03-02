import '@testing-library/jest-dom'
import { beforeAll, afterAll, vi } from 'vitest'

// ── localStorage mock ─────────────────────────────────────────────────────
// jsdom provides localStorage but the --localstorage-file flag can disable it.
// We always provide a reliable in-memory mock so ProfileContext works in tests.
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()
vi.stubGlobal('localStorage', localStorageMock)

// ── Suppress noisy React warnings in tests ────────────────────────────────
const originalError = console.error.bind(console.error)
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) return
    originalError(...args)
  }
})
afterAll(() => {
  console.error = originalError
})
