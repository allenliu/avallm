import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'

// Two entries: the app (index.html) and a fixture component gallery
// (gallery.html) the screenshot harness shoots for luck-of-the-deal UI states.
// The gallery is a separate entry so it stays out of the app's bundle.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        gallery: fileURLToPath(new URL('./gallery.html', import.meta.url)),
      },
    },
  },
})
