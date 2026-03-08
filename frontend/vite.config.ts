import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Backend URL: defaults to localhost for local dev (npm run dev on host).
// Override with VITE_API_TARGET=http://backend:8000 inside Docker Compose.
const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
  server: {
    host: '0.0.0.0',
    // Force polling-based file watcher — required for bind-mount volumes
    // inside Docker Desktop on macOS (inotify events not forwarded to guest).
    watch: {
      usePolling: true,
      interval: 300,       // ms — low enough to feel instant, not heavy on CPU
    },
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        // No rewrite — backend routes are already prefixed with /api
      },
      // Proxy /uploads/* to backend StaticFiles mount
      '/uploads': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
})
