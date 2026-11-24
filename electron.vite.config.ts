import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        // Sandboxed preloads must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    resolve: { alias: { '@': resolve('src/renderer/src') } },
    // Native file events were missed on this machine (rapid successive edits left
    // stale modules being served — see docs/PROTOCOL.md history). Polling is reliable.
    server: { watch: { usePolling: true, interval: 250 } }
  }
})
