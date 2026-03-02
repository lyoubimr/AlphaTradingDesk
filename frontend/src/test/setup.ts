import '@testing-library/jest-dom'
import { beforeAll, afterAll } from 'vitest'

// Suppress React "not wrapped in act(...)" warnings for async state updates
// that happen after the test assertion (e.g. fetch-based health polling).
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
